"""全局配置：枚举口径 + 常量 + 路径（改这里即可调整下拉选项）。

字段口径来自需求「项目管理系统 1.0 - 待办清单」：
    事项 / 类型 / 状态 / 优先级 / 创建时间 / 完成时间 / 备注
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv() -> None:
    """把项目根目录的 .env 读进环境变量（不覆盖已存在的真实环境变量）。

    零依赖实现，避免为了读配置引入 python-dotenv。
    """
    path = os.path.join(BASE_DIR, ".env")
    if not os.path.isfile(path):
        return
    try:
        # utf-8-sig：兼容 Windows 记事本/PowerShell 写出的带 BOM 的 .env
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


_load_dotenv()

DATA_DIR = os.environ.get("TODO_DATA_DIR") or os.path.join(BASE_DIR, "data")
DB_PATH = os.environ.get("TODO_DB") or os.path.join(DATA_DIR, "todo.db")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

APP_NAME = "项目管理系统 · 待办清单"
APP_VERSION = "1.0.0"

# ---- 枚举（单一事实来源：后端校验 + 前端下拉都读这里） -----------------------
TODO_TYPES = ["对外商务", "集团内部沟通", "研发项目"]

STATUS_DOING = "进行中"
STATUS_DONE = "已完成"
TODO_STATUS = [STATUS_DOING, STATUS_DONE]

PRIORITIES = ["P0", "P1", "P2"]

# 状态 / 优先级配色（前端通过 /api/meta 获取，避免两端写死不一致）
STATUS_COLORS = {
    STATUS_DOING: "#f5c542",   # 进行中 = 黄色
    STATUS_DONE: "#cbd5e1",    # 已完成 = 灰色
}
STATUS_TEXT_COLORS = {
    STATUS_DOING: "#7c5c00",
    STATUS_DONE: "#5b6472",
}
PRIORITY_COLORS = {
    "P0": "#ef4444",   # 红
    "P1": "#3b82f6",   # 蓝
    "P2": "#22c55e",   # 绿
}

# ---- 字段限制 ---------------------------------------------------------------
REMARK_MAX_LEN = 1000      # 备注最多 1000 字
TITLE_MAX_LEN = 200        # 事项标题上限（放宽，允许中英文/数字/特殊字符）

# ---- 工作日口径 -------------------------------------------------------------
# 默认勾选的周末（5=周六, 6=周日）；holidays 表可覆盖某天（含补班日）
WEEKEND = (5, 6)
# 未配置节假日表时，自动把中国法定节假日名称套用到对应日期上
BUILTIN_HOLIDAY_NAMES = (
    "元旦", "春节", "清明节", "劳动节", "端午节", "中秋节", "国庆节", "国庆中秋",
)

DEFAULT_REGION = os.environ.get("TODO_REGION", "CN")
