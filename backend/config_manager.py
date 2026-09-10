import base64
import json
import os
import re
from pathlib import Path

import requests


CONTROL_REPO = "zx18522296069-commits/shengchan-control-panel"
CONFIG_PATH = "backend/config.json"
LOCAL_CONFIG_PATH = Path(__file__).with_name("config.json")
TASK_TARGETS = {
    "split": ("zx18522296069-commits/tuzhichaifen", ".github/workflows/split_drawing.yml"),
    "parts": ("zx18522296069-commits/weijiagong-lingjian-guidang", ".github/workflows/update_parts.yml"),
}
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SCHEDULE_RE = re.compile(r"(?m)^  schedule:\n(?:^(?:    .*|\s*)\n)*")


def _headers():
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN 未配置")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _get_file(repo, path):
    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    response = requests.get(url, headers=_headers(), params={"ref": "main"}, timeout=15)
    response.raise_for_status()
    payload = response.json()
    content = base64.b64decode(payload["content"]).decode("utf-8")
    return content, payload["sha"]


def _put_file(repo, path, content, sha, message):
    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    response = requests.put(
        url,
        headers=_headers(),
        json={
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "sha": sha,
            "branch": "main",
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["commit"]["sha"]


def get_config():
    try:
        content, _ = _get_file(CONTROL_REPO, CONFIG_PATH)
        return json.loads(content)
    except (RuntimeError, requests.RequestException, KeyError, ValueError):
        return json.loads(LOCAL_CONFIG_PATH.read_text(encoding="utf-8"))


def _validate_config(config):
    tasks = config.get("tasks") if isinstance(config, dict) else None
    if not isinstance(tasks, dict) or not {"split", "parts"}.issubset(tasks):
        raise ValueError("任务设置不完整")

    normalized = {"timezone": "Asia/Shanghai", "tasks": {}}
    for key in ("split", "parts"):
        source = tasks[key]
        if not isinstance(source, dict):
            raise ValueError(f"{key} 设置格式错误")
        mode = source.get("schedule_mode", "daily")
        if key == "split" and mode not in {"hourly", "daily"}:
            raise ValueError("拆图执行频率无效")
        if key == "parts":
            mode = "daily"
        times = source.get("times") or []
        expected = 1 if key == "split" else 2
        if mode == "daily" and (len(times) != expected or any(not TIME_RE.match(value) for value in times)):
            raise ValueError(f"{key} 执行时间无效")
        normalized["tasks"][key] = {
            "enabled": bool(source.get("enabled")),
            "schedule_mode": mode,
            "minute": 0,
            "times": times[:expected],
        }
    return normalized


def _to_utc_cron(value):
    hour, minute = (int(part) for part in value.split(":"))
    return f"{minute} {(hour - 8) % 24} * * *"


def _crons(task):
    if task["schedule_mode"] == "hourly":
        return [f"{int(task.get('minute', 0))} * * * *"]
    return [_to_utc_cron(value) for value in task["times"]]


def _replace_schedule(workflow, crons, enabled):
    stripped = SCHEDULE_RE.sub("", workflow, count=1)
    if not enabled:
        return stripped
    schedule = "  schedule:\n" + "".join(f"    - cron: '{cron}'\n" for cron in crons)
    marker = "on:\n"
    if marker not in stripped:
        raise ValueError("工作流缺少 on 配置")
    return stripped.replace(marker, marker + schedule, 1)


def save_config(config):
    normalized = _validate_config(config)
    results = {}

    for key, (repo, path) in TASK_TARGETS.items():
        workflow, sha = _get_file(repo, path)
        task = normalized["tasks"][key]
        updated = _replace_schedule(workflow, _crons(task), task["enabled"])
        if updated == workflow:
            results[key] = "unchanged"
        else:
            results[key] = _put_file(repo, path, updated, sha, f"通过控制台更新{key}定时设置")

    current, config_sha = _get_file(CONTROL_REPO, CONFIG_PATH)
    serialized = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    results["config"] = "unchanged" if current == serialized else _put_file(
        CONTROL_REPO, CONFIG_PATH, serialized, config_sha, "保存生产控制台定时设置"
    )
    return normalized, results
