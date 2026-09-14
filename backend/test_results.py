import unittest
from unittest.mock import patch

from backend import results


class SplitResultTests(unittest.TestCase):
    def test_actual_2260_failure_uses_board_filename_and_reason(self):
        log = (
            "2026-09-14 14:11:39,837 INFO 扫描到 1 张未完成图片\n"
            "2026-09-14 14:20:28,188 ERROR "
            "处理失败｜阶段=图片识别失败｜文件=#2260.png；"
            "OCR/版式识别未通过：零件图号在多次 OCR 中不一致，无法安全匹配模板｜"
            "处理建议=重点检查序号后的零件图号是否清晰、完整，以及钢板重量是否可读；"
            "标题栏和程序号不作为失败条件。确认后保留原文件重新执行。"
        )
        status = {
            "status": "failure",
            "run_number": 42,
            "html_url": "https://example.test/run/42",
        }
        with (
            patch.object(results, "get_workflow_status", return_value=status),
            patch.object(results, "_latest_run", return_value={"id": 42}),
            patch.object(results, "_job_log", return_value=log),
        ):
            result = results.get_result("split")

        self.assertEqual(result["completion"]["total"], 1)
        self.assertEqual(len(result["issues"]), 1)
        issue = result["issues"][0]
        self.assertEqual(issue["title"], "#2260")
        self.assertEqual(issue["record_status"], "未拆出结果")
        self.assertIn("图号", issue["cause"])
        self.assertIn("钢板重量", issue["action"])


if __name__ == "__main__":
    unittest.main()
