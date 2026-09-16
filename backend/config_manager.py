import base64
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import requests


CONTROL_REPO = "zx18522296069-commits/shengchan-control-panel"
CONFIG_PATH = "backend/config.json"
LOCAL_CONFIG_PATH = Path(__file__).with_name("config.json")
SPLIT_TARGET = ("zx18522296069-commits/tuzhichaifen", ".github/workflows/split_drawing.yml")
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

    split = tasks["split"]
    if not isinstance(split, dict):
        raise ValueError("split 设置格式错误")
    split_mode = split.get("schedule_mode", "daily")
    if split_mode not in {"hourly", "daily"}:
        raise ValueError("拆图执行频率无效")
    split_times = (split.get("times") or [])[:1]
    if any(not TIME_RE.match(value) for value in split_times):
        raise ValueError("拆图执行时间无效")
    if split.get("enabled") and split_mode == "daily" and len(split_times) != 1:
        raise ValueError("拆图执行时间无效")
    normalized["tasks"]["split"] = {
        "enabled": bool(split.get("enabled")),
        "schedule_mode": split_mode,
        "minute": int(split.get("minute", 0) or 0),
        "times": split_times,
    }

    parts = tasks["parts"]
    if not isinstance(parts, dict):
        raise ValueError("parts 设置格式错误")
    parts_times = (parts.get("times") or [])[:2]
    if any(not TIME_RE.match(value) for value in parts_times):
        raise ValueError("未加工执行时间无效")
    if parts.get("enabled") and len(parts_times) != 2:
        raise ValueError("未加工执行时间无效")
    normalized["tasks"]["parts"] = {
        "enabled": bool(parts.get("enabled")),
        "schedule_mode": "daily",
        "minute": 0,
        "times": parts_times,
        "schedule_updated_at": parts.get("schedule_updated_at"),
    }
    return normalized


def _to_utc_cron(value):
    hour, minute = (int(part) for part in value.split(":"))
    return f"{minute} {(hour - 8) % 24} * * *"


def _split_crons(task):
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


def _parts_signature(task):
    return json.dumps(
        {
            "enabled": bool(task.get("enabled")),
            "times": task.get("times") or [],
        },
        sort_keys=True,
        ensure_ascii=False,
    )


def save_config(config):
    previous = _validate_config(get_config())
    normalized = _validate_config(config)
    results = {}

    # 拆图继续沿用当前控制台实现；未加工绝不再写目标 workflow 的 schedule。
    repo, path = SPLIT_TARGET
    workflow, sha = _get_file(repo, path)
    split_task = normalized["tasks"]["split"]
    updated = _replace_schedule(workflow, _split_crons(split_task), split_task["enabled"])
    if updated == workflow:
        results["split"] = "unchanged"
    else:
        results["split"] = _put_file(repo, path, updated, sha, "通过控制台更新split定时设置")

    parts_changed = _parts_signature(previous["tasks"]["parts"]) != _parts_signature(normalized["tasks"]["parts"])
    normalized["tasks"]["parts"]["schedule_updated_at"] = (
        datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        if parts_changed
        else previous["tasks"]["parts"].get("schedule_updated_at")
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    )
    results["parts"] = "control-panel-scheduler"

    current, config_sha = _get_file(CONTROL_REPO, CONFIG_PATH)
    serialized = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    results["config"] = "unchanged" if current == serialized else _put_file(
        CONTROL_REPO, CONFIG_PATH, serialized, config_sha, "保存生产控制台定时设置"
    )
    return normalized, results
