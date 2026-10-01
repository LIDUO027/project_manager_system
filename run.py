"""启动器：建库 -> （首次）写示例数据 -> 启动 uvicorn。

    python run.py                     # http://127.0.0.1:8000
    python run.py --port 9000 --reload
    python run.py --api-only          # 只跑 API，不做首屏示例数据
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import uvicorn
except ImportError:                                            # pragma: no cover
    print("缺少依赖：请先执行  pip install -r requirements.txt")
    print("（如机器无法联网，也可直接用标准库运行： python server.py）")
    raise SystemExit(1)

from app import db                                           # noqa: E402
from app.services import io_service                          # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description="项目管理系统 · 待办清单")
    p.add_argument("--host", default=os.environ.get("TODO_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("TODO_PORT", "8000")))
    p.add_argument("--reload", action="store_true", help="代码变更自动重启（开发用）")
    p.add_argument("--api-only", action="store_true", help="不写入首屏示例数据")
    p.add_argument("--reset-demo", action="store_true", help="清空待办后重新写入示例数据")
    args = p.parse_args()

    db.init_db()
    if args.reset_demo:
        info = io_service.seed_demo(reset=True)
        print(f"已重置示例数据：{info['created']} 条")
    elif not args.api_only:
        info = io_service.seed_demo()
        if info.get("created"):
            print(f"首次启动，已写入示例待办 {info['created']} 条（可随时删除）")

    print(f"\n  待办清单 →  http://{args.host}:{args.port}/")
    print(f"  接口文档 →  http://{args.host}:{args.port}/docs\n")
    uvicorn.run("app.main:app" if args.reload else _app(), host=args.host,
                port=args.port, reload=args.reload, log_level="info")


def _app():
    from app.main import app
    return app


if __name__ == "__main__":
    main()
