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
        self.assertEqual(result["completion"]["unit"], "个图纸文件")
        self.assertEqual(len(result["issues"]), 1)
        issue = result["issues"][0]
        self.assertEqual(issue["title"], "#2260")
        self.assertEqual(issue["record_status"], "未拆出结果")
        self.assertIn("图号", issue["cause"])
        self.assertIn("钢板重量", issue["action"])

    def test_pdf_native_text_log_uses_drawing_file_unit_and_clean_board_id(self):
        log = (
            "2026-09-16 14:55:00,100 INFO 扫描到 2 个未完成图纸文件（图片/PDF）\n"
            "2026-09-16 14:55:05,100 INFO PDF 原生文本解析成功：#2330 T30退0.pdf（未使用 OCR）\n"
            "2026-09-16 14:55:10,100 INFO 处理完成：#2330 T30退0.pdf -> #2330_完成.xlsx\n"
            "2026-09-16 14:55:12,100 ERROR 处理失败｜阶段=PDF 内容提取失败｜文件=#2331 T40.pdf；"
            "PDF 原生文本提取未通过：未能识别图片标注钢板重量；OCR 回退也未通过：未能识别图片标注钢板重量｜"
            "处理建议=确认 PDF 由 FastNEST/FastCAM 正常导出。"
        )
        status = {"status": "failure", "run_number": 44, "html_url": "https://example.test/run/44"}
        with (
            patch.object(results, "get_workflow_status", return_value=status),
            patch.object(results, "_latest_run", return_value={"id": 44}),
            patch.object(results, "_job_log", return_value=log),
        ):
            result = results.get_result("split")

        self.assertEqual(result["completion"], {"percent": 50, "completed": 1, "total": 2, "unit": "个图纸文件"})
        self.assertEqual(result["successes"][0]["title"], "#2330")
        self.assertEqual(result["issues"][0]["title"], "#2331")
        self.assertIn("PDF 内容提取失败", result["issues"][0]["cause"])

    def test_parts_result_uses_board_filename_not_order_name(self):
        log = (
            "INFO 板材处理结果｜文件=#2330_完成.xlsm｜板材=#2330｜"
            "状态=已累计、仅补归档｜原因=累计台账已有相同内容记录，本次未重复累计｜处理建议=无\n"
            "WARNING 板材处理结果｜文件=#2236_完成.xlsm｜板材=#2236｜"
            "状态=未累计、未记录｜原因=BHDR 对应订单不在正在加工｜"
            "处理建议=补齐正式原始汇总表后重新执行。"
        )
        status = {"status": "failure", "run_number": 43, "html_url": "https://example.test/run/43"}
        with (
            patch.object(results, "get_workflow_status", return_value=status),
            patch.object(results, "_latest_run", return_value={"id": 43}),
            patch.object(results, "_job_log", return_value=log),
        ):
            result = results.get_result("parts")

        self.assertEqual([item["title"] for item in result["board_results"]], ["#2330", "#2236"])
        self.assertEqual(result["board_results"][0]["record_status"], "已累计、仅补归档")
        self.assertEqual(result["board_results"][1]["record_status"], "未累计、未记录")
        self.assertIn("BHDR", result["board_results"][1]["cause"])
        self.assertEqual(result["completion"], {"percent": 100, "completed": 2, "total": 2, "unit": "张板材"})
        self.assertEqual(result["status"], "partial")

    def test_parts_latest_log_counts_seven_boards_not_twenty_two_orders(self):
        log = (
            "INFO 发现订单原始汇总表 22 个\n"
            "INFO 拆图结果根目录待处理完成文件 7 个\n"
            "INFO 板材处理结果｜文件=#2287_完成.xlsx｜板材=#2287｜状态=已累计、仅补归档｜"
            "原因=累计台账已有相同内容记录，本次未重复累计｜处理建议=无\n"
            "WARNING 板材处理结果｜文件=#2203_完成.xlsx｜板材=#2203｜状态=未累计、未记录｜原因=无匹配零件｜处理建议=核对资料\n"
            "WARNING 板材处理结果｜文件=#2236_完成.xlsx｜板材=#2236｜状态=未累计、未记录｜原因=无匹配零件｜处理建议=核对资料\n"
            "WARNING 板材处理结果｜文件=#2260_完成.xlsx｜板材=#2260｜状态=未累计、未记录｜原因=无匹配零件｜处理建议=核对资料\n"
            "WARNING 板材处理结果｜文件=#2326_完成.xlsx｜板材=#2326｜状态=未累计、未记录｜原因=无法安全复核｜处理建议=核对资料\n"
            "WARNING 板材处理结果｜文件=#2333_完成.xlsx｜板材=#2333｜状态=未累计、未记录｜原因=无法安全复核｜处理建议=核对资料\n"
            "WARNING 板材处理结果｜文件=#2336_完成.xlsx｜板材=#2336｜状态=未累计、未记录｜原因=无匹配零件｜处理建议=核对资料\n"
        )
        status = {"status": "success", "run_number": 56, "html_url": "https://example.test/run/56"}
        with (
            patch.object(results, "get_workflow_status", return_value=status),
            patch.object(results, "_latest_run", return_value={"id": 56}),
            patch.object(results, "_job_log", return_value=log),
        ):
            result = results.get_result("parts")

        self.assertEqual(result["completion"], {"percent": 100, "completed": 7, "total": 7, "unit": "张板材"})
        self.assertEqual(len(result["board_results"]), 7)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["summary"], ["本次扫描 7 张板材：已处理 1 张，未成功 6 张"])


if __name__ == "__main__":
    unittest.main()
