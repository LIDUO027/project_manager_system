"""端到端接口测试（标准库 unittest + fastapi TestClient）。

    python -m unittest discover -s tests -v

使用临时数据库，不会污染 data/todo.db。
"""
import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

_TMP = tempfile.mkdtemp(prefix="pms_todo_test_")
os.environ["TODO_DATA_DIR"] = _TMP
os.environ["TODO_DB"] = os.path.join(_TMP, "test.db")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient          # noqa: E402

from app import db                                  # noqa: E402
from app.main import app                            # noqa: E402
from app.services import calendar_service as cal    # noqa: E402
from app.services import todo_service as todos      # noqa: E402

client = TestClient(app)


def reset():
    for t in ("todos", "holidays"):
        db.execute(f"DELETE FROM {t}")


class TestMetaAndShell(unittest.TestCase):
    def test_health_and_meta(self):
        self.assertEqual(client.get("/api/health").json(), {"status": "ok"})
        m = client.get("/api/meta").json()
        self.assertEqual(m["enums"]["todo_types"], ["对外商务", "集团内部沟通", "研发项目"])
        self.assertEqual(m["enums"]["priorities"], ["P0", "P1", "P2"])
        self.assertEqual(m["enums"]["todo_status"], ["进行中", "已完成"])
        self.assertEqual(m["colors"]["status"]["进行中"], "#f5c542")
        self.assertEqual(m["colors"]["status"]["已完成"], "#cbd5e1")
        self.assertEqual(m["colors"]["priority"]["P0"], "#ef4444")
        self.assertEqual(m["limits"]["remark_max"], 1000)

    def test_page_and_docs_served(self):
        r = client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("待办清单", r.text)
        self.assertEqual(client.get("/docs").status_code, 200)


class TestTodoCrud(unittest.TestCase):
    def setUp(self):
        reset()

    def test_create_defaults_and_special_chars(self):
        title = "Review 「Zalopay」Auto-Debit 协议 v2 (#42) — 金额 ≤ $1,000 & 有<b>标签</b>"
        r = client.post("/api/todos", json={"title": title})
        self.assertEqual(r.status_code, 201)
        t = r.json()
        self.assertEqual(t["title"], title)                 # 特殊字符原样保存
        self.assertEqual(t["todo_type"], "研发项目")          # 默认类型
        self.assertEqual(t["priority"], "P1")               # 默认优先级
        self.assertEqual(t["status"], "进行中")
        self.assertTrue(t["created_at"])
        self.assertEqual(t["completed_at"], "")
        self.assertFalse(t["is_done"])

    def test_required_title(self):
        self.assertEqual(client.post("/api/todos", json={"title": "   "}).status_code, 400)
        self.assertEqual(client.post("/api/todos", json={}).status_code, 400)

    def test_enum_validation(self):
        self.assertEqual(client.post("/api/todos", json={"title": "x", "todo_type": "私事"}).status_code, 400)
        self.assertEqual(client.post("/api/todos", json={"title": "x", "priority": "P9"}).status_code, 400)
        self.assertEqual(client.post("/api/todos", json={"title": "x", "status": "挂了"}).status_code, 400)

    def test_remark_limit_1000(self):
        ok = client.post("/api/todos", json={"title": "长备注", "remark": "字" * 1000})
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(len(ok.json()["remark"]), 1000)
        too_long = client.post("/api/todos", json={"title": "超长", "remark": "字" * 1001})
        self.assertEqual(too_long.status_code, 422)          # pydantic 长度校验

    def test_update_is_partial(self):
        tid = client.post("/api/todos", json={"title": "原始", "priority": "P1"}).json()["id"]
        r = client.patch(f"/api/todos/{tid}", json={"priority": "P0"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["priority"], "P0")
        self.assertEqual(r.json()["title"], "原始")           # 未传字段保持不变

    def test_delete_and_404(self):
        tid = client.post("/api/todos", json={"title": "待删除"}).json()["id"]
        self.assertEqual(client.delete(f"/api/todos/{tid}").json(), {"deleted": True})
        self.assertEqual(client.get(f"/api/todos/{tid}").status_code, 404)
        self.assertEqual(client.delete(f"/api/todos/{tid}").status_code, 404)


class TestCompletedWorkdays(unittest.TestCase):
    """完成后自动计算工作日：2026-01-05 是周一，01-07 设为休息日。"""

    def setUp(self):
        reset()
        cal.upsert_holiday({"date": "2026-01-07", "name": "测试假日", "kind": "holiday"})
        cal.upsert_holiday({"date": "2026-01-10", "name": "补班", "kind": "workday"})

    def test_workday_rules(self):
        self.assertTrue(cal.is_workday("2026-01-05"))        # 周一
        self.assertFalse(cal.is_workday("2026-01-07"))       # 休息日
        self.assertTrue(cal.is_workday("2026-01-10"))        # 周六但补班
        self.assertFalse(cal.is_workday("2026-01-11"))       # 周日
        self.assertEqual(cal.fmt(cal.next_workday("2026-01-06")), "2026-01-08")
        self.assertEqual(cal.count_workdays("2026-01-05", "2026-01-11"), 5)

    def test_business_duration(self):
        d = cal.business_duration("2026-01-05", "2026-01-11")
        self.assertEqual(d["workdays"], 5)                   # 05,06,08,09,10
        self.assertEqual(d["calendar_days"], 7)

    def test_completion_sets_timestamp_and_workdays(self):
        tid = client.post("/api/todos", json={"title": "跨周任务"}).json()["id"]
        db.execute("UPDATE todos SET created_at='2026-01-05 09:00:00' WHERE id=?", (tid,))
        r = client.post(f"/api/todos/{tid}/toggle").json()
        self.assertEqual(r["status"], "已完成")
        self.assertTrue(r["completed_at"])
        self.assertIsNotNone(r["workdays"])

        # 用一个确定的完成时间再算一次
        db.execute("UPDATE todos SET completed_at='2026-01-09 18:00:00' WHERE id=?", (tid,))
        got = client.get(f"/api/todos/{tid}").json()
        self.assertEqual(got["workdays"], 4)                 # 05,06,08,09
        self.assertEqual(got["workdays_text"], "4 个工作日")
        self.assertEqual(got["calendar_days"], 5)

    def test_toggle_back_clears_completed_at(self):
        tid = client.post("/api/todos", json={"title": "反复横跳"}).json()["id"]
        client.post(f"/api/todos/{tid}/toggle")
        back = client.post(f"/api/todos/{tid}/toggle").json()
        self.assertEqual(back["status"], "进行中")
        self.assertEqual(back["completed_at"], "")
        self.assertIsNone(back["workdays"])

    def test_overdue_flags(self):
        past = cal.fmt(cal.today() - timedelta(days=3))
        today = cal.fmt(cal.today())
        a = client.post("/api/todos", json={"title": "逾期项", "due_date": past}).json()
        b = client.post("/api/todos", json={"title": "今天到期", "due_date": today}).json()
        self.assertTrue(a["is_overdue"])
        self.assertTrue(b["is_due_today"])
        s = client.get("/api/todos/summary").json()["summary"]
        self.assertEqual(s["overdue"], 1)
        self.assertEqual(s["due_today"], 1)


class TestListFilterSort(unittest.TestCase):
    def setUp(self):
        reset()
        client.post("/api/todos", json={"title": "对外 A", "todo_type": "对外商务", "priority": "P0"})
        client.post("/api/todos", json={"title": "内部 B", "todo_type": "集团内部沟通", "priority": "P2"})
        t = client.post("/api/todos", json={"title": "研发 C", "todo_type": "研发项目",
                                            "priority": "P1", "remark": "关键字-灰度"}).json()
        client.post(f"/api/todos/{t['id']}/toggle")

    def test_default_newest_first(self):
        items = client.get("/api/todos").json()["items"]
        self.assertEqual([i["title"] for i in items][0], "研发 C")

    def test_filter_by_status_type_priority(self):
        self.assertEqual(len(client.get("/api/todos", params={"status": "doing"}).json()["items"]), 2)
        self.assertEqual(len(client.get("/api/todos", params={"status": "done"}).json()["items"]), 1)
        self.assertEqual(len(client.get("/api/todos", params={"todo_type": "对外商务"}).json()["items"]), 1)
        self.assertEqual(len(client.get("/api/todos", params={"priority": "P0"}).json()["items"]), 1)

    def test_search_hits_title_and_remark(self):
        self.assertEqual(len(client.get("/api/todos", params={"q": "研发"}).json()["items"]), 1)
        self.assertEqual(len(client.get("/api/todos", params={"q": "灰度"}).json()["items"]), 1)
        self.assertEqual(len(client.get("/api/todos", params={"q": "不存在"}).json()["items"]), 0)

    def test_sort_by_priority(self):
        items = client.get("/api/todos", params={"sort": "priority", "order": "asc"}).json()["items"]
        self.assertEqual([i["priority"] for i in items], ["P0", "P1", "P2"])

    def test_summary_and_counts_respect_filter(self):
        body = client.get("/api/todos", params={"todo_type": "对外商务"}).json()
        self.assertEqual(body["summary"]["total"], 1)
        self.assertEqual(body["counts"]["total"], 3)          # 全局计数不受筛选影响
        self.assertEqual(body["counts"]["pending"], 2)
        by_type = body["counts"]["by_type"]
        self.assertEqual(by_type["研发项目"]["pending"], 0)
        self.assertEqual(by_type["集团内部沟通"]["pending"], 1)

    def test_clear_completed(self):
        self.assertEqual(client.delete("/api/todos").json()["deleted"], 1)
        self.assertEqual(len(client.get("/api/todos", params={"status": "done"}).json()["items"]), 0)


class TestSeed(unittest.TestCase):
    def setUp(self):
        reset()

    def test_seed_once_then_skip(self):
        first = client.post("/api/demo/seed", json={}).json()
        self.assertGreater(first["created"], 0)
        again = client.post("/api/demo/seed", json={}).json()
        self.assertEqual(again["created"], 0)
        self.assertTrue(again["skipped"])
        counts = client.get("/api/counts").json()
        self.assertEqual(counts["total"], first["total"])

    def test_seed_reset(self):
        client.post("/api/demo/seed", json={})
        r = client.post("/api/demo/seed", json={"reset": True}).json()
        self.assertGreater(r["created"], 0)
        self.assertEqual(r["total"], r["created"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
