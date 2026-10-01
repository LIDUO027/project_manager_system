"""待办事项（事项）核心业务：CRUD / 筛选 / 统计 / 完成时自动计算工作日。"""
from datetime import datetime

from .. import db
from ..config import (PRIORITIES, REMARK_MAX_LEN, STATUS_DOING, STATUS_DONE,
                      TITLE_MAX_LEN, TODO_STATUS, TODO_TYPES)
from . import calendar_service as cal

# 允许写入的字段（白名单，防止任意列注入）
FIELDS = ["title", "todo_type", "status", "priority", "remark", "due_date"]

SORTABLE = {
    "created_at": "created_at",
    "completed_at": "completed_at",
    "workdays": "workdays",          # 计算列，见 list_todos
    "priority": "priority",
    "todo_type": "todo_type",
    "title": "title",
    "status": "status",
    "due_date": "due_date",
}
PRIORITY_RANK = "CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 9 END"


# ------------------------------------------------------------------ 校验/清洗
def _clean(payload: dict) -> dict:
    data = {}
    for k in FIELDS:
        if k not in payload:
            continue
        v = payload[k]
        if k == "title":
            v = ("" if v is None else str(v)).strip()
        elif k == "remark":
            v = "" if v is None else str(v)
        elif k == "due_date":
            v = str(v)[:10] if v else ""
        else:
            v = ("" if v is None else str(v)).strip()
        data[k] = v
    return data


def _validate(data: dict, *, creating: bool) -> None:
    if creating and not data.get("title"):
        raise ValueError("事项不能为空")
    if "title" in data:
        if not data["title"]:
            raise ValueError("事项不能为空")
        if len(data["title"]) > TITLE_MAX_LEN:
            raise ValueError(f"事项最多 {TITLE_MAX_LEN} 个字符")
    if "todo_type" in data and data["todo_type"] and data["todo_type"] not in TODO_TYPES:
        raise ValueError("类型只能是：" + " / ".join(TODO_TYPES))
    if "priority" in data and data["priority"] and data["priority"] not in PRIORITIES:
        raise ValueError("优先级只能是：" + " / ".join(PRIORITIES))
    if "status" in data and data["status"] and data["status"] not in TODO_STATUS:
        raise ValueError("状态只能是：" + " / ".join(TODO_STATUS))
    if "remark" in data and len(data.get("remark") or "") > REMARK_MAX_LEN:
        raise ValueError(f"备注最多 {REMARK_MAX_LEN} 字")


# ------------------------------------------------------------------ 派生字段
def decorate(row: dict, *, hmap: dict | None = None) -> dict:
    """补上前端要用的派生字段（逾期 / 工作日耗时 / 完成时刻）。"""
    r = dict(row)
    done = r.get("status") == STATUS_DONE
    today = cal.fmt(cal.today())
    due = r.get("due_date") or ""

    r["is_done"] = done
    r["is_overdue"] = bool(due and not done and due < today)
    r["is_due_today"] = bool(due and not done and due == today)
    r["is_done_late"] = bool(done and due and (r.get("completed_at") or "")[:10] > due)

    if done and r.get("completed_at") and r.get("created_at"):
        dur = cal.business_duration(r["created_at"][:10], r["completed_at"][:10])
        r["workdays"] = dur["workdays"]
        r["calendar_days"] = dur["calendar_days"]
        r["workdays_text"] = f"{dur['workdays']} 个工作日"
    else:
        elapsed = cal.business_duration(r["created_at"][:10], today) if r.get("created_at") else {}
        r["workdays"] = None
        r["calendar_days"] = None
        r["workdays_text"] = ""
        r["elapsed_workdays"] = elapsed.get("workdays", 0)
    return r


# ------------------------------------------------------------------ CRUD
def create_todo(payload: dict) -> dict:
    data = _clean(payload)
    _validate(data, creating=True)
    data.setdefault("todo_type", TODO_TYPES[-1])
    data.setdefault("priority", "P1")
    data.setdefault("status", STATUS_DOING)
    data.setdefault("remark", "")
    data.setdefault("due_date", "")

    if data["status"] not in TODO_STATUS:
        data["status"] = STATUS_DOING
    ts = db.now()
    tid = db.execute(
        "INSERT INTO todos(title, todo_type, status, priority, remark, due_date, "
        "created_at, completed_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (data["title"], data["todo_type"], data["status"], data["priority"],
         data["remark"], data["due_date"], ts,
         ts if data["status"] == STATUS_DONE else "", ts))
    return get_todo(tid)


def update_todo(tid: int, payload: dict) -> dict:
    cur = db.query_one("SELECT * FROM todos WHERE id=?", (tid,))
    if not cur:
        raise ValueError("待办不存在")
    data = _clean(payload)
    _validate(data, creating=False)

    if "title" in data and not data["title"]:
        raise ValueError("事项不能为空")

    # —— 完成时间：状态切到已完成时自动打点，切回进行中时清空
    if "status" in data:
        if data["status"] == STATUS_DONE and cur["status"] != STATUS_DONE:
            data["completed_at"] = db.now()
        elif data["status"] == STATUS_DOING and cur["status"] == STATUS_DONE:
            data["completed_at"] = ""

    if data:
        data["updated_at"] = db.now()
        db.execute(f"UPDATE todos SET {','.join(k + '=?' for k in data)} WHERE id=?",
                   tuple(data.values()) + (tid,))
    return get_todo(tid)


def update_status(tid: int, status: str) -> dict:
    if status not in TODO_STATUS:
        raise ValueError("状态只能是：" + " / ".join(TODO_STATUS))
    return update_todo(tid, {"status": status})


def toggle_todo(tid: int) -> dict:
    cur = db.query_one("SELECT * FROM todos WHERE id=?", (tid,))
    if not cur:
        raise ValueError("待办不存在")
    nxt = STATUS_DOING if cur["status"] == STATUS_DONE else STATUS_DONE
    return update_todo(tid, {"status": nxt})


def delete_todo(tid: int) -> bool:
    return db.execute_rowcount("DELETE FROM todos WHERE id=?", (tid,)) > 0


def clear_completed() -> int:
    return db.execute_rowcount("DELETE FROM todos WHERE status=?", (STATUS_DONE,))


def get_todo(tid: int) -> dict:
    row = db.query_one("SELECT * FROM todos WHERE id=?", (tid,))
    return decorate(row) if row else {}


# ------------------------------------------------------------------ 查询
def _where(status=None, todo_type=None, priority=None, q=None) -> tuple:
    sql, params = " WHERE 1=1", []
    if status and status not in ("all", "全部"):
        if status in ("doing", "进行中"):
            sql += " AND status=?"
            params.append(STATUS_DOING)
        elif status in ("done", "已完成"):
            sql += " AND status=?"
            params.append(STATUS_DONE)
        else:
            sql += " AND status=?"
            params.append(status)
    if todo_type:
        sql += " AND todo_type=?"
        params.append(todo_type)
    if priority:
        sql += " AND priority=?"
        params.append(priority)
    if q:
        sql += " AND (title LIKE ? OR remark LIKE ?)"
        params += [f"%{q}%"] * 2
    return sql, params


def list_todos(status=None, todo_type=None, priority=None, q=None,
               sort: str = "created_at", order: str = "desc", limit: int | None = None) -> list:
    """指定排序的列表；sort='workdays' 时用「完成时间-创建时间」的工作日数排序。"""
    base, params = _where(status, todo_type, priority, q)

    if sort == "workdays":
        direction = "ASC" if str(order).lower() in ("asc", "升序") else "DESC"
        sql = (f"SELECT *, (julianday(completed_at) - julianday(created_at)) AS workdays "
               f"FROM todos{base} AND completed_at <> '' "
               f"ORDER BY workdays {direction}, id {direction}")
    else:
        col = SORTABLE.get(sort or "created_at", "created_at")
        direction = "ASC" if str(order).lower() in ("asc", "升序") else "DESC"
        if col == "priority":
            sql = (f"SELECT * FROM todos{base} ORDER BY {PRIORITY_RANK} {direction}, "
                   f"created_at DESC, id DESC")
        else:
            # 默认：最新的在最上面
            sql = (f"SELECT * FROM todos{base} ORDER BY {col} {direction}, id {direction}")
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [decorate(r) for r in db.query(sql, params)]


def summary(status=None, todo_type=None, priority=None, q=None) -> dict:
    """按当前筛选条件统计（供顶部统计条 / 页签数量使用）。"""
    where, params = _where(status, todo_type, priority, q)
    rows = [decorate(r) for r in db.query("SELECT * FROM todos" + where, params)]
    doing = [r for r in rows if r["status"] == STATUS_DOING]
    done = [r for r in rows if r["status"] == STATUS_DONE]
    return {
        "total": len(rows),
        "doing": len(doing),
        "done": len(done),
        "overdue": len([r for r in doing if r["is_overdue"]]),
        "due_today": len([r for r in doing if r["is_due_today"]]),
        "done_rate": round(len(done) * 100 / len(rows)) if rows else 0,
        "avg_workdays": (round(sum(r["workdays"] for r in done if r["workdays"] is not None)
                               / len([r for r in done if r["workdays"] is not None]), 1)
                         if any(r["workdays"] is not None for r in done) else None),
    }


def counts_by_type() -> dict:
    """侧边栏「类型 → 未完成数量」与全局未完成数量。"""
    rows = db.query("SELECT todo_type, "
                    "SUM(CASE WHEN status=? THEN 1 ELSE 0 END) AS pending, "
                    "COUNT(*) AS total FROM todos GROUP BY todo_type", (STATUS_DOING,))
    by_type = {t: {"pending": 0, "total": 0} for t in TODO_TYPES}
    for r in rows:
        by_type.setdefault(r["todo_type"], {"pending": 0, "total": 0})
        by_type[r["todo_type"]] = {"pending": r["pending"] or 0, "total": r["total"] or 0}
    total_row = db.query_one(
        "SELECT SUM(CASE WHEN status=? THEN 1 ELSE 0 END) AS pending, COUNT(*) AS total FROM todos",
        (STATUS_DOING,)) or {}
    return {"by_type": by_type,
            "pending": total_row.get("pending") or 0,
            "total": total_row.get("total") or 0}


def overdue_list(limit: int = 5) -> list:
    today = cal.fmt(cal.today())
    rows = db.query("SELECT * FROM todos WHERE status=? AND due_date <> '' AND due_date < ? "
                    "ORDER BY due_date ASC, " + PRIORITY_RANK + " ASC LIMIT ?",
                    (STATUS_DOING, today, int(limit)))
    return [decorate(r) for r in rows]
