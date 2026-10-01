"""SQLite 访问层（标准库，无 ORM）。

设计要点
--------
* 每次调用使用短生命周期连接 -> 与 FastAPI 线程池 / 多 worker 兼容；
* 幂等 DDL + PRAGMA user_version 迁移列表 -> 后续加字段只追加一条；
* 所有 service 只通过本文件的 helper 访问数据库，将来换库只改这里。
"""
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime

from .config import DATA_DIR, DB_PATH

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS todos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    todo_type     TEXT NOT NULL DEFAULT '研发项目',
    status        TEXT NOT NULL DEFAULT '进行中',
    priority      TEXT NOT NULL DEFAULT 'P1',
    remark        TEXT NOT NULL DEFAULT '',
    due_date      TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    completed_at  TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'holiday',   -- holiday=休息日, workday=补班日
    region     TEXT NOT NULL DEFAULT 'CN',
    created_at TEXT NOT NULL,
    UNIQUE (date, region)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_todos_status   ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_type     ON todos(todo_type);
CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
CREATE INDEX IF NOT EXISTS idx_todos_created  ON todos(created_at);
CREATE INDEX IF NOT EXISTS idx_holiday_date   ON holidays(date);
"""

MIGRATIONS = [
    # (version, sql) —— 模型演进时在此追加，启动时按 PRAGMA user_version 顺序执行
]


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_conn() -> sqlite3.Connection:
    """线程内复用连接（回退服务器 / 测试用）。"""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = connect()
        _local.conn = conn
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with tx() as conn:
        conn.executescript(SCHEMA)
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for ver, sql in MIGRATIONS:
            if version < ver:
                conn.executescript(sql)
                conn.execute(f"PRAGMA user_version = {ver}")
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('region', 'CN')")
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', '1')")


# ------------------------------------------------------------------ 小工具
def query(sql: str, params=()) -> list:
    with tx() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def query_one(sql: str, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params=()) -> int:
    with tx() as conn:
        return conn.execute(sql, params).lastrowid


def execute_rowcount(sql: str, params=()) -> int:
    with tx() as conn:
        return conn.execute(sql, params).rowcount


def get_setting(key: str, default: str = "") -> str:
    row = query_one("SELECT value FROM settings WHERE key = ?", (key,))
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    execute("INSERT INTO settings(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))
