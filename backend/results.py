"""Convert the latest GitHub Actions run into a concise operator-facing result."""

import io
import re
import zipfile

import requests

from .github_status import WORKFLOWS, get_workflow_status


def _headers() -> dict:
    import os
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token := os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _split_board_id(filename: str) -> str:
    """待拆板材编号取文件名首段，兼容图片和 PDF，并保留 #-1 等完整小序号。"""
    name = re.sub(r"^完成_", "", filename.strip())
    name = re.sub(r"\.[^.]+$", "", name)
    return (name.split()[0] if name.split() else name) or filename


def _latest_run(repo: str, workflow: str) -> dict:
    response = requests.get(
        f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs",
        headers=_headers(), params={"per_page": 1}, timeout=15,
    )
    response.raise_for_status()
    runs = response.json().get("workflow_runs", [])
    return runs[0] if runs else {}


def _job_log(repo: str, run_id: int) -> str:
    jobs = requests.get(
        f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/jobs",
        headers=_headers(), timeout=15,
    )
    jobs.raise_for_status()
    all_jobs = jobs.json().get("jobs", [])
    if not all_jobs:
        return ""
    response = requests.get(
        f"https://api.github.com/repos/{repo}/actions/jobs/{all_jobs[0]['id']}/logs",
        headers=_headers(), timeout=30,
    )
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        return "\n".join(
            archive.read(name).decode("utf-8", errors="replace")
            for name in archive.namelist() if name.endswith(".txt")
        )


def get_result(task: str) -> dict:
    if task not in WORKFLOWS:
        raise ValueError("未知任务")
    repo, workflow = WORKFLOWS[task]
    status = get_workflow_status(task)
    run = _latest_run(repo, workflow)
    result = {
        "task": task, "status": status.get("status", "unknown"),
        "run_number": status.get("run_number"), "links": [],
        "summary": [], "issues": [], "board_results": [], "warnings": [], "successes": [],
        "completion": {"percent": 0, "completed": 0, "total": 0, "unit": "项"},
    }
    if status.get("html_url"):
        result["links"].append({"label": "打开 GitHub 运行日志", "url": status["html_url"]})
    if status.get("status") in {"queued", "in_progress", "requested"}:
        result["summary"] = ["任务已提交，正在等待或执行中"]
        return result
    if not run:
        result["summary"] = ["尚无运行记录"]
        return result
    try:
        log = _job_log(repo, run["id"])
    except requests.RequestException as error:
        result["summary"] = [f"运行结果读取失败：{error}"]
        return result

    # 新日志统一称“图纸文件”，同时兼容历史“张未完成图片/PDF”日志。
    scanned = re.search(
        r"扫描到\s+(\d+)\s+(?:个未完成图纸文件(?:（图片/PDF）)?|张未完成图片(?:/PDF)?)",
        log,
    )
    pending_boards = re.search(r"待处理板材(\d+)张", log)
    if scanned:
        total = int(scanned.group(1))
        result["completion"].update({"total": total, "unit": "个图纸文件"})
    elif pending_boards:
        result["completion"].update({"total": int(pending_boards.group(1)), "unit": "张板材"})

    for line in log.splitlines():
        clean = re.sub(r"^\d{4}-\d{2}-\d{2}T[^ ]+Z\s+", "", line).strip()
        if "处理失败｜阶段=" in clean:
            detail = clean.split("处理失败｜阶段=", 1)[1]
            fields = [part.strip() for part in detail.split("｜")]
            stage, reason, advice = (fields + ["", "", ""])[:3]
            filename = re.search(r"文件=([^；]+)", reason)
            file_name = filename.group(1) if filename else "未识别文件"
            cause = reason.split("；", 1)[1] if "；" in reason else reason
            action = advice.removeprefix("处理建议=").strip() or "检查该图纸文件和对应基础资料后重新执行。"
            result["issues"].append({
                "title": _split_board_id(file_name),
                "record_status": "未拆出结果",
                "cause": f"{stage}：{cause}",
                "action": action,
                "reason": "｜".join(part for part in [stage, reason, advice] if part),
            })
        elif task == "parts" and "板材处理结果｜" in clean:
            fields = {
                key: value
                for key, value in (
                    part.split("=", 1)
                    for part in clean.split("｜")[1:]
                    if "=" in part
                )
            }
            board_id = fields.get("板材") or fields.get("文件") or "未识别板材"
            result["board_results"].append({
                "title": board_id,
                "record_status": fields.get("状态", "状态未确认"),
                "cause": fields.get("原因", "未提供说明"),
                "action": fields.get("处理建议", "核对后重新执行。"),
            })
        elif task == "parts" and "阻断板材仍保留根目录" in clean:
            match = re.search(r"阻断板材仍保留根目录\s+(.+?):\s*(.+)$", clean)
            if match:
                board_id, reason = match.groups()
                if "不在“正在加工”" in reason or "无订单" in reason:
                    suggestion = "把对应订单的正式原始汇总表放入“正在加工”，再执行一次未加工更新。"
                elif "无匹配" in reason:
                    suggestion = "核对订单号、图号、厚度、基础件数和基础总重量是否与原始汇总表一致。"
                else:
                    suggestion = "核对该板拆图结果和当前订单原始汇总表，补齐资料后重新执行。"
                result["issues"].append({
                    "title": board_id,
                    "record_status": "未累计、未记录",
                    "cause": reason,
                    "action": suggestion,
                    "reason": f"原因：{reason}｜处理建议：{suggestion}",
                })
        elif task == "parts" and "已归档拆图结果:" in clean:
            result["successes"].append({"title": clean, "detail": "已移动到已录入数量"})
        elif task == "split" and re.search(r"(?:处理|验证)(?:成功|完成)[：:]", clean) and "->" in clean:
            match = re.search(r"(?:处理|验证)(?:成功|完成)[：:]\s*(.+?)\s*->\s*(.+)$", clean)
            if match:
                source_name, output_name = match.groups()
                result["successes"].append({
                    "title": _split_board_id(source_name),
                    "detail": f"已生成 {output_name.strip()}",
                })
        elif "处理完成" in clean and "->" in clean:
            result["successes"].append({"title": clean, "detail": "已生成并归档"})

    if result["issues"]:
        result["completion"]["completed"] = len(result["successes"])
        result["completion"]["percent"] = round(100 * len(result["successes"]) / max(result["completion"]["total"], 1))
        result["summary"] = [f"发现 {len(result['issues'])} 个失败项目，已列出具体原因和处理建议"]
    elif status.get("status") == "success":
        result["completion"]["completed"] = result["completion"]["total"]
        result["completion"]["percent"] = 100
        result["summary"] = ["本次运行完成"]
    else:
        result["summary"] = ["任务失败，请打开日志查看原因"]
    return result
