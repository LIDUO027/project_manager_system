"""演示数据 / 维护类接口。"""
from .. import db
from ..config import STATUS_DONE, STATUS_DOING

# (标题, 类型, 状态, 优先级, 创建时间, 完成时间, 截止日期, 备注)
DEMO_ROWS = [
    ("与 Zalopay 签署 Auto Debit 补充协议", "对外商务", STATUS_DOING, "P0",
     "2026-02-02 09:12:00", "", "2026-02-06",
     "越文原件 + 中文译本双份归档；注意签署页需加盖骑缝章。"),
    ("NAPAS E-GETS 合同第 3 轮条款评审", "对外商务", STATUS_DONE, "P1",
     "2026-01-26 14:05:00", "2026-02-03 17:40:00", "2026-02-04",
     "法务已确认结算周期条款，无需再改。"),
    ("集团季度研发例会材料", "集团内部沟通", STATUS_DOING, "P1",
     "2026-02-04 10:00:00", "", "2026-02-10",
     "需附本期排期甘特图与人力投入表。"),
    ("跨部门响应：财务对账口径确认", "集团内部沟通", STATUS_DONE, "P2",
     "2026-01-29 11:20:00", "2026-01-30 16:05:00", "2026-01-30", ""),
    ("EGETS 网关灰度放量方案评审", "研发项目", STATUS_DONE, "P0",
     "2026-01-19 09:30:00", "2026-01-23 18:20:00", "2026-01-23",
     "灰度 5% → 20% → 50%，每档观察 24 小时。"),
    ("排期计算器支持法定节假日与补班日", "研发项目", STATUS_DOING, "P0",
     "2026-02-03 13:45:00", "", "2026-02-07",
     "补班日必须算作工作日，否则上线日会整体前移一天。"),
    ("待办卡片列表接口联调", "研发项目", STATUS_DOING, "P1",
     "2026-02-05 09:05:00", "", "2026-02-12", ""),
    ("移动端 H5 适配（侧边栏折叠）", "研发项目", STATUS_DOING, "P2",
     "2026-02-05 15:30:00", "", "",
     "窄屏下侧边栏收起为顶部抽屉；卡片单列。"),
    ("上线检查单：数据库备份脚本", "研发项目", STATUS_DONE, "P2",
     "2026-01-22 10:15:00", "2026-01-27 11:00:00", "2026-01-28", ""),
]


def seed_demo(reset: bool = False, force: bool = False) -> dict:
    """写入示例待办。默认仅在库为空时写入（首次打开自动铺数据）。"""
    existing = (db.query_one("SELECT COUNT(*) c FROM todos") or {}).get("c", 0)
    if reset:
        db.execute_rowcount("DELETE FROM todos")
        existing = 0
    if existing and not force:
        return {"created": 0, "skipped": True, "reason": "已有数据，未重复写入",
                "total": existing}
    created = 0
    for title, ttype, status, priority, created_at, completed_at, due, remark in DEMO_ROWS:
        db.execute(
            "INSERT INTO todos(title, todo_type, status, priority, remark, due_date, "
            "created_at, completed_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (title, ttype, status, priority, remark, due, created_at, completed_at,
             completed_at or created_at))
        created += 1
    return {"created": created, "skipped": False,
            "total": (db.query_one("SELECT COUNT(*) c FROM todos") or {}).get("c", 0)}


def stats() -> dict:
    row = db.query_one(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN status='进行中' THEN 1 ELSE 0 END) AS doing, "
        "SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) AS done FROM todos") or {}
    return {"total": row.get("total") or 0, "doing": row.get("doing") or 0,
            "done": row.get("done") or 0}
