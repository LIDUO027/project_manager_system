"""REST 路由（FastAPI）。业务规则全部在 app/services/*，路由只做参数校验与编排。"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..config import (APP_NAME, APP_VERSION, PRIORITIES, PRIORITY_COLORS, REMARK_MAX_LEN,
                      STATUS_COLORS, STATUS_DOING, STATUS_DONE, STATUS_TEXT_COLORS,
                      TITLE_MAX_LEN, TODO_STATUS, TODO_TYPES)
from ..schemas import HolidayIn, SeedIn, SettingsIn, StatusIn, TodoIn, as_dict
from ..services import calendar_service as cal
from ..services import io_service as pms_io
from ..services import todo_service as todos

meta_router = APIRouter(tags=["元数据"])
todo_router = APIRouter(tags=["待办清单"], prefix="/api/todos")
sys_router = APIRouter(tags=["系统"])


def _run(fn, *args, **kwargs):
    """把 service 的 ValueError 统一转成 400。"""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------ 元数据
@meta_router.get("/api/health", summary="健康检查")
def health():
    return {"status": "ok"}


@meta_router.get("/api/meta", summary="应用信息 / 枚举 / 配色")
def meta():
    counts = todos.counts_by_type()
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "today": cal.fmt(cal.today()),
        "weekday_cn": cal.weekday_cn(cal.today()),
        "region": db.get_setting("region", "CN"),
        "enums": {
            "todo_types": TODO_TYPES,
            "todo_status": TODO_STATUS,
            "priorities": PRIORITIES,
        },
        "colors": {
            "status": STATUS_COLORS,
            "status_text": STATUS_TEXT_COLORS,
            "priority": PRIORITY_COLORS,
        },
        "defaults": {"priority": "P1", "status": STATUS_DOING, "todo_type": TODO_TYPES[0]},
        "limits": {"remark_max": REMARK_MAX_LEN, "title_max": TITLE_MAX_LEN},
        "counts": counts,
    }


@meta_router.get("/api/counts", summary="侧边栏计数（全局 + 按类型未完成）")
def counts():
    return todos.counts_by_type()


@meta_router.get("/api/settings", summary="读取设置")
def get_settings():
    return {"region": db.get_setting("region", "CN")}


@meta_router.put("/api/settings", summary="更新设置")
def put_settings(body: SettingsIn):
    data = as_dict(body)
    if data.get("region"):
        db.set_setting("region", data["region"])
    return {"region": db.get_setting("region", "CN")}


# ------------------------------------------------------------------ 待办清单
@todo_router.get("", summary="待办列表（筛选 / 排序 / 搜索 + 当前筛选统计）")
def list_todos(status: Optional[str] = None, todo_type: Optional[str] = None,
               priority: Optional[str] = None, q: Optional[str] = None,
               sort: str = "created_at", order: str = "desc",
               limit: Optional[int] = None):
    items = todos.list_todos(status=status, todo_type=todo_type, priority=priority,
                             q=q, sort=sort, order=order, limit=limit)
    return {"items": items,
            "summary": todos.summary(status=status, todo_type=todo_type,
                                     priority=priority, q=q),
            "counts": todos.counts_by_type(),
            "query": {"status": status or "all", "todo_type": todo_type or "",
                      "priority": priority or "", "q": q or "",
                      "sort": sort, "order": order}}


@todo_router.get("/summary", summary="统计条数据")
def summary(status: Optional[str] = None, todo_type: Optional[str] = None,
            priority: Optional[str] = None, q: Optional[str] = None):
    return {"summary": todos.summary(status, todo_type, priority, q),
            "counts": todos.counts_by_type(),
            "overdue_list": todos.overdue_list(5)}


@todo_router.get("/counts", summary="计数（全局 + 按类型）")
def todo_counts():
    return todos.counts_by_type()


@todo_router.post("", status_code=201, summary="新建待办")
def create_todo(body: TodoIn):
    return _run(todos.create_todo, as_dict(body))


@todo_router.get("/{tid}", summary="待办详情")
def get_todo(tid: int):
    t = todos.get_todo(tid)
    if not t:
        raise HTTPException(status_code=404, detail="待办不存在")
    return t


@todo_router.put("/{tid}", summary="更新待办（局部更新）")
def update_todo(tid: int, body: TodoIn):
    return _run(todos.update_todo, tid, as_dict(body))


@todo_router.patch("/{tid}", summary="更新待办（同 PUT，语义更贴切）")
def patch_todo(tid: int, body: TodoIn):
    return _run(todos.update_todo, tid, as_dict(body))


@todo_router.post("/{tid}/toggle", summary="切换完成状态（自动记录/清除完成时间）")
def toggle_todo(tid: int):
    return _run(todos.toggle_todo, tid)


@todo_router.post("/{tid}/status", summary="设置状态")
def set_status(tid: int, body: StatusIn):
    return _run(todos.update_status, tid, body.status)


@todo_router.delete("/{tid}", summary="删除待办")
def delete_todo(tid: int):
    if not todos.delete_todo(tid):
        raise HTTPException(status_code=404, detail="待办不存在")
    return {"deleted": True}


@todo_router.delete("", summary="清空已完成")
def clear_done():
    return {"deleted": todos.clear_completed()}


# ------------------------------------------------------------------ 系统 / 工作日
@sys_router.post("/api/demo/seed", summary="写入示例数据（首屏为空时自动调用）")
def demo_seed(body: SeedIn | None = None):
    d = as_dict(body) if body else {}
    return pms_io.seed_demo(reset=bool(d.get("reset")), force=bool(d.get("force")))


@sys_router.get("/api/holidays", summary="节假日 / 补班日列表")
def list_holidays(year: Optional[int] = None, region: Optional[str] = None,
                  kind: Optional[str] = None):
    return cal.list_holidays(year=year, region=region, kind=kind)


@sys_router.post("/api/holidays", summary="新增/覆盖某天（影响工作日计算）")
def create_holiday(body: HolidayIn):
    return _run(cal.upsert_holiday, as_dict(body))


@sys_router.delete("/api/holidays/{hid}", summary="删除节假日")
def delete_holiday(hid: int):
    if not cal.delete_holiday(hid):
        raise HTTPException(status_code=404, detail="节假日不存在")
    return {"deleted": True}


@sys_router.get("/api/calendar/workdays", summary="区间工作日数")
def workdays(start: str = Query(..., description="YYYY-MM-DD"),
             end: str = Query(..., description="YYYY-MM-DD")):
    if not cal.parse(start) or not cal.parse(end):
        raise HTTPException(status_code=400, detail="start / end 需为 YYYY-MM-DD")
    return cal.business_duration(start, end)
