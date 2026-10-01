@echo off
chcp 65001 >nul
REM 项目管理系统 · 待办清单 — Windows 一键启动
REM 用法：双击本文件，或在命令行执行 start.bat

cd /d "%~dp0"

echo ============================================
echo   项目管理系统 ^| 待办清单
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。
  pause
  exit /b 1
)

python -c "import fastapi, uvicorn" >nul 2>nul
if errorlevel 1 (
  echo [提示] 缺少依赖，正在安装...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [信息] 启动中，稍后会自动打开浏览器...
echo        接口文档 http://127.0.0.1:8000/docs
echo        关闭本窗口即停止服务。
echo.

start "" http://127.0.0.1:8000/
python run.py
pause
