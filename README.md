# 项目管理系统 1.0 · 待办清单（一期）

前后端分离的轻量级项目管理系统。**一期只做「待办清单」**，其余菜单占位、二期开放。

* 后端：**FastAPI**（REST API，自带 `/docs` 交互式接口文档）
* 前端：**原生 JS + CSS**，零第三方依赖、零 CDN，离线机器可直接跑
* 存储：**SQLite**（标准库 `sqlite3`，无 ORM）
* 完成待办时**自动计算工作日耗时**（跳过周末，支持法定节假日与补班日）

---

## 1. 快速开始

```bash
cd todo-app

# 1) 安装依赖
python -m pip install -r requirements.txt

# 2) 启动（首次启动会自动写入一组示例待办，方便直接看到效果）
python run.py                     # http://127.0.0.1:8000
```

打开 <http://127.0.0.1:8000/> 即待办清单页面；<http://127.0.0.1:8000/docs> 是接口文档。

```bash
python run.py --port 9000          # 换端口
python run.py --reload             # 开发热重载
python run.py --reset-demo         # 清空待办并重写示例数据
python run.py --api-only           # 只跑 API，不写示例数据
```

环境变量（也可写在项目根目录 `.env`，见 `.env.example`）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `TODO_HOST` | 监听地址 | `127.0.0.1` |
| `TODO_PORT` | 监听端口 | `8000` |
| `TODO_DATA_DIR` | 数据目录 | `./data` |
| `TODO_DB` | 数据库文件 | `<数据目录>/todo.db` |
| `TODO_REGION` | 默认地区（节假日归属） | `CN` |

## 2. 测试

```bash
# 后端 21 项：接口契约、CRUD、校验、工期计算、筛选排序、示例数据
python -m unittest discover -s tests -p "test_*.py" -v

# 前端 25 项：真实执行 static/js/*.js，断言卡片渲染与交互（无需 npm install）
node tests/test_frontend.mjs
```

前端测试用一个内建的最小 DOM 实现（`tests/test_frontend.mjs` 内），
**直接解析真实的 `index.html`** 构建页面骨架，所以 DOM 结构与浏览器一致；
也不依赖 jsdom 等外部包，离线可跑。

## 3. 功能对照

| 需求 | 实现 |
|---|---|
| 左侧菜单栏，**待办清单排第一位** | `index.html` 侧边栏，`app.js` 中 `MENUS[0]`；其余菜单标注「二期」且不可进入 |
| 侧栏顶部显示**当前日期 yyyy-mm-dd 星期\*** | 侧栏日期卡片（取系统当天，前端计算，不依赖网络） |
| 侧栏显示**待办数量** | `GET /api/counts` 的全局未完成数，显示为「N 项待办未完成」 |
| **事项**：支持中英文、数字、特殊字符 | 后端不做字符白名单，仅限长度（≤200）；前端用 `textContent` 渲染并转义，`「」≤&<img>` 等原样保存显示 |
| **类型**：对外商务 / 集团内部沟通 / 研发项目 | `config.TODO_TYPES` 单一事实来源，后端校验 + 前端下拉 |
| **状态**：进行中（黄）/ 已完成（灰） | `TODO_STATUS` + `STATUS_COLORS`（`#f5c542` / `#cbd5e1`） |
| **优先级**：P0 红 / P1 蓝 / P2 绿 | `PRIORITIES` + `PRIORITY_COLORS`（`#ef4444` / `#3b82f6` / `#22c55e`） |
| **创建时间** | 新建时自动写入 `created_at` |
| **完成时间**（完成后自动计算工作日） | 状态置「已完成」时自动写 `completed_at`；服务端按工作日口径计算 `workdays` / `calendar_days`，卡片显示「耗时 N 个工作日（自然日 M 天）」 |
| **备注**：文本框，最多 1000 字 | `REMARK_MAX_LEN=1000`：前端 `maxlength` + 实时字数统计，后端 pydantic + service 双重校验 |
| 前后端分离，后端 FastAPI | 前端只通过 REST 调用 `/api/*`；已开启 CORS，前端可独立部署（改 `js/config.js` 的 `API_BASE`） |
| 交互：创建 / 删除 / 编辑 | 点卡片或「✎」编辑；「🗑」删除（二次确认）；「＋ 新建待办」新建（Ctrl/⌘+Enter 保存）；「标记完成」一键切换 |
| 样式要**卡片样式**，不要列表 | 响应式卡片网格（`article.card`，自适应列数），带优先级色条、状态/优先级/类型标签、完成耗时条；窄屏自动单列 |

额外顺手做的（不改变上述口径）：搜索（标题/备注，命中高亮）、状态页签、优先级筛选、
类型筛选、7 种排序、逾期与今日到期提醒、清空已完成、快捷键（`n` 新建、`/` 搜索、`Esc` 关闭）。

## 4. 目录结构

```
todo-app/
├─ run.py                    启动器（建库 → 首个示例数据 → uvicorn）
├─ requirements.txt          fastapi / uvicorn / pydantic
├─ .env.example
├─ app/
│  ├─ main.py                FastAPI 应用：挂路由 + 托管静态前端 + CORS
│  ├─ config.py              枚举口径、配色、字段限制、路径（改这里即可调选项）
│  ├─ db.py                  SQLite 连接 / 建表 DDL / user_version 迁移
│  ├─ schemas.py             pydantic 请求模型（含长度校验）
│  ├─ routers/todos.py       REST 路由（元数据 / 待办 / 系统）
│  ├─ services/
│  │  ├─ calendar_service.py  工作日运算：周末、法定节假日、补班日、工期
│  │  ├─ todo_service.py      待办 CRUD、筛选排序、统计、完成时间打点
│  │  └─ io_service.py        示例数据
│  └─ static/                前端（零依赖）
│     ├─ index.html
│     ├─ css/styles.css
│     └─ js/{config,utils,api,ui,todo,app}.js
├─ deploy/
│  ├─ pms-todo.service       systemd 服务单元（非 root 运行、崩溃自启）
│  ├─ nginx.conf             Nginx 反向代理（含 HTTPS / Basic Auth / 限流示例）
│  └─ backup.sh              SQLite 一致性备份脚本（保留 N 天）
├─ docs/
│  ├─ DESIGN.md              系统设计说明书（架构 / 数据模型 / 算法 / 扩展）
│  └─ DEPLOY.md              云服务器部署完整流程（Ubuntu/Debian 逐步操作）
└─ tests/
   ├─ test_todo_api.py       后端 21 项
   └─ test_frontend.mjs      前端 25 项（自建 DOM，无需 npm）
```

## 5. 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 应用信息、枚举、配色、限制、计数 |
| GET | `/api/counts` | 侧栏计数（全局 + 按类型未完成） |
| GET | `/api/todos` | 列表：`status` / `todo_type` / `priority` / `q` / `sort` / `order` / `limit`，同时返回当前筛选的 `summary` |
| POST | `/api/todos` | 新建（201） |
| GET | `/api/todos/{id}` | 详情 |
| PUT·PATCH | `/api/todos/{id}` | 局部更新 |
| POST | `/api/todos/{id}/toggle` | 切换完成状态（自动记录/清除完成时间） |
| POST | `/api/todos/{id}/status` | 显式设置状态 |
| DELETE | `/api/todos/{id}` | 删除 |
| DELETE | `/api/todos` | 清空已完成 |
| GET | `/api/todos/summary` | 统计条数据 |
| POST | `/api/demo/seed` | 写入示例数据（`{reset:true}` 先清空） |
| GET·POST·DELETE | `/api/holidays` | 维护法定节假日 / 补班日（影响工作日计算） |
| GET | `/api/calendar/workdays` | 区间工作日数（`?start=&end=`） |

错误统一为 `{"detail": "中文原因"}`：业务校验 400、pydantic 校验 422、不存在 404。

## 6. 工作日口径

1. 周一至周五为工作日；
2. `holidays` 表中 `kind='holiday'`（法定休息日）不算工作日；
3. `holidays` 表中 `kind='workday'`（补班日，通常是周末）**算**工作日；
4. 同一天两者冲突时，**补班日优先**。

例：2026-01-19（周一）→ 2026-01-23（周五）= 5 个工作日 / 自然日 5；
2026-01-22（周四）→ 2026-01-27（周二，跨周末）= 4 个工作日 / 自然日 6。

节假日默认只按周末规则计算；如需精确口径，用下面的接口把当年度安排写入：

```bash
curl -X POST http://127.0.0.1:8000/api/holidays \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-10-01","name":"国庆节","kind":"holiday"}'

curl -X POST http://127.0.0.1:8000/api/holidays \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-10-10","name":"国庆补班","kind":"workday"}'
```

## 7. 部署到云服务器

见 **[docs/DEPLOY.md](docs/DEPLOY.md)** —— Ubuntu/Debian 上从建用户、装依赖、
systemd 常驻、Nginx 反向代理、HTTPS、访问密码到备份恢复的完整分步流程。

仓库已内置部署产物，直接复用：

| 文件 | 用途 |
|---|---|
| `deploy/pms-todo.service` | systemd 单元（非 root 运行、崩溃自启、目录加固） |
| `deploy/nginx.conf` | Nginx 反向代理（含 HTTPS / Basic Auth / 静态缓存 / 限流示例） |
| `deploy/backup.sh` | SQLite 一致性备份（`.backup` API，非 `cp`），保留 N 天，可挂 crontab |

架构：`浏览器 → Nginx(80/443) → uvicorn(127.0.0.1:8000) → SQLite`。
uvicorn 只监听回环地址，8000 **不需要**在安全组放行。

## 8. 前端独立部署（可选）

前端是纯静态文件，可放到 Nginx / 任意静态服务器；只需在 `js/config.js` 里把
`API_BASE` 指向后端地址（例如 `http://127.0.0.1:8000`）即可，后端已允许跨域。
同源部署（默认）则无需任何配置。

## 9. 二期预留

`app/static/js/app.js` 的 `MENUS` 已列好迭代排期 / 需求管理 / 人员投入 / 数据看板 / 系统设置，
数据模型与迁移机制（`db.MIGRATIONS`）也已就绪，按需增量扩展即可，详见 `docs/DESIGN.md`。
