"""工作日运算（用于「完成后自动计算工作日」）。

规则
----
* 默认周一至周五为工作日；
* holidays 表中 kind='holiday' 的日期 -> 休息日（不算工作日）；
* holidays 表中 kind='workday' 的日期 -> 补班日（即使是周末也算工作日）；
* 表中同时存在时，补班日优先。
"""
from datetime import date, timedelta

from .. import db
from ..config import DEFAULT_REGION, WEEKEND

FMT = "%Y-%m-%d"
WEEKDAY_CN = ["一", "二", "三", "四", "五", "六", "日"]


# ------------------------------------------------------------------ 日期基础
def parse(d):
    if isinstance(d, date):
        return d
    if not d:
        return None
    return date.fromisoformat(str(d)[:10])


def fmt(d) -> str:
    return d.strftime(FMT) if d else ""


def today() -> date:
    return date.today()


def weekday_cn(d) -> str:
    d = parse(d)
    return WEEKDAY_CN[d.weekday()] if d else ""


# ------------------------------------------------------------------ 节假日数据
def holiday_map(region: str | None = None, year: int | None = None) -> dict:
    """{date_str: {'kind','name','id'}}"""
    region = region or db.get_setting("region", DEFAULT_REGION)
    sql = "SELECT id, date, name, kind, region FROM holidays WHERE (region = ? OR region IN ('', 'ALL'))"
    params = [region]
    if year:
        sql += " AND date LIKE ?"
        params.append(f"{year}-%")
    out = {}
    for r in db.query(sql, params):
        prev = out.get(r["date"])
        if prev and prev["kind"] == "workday":
            continue
        out[r["date"]] = {"id": r["id"], "kind": r["kind"], "name": r["name"],
                          "region": r["region"]}
    return out


def is_workday(d, hmap: dict | None = None) -> bool:
    d = parse(d)
    if not d:
        return False
    hmap = holiday_map() if hmap is None else hmap
    info = hmap.get(fmt(d))
    if info:
        return info["kind"] == "workday"
    return d.weekday() not in WEEKEND


def first_workday_on_or_after(d, hmap: dict | None = None):
    d = parse(d)
    hmap = holiday_map() if hmap is None else hmap
    while not is_workday(d, hmap):
        d += timedelta(days=1)
    return d


def next_workday(d, hmap: dict | None = None):
    return first_workday_on_or_after(parse(d) + timedelta(days=1), hmap)


def list_workdays(start, end, hmap: dict | None = None) -> list:
    start, end = parse(start), parse(end)
    if not start or not end or end < start:
        return []
    hmap = holiday_map() if hmap is None else hmap
    out, cur = [], start
    while cur <= end:
        if is_workday(cur, hmap):
            out.append(cur)
        cur += timedelta(days=1)
    return out


def count_workdays(start, end, hmap: dict | None = None) -> int:
    return len(list_workdays(start, end, hmap))


def add_workdays(start, n: int, hmap: dict | None = None):
    """从 start 起算第 n 个工作日（start 当天算第 1 天）。"""
    hmap = holiday_map() if hmap is None else hmap
    cur = first_workday_on_or_after(start, hmap)
    if n <= 0:
        return cur
    left = n - 1
    while left > 0:
        cur = next_workday(cur, hmap)
        left -= 1
    return cur


def business_duration(start, end) -> dict:
    """两个时间点之间的工作日耗时（用于「完成后自动计算工作日」）。

    完成时间早于创建时间时按 0 处理；同一天中午前完成记 1 个工作日。
    """
    s, e = parse(start), parse(end)
    if not s or not e:
        return {"workdays": 0, "calendar_days": 0, "start": fmt(s), "end": fmt(e)}
    if e < s:
        return {"workdays": 0, "calendar_days": 0, "start": fmt(s), "end": fmt(e)}
    return {
        "workdays": count_workdays(s, e),
        "calendar_days": (e - s).days + 1,
        "start": fmt(s),
        "end": fmt(e),
    }


# ------------------------------------------------------------------ 节假日 CRUD
def list_holidays(year: int | None = None, region: str | None = None,
                  kind: str | None = None) -> list:
    sql, params = "SELECT * FROM holidays WHERE 1=1", []
    if year:
        sql += " AND date LIKE ?"
        params.append(f"{year}-%")
    if region:
        sql += " AND region = ?"
        params.append(region)
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    sql += " ORDER BY date"
    return db.query(sql, params)


def upsert_holiday(payload: dict) -> dict:
    date_s = fmt(parse(payload.get("date")))
    if not date_s:
        raise ValueError("date 必填，格式 YYYY-MM-DD")
    kind = payload.get("kind") or "holiday"
    if kind not in ("holiday", "workday"):
        raise ValueError("kind 只能为 holiday(休息日) 或 workday(补班日)")
    region = payload.get("region") or db.get_setting("region", DEFAULT_REGION)
    name = (payload.get("name") or "").strip()
    hid = payload.get("id")
    if hid:
        db.execute("UPDATE holidays SET date=?, name=?, kind=?, region=? WHERE id=?",
                   (date_s, name, kind, region, int(hid)))
        return db.query_one("SELECT * FROM holidays WHERE id=?", (int(hid),))
    row = db.query_one("SELECT id FROM holidays WHERE date=? AND region=?", (date_s, region))
    if row:
        db.execute("UPDATE holidays SET name=?, kind=? WHERE id=?", (name, kind, row["id"]))
        return db.query_one("SELECT * FROM holidays WHERE id=?", (row["id"],))
    new_id = db.execute(
        "INSERT INTO holidays(date, name, kind, region, created_at) VALUES (?,?,?,?,?)",
        (date_s, name, kind, region, db.now()))
    return db.query_one("SELECT * FROM holidays WHERE id=?", (new_id,))


def delete_holiday(hid: int) -> bool:
    return db.execute_rowcount("DELETE FROM holidays WHERE id=?", (int(hid),)) > 0
