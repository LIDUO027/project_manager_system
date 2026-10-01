"""FastAPI 应用入口（前后端分离：本文件只提供 API + 托管静态前端）。

启动：
    python run.py                    # http://127.0.0.1:8000
    python run.py --reload           # 开发热重载
    uvicorn app.main:app --port 8000
"""
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .config import APP_NAME, APP_VERSION, STATIC_DIR
from .routers.todos import meta_router, sys_router, todo_router

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="项目管理系统的待办清单模块（一期）：事项 / 类型 / 状态 / 优先级 / 创建与完成时间（自动工作日）/ 备注。",
)

# 前后端分离：允许前端独立域名/端口调用（生产环境请收紧 allow_origins）
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

db.init_db()

app.include_router(meta_router)
app.include_router(todo_router)
app.include_router(sys_router)


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/api", include_in_schema=False)
def api_index():
    return {"app": APP_NAME, "version": APP_VERSION, "docs": "/docs",
            "todos": "/api/todos"}


@app.get("/", include_in_schema=False)
def index():
    """待办清单页面（一期唯一页面）。"""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# 静态资源挂最后，避免覆盖 /api 与 /docs
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
