#!/usr/bin/env bash
# 项目管理系统 · 待办清单 — SQLite 备份脚本
#
# 用法：
#   ./deploy/backup.sh                      # 备份到 ./backups
#   ./deploy/backup.sh /mnt/backup/pms      # 备份到指定目录
#
# 建议加进 crontab（每天 02:30）：
#   30 2 * * * /opt/pms-todo/deploy/backup.sh /var/backups/pms-todo >> /var/log/pms-backup.log 2>&1
#
# 为什么用 sqlite3 .backup 而不是 cp：
#   数据库开启了 WAL 模式，直接复制 .db 可能拿到不含最新事务的半成品；
#   .backup 走 SQLite 在线备份 API，能保证一致性快照。

set -euo pipefail

DATA_DIR="${TODO_DATA_DIR:-/opt/pms-todo/data}"
DB="${TODO_DB:-$DATA_DIR/todo.db}"
DEST="${1:-$(dirname "$0")/../backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/todo-$STAMP.db"

mkdir -p "$DEST"

if [ ! -f "$DB" ]; then
  echo "[backup] 数据库不存在：$DB" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
  echo "[backup] 已备份（sqlite3 .backup）→ $OUT"
else
  # 兜底：用 Python 标准库的 backup API，无需安装 sqlite3 命令行
  python3 - "$DB" "$OUT" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
    s.backup(d)
PY
  echo "[backup] 已备份（python sqlite3.backup）→ $OUT"
fi

# 校验备份可读
python3 - "$OUT" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as c:
    n = c.execute("SELECT COUNT(*) FROM todos").fetchone()[0]
print(f"[backup] 校验通过，todos 记录数：{n}")
PY

# 清理过期备份
if [ "$KEEP_DAYS" -gt 0 ]; then
  find "$DEST" -name 'todo-*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
  echo "[backup] 已清理 $KEEP_DAYS 天前的备份"
fi

echo "[backup] 完成。当前备份数量：$(find "$DEST" -name 'todo-*.db' | wc -l)"
