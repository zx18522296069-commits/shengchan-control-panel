"""GitHub Actions status reader.

Reads workflow execution status for the production control panel.
Uses GITHUB_TOKEN from environment when deployed.
"""

import os
from datetime import datetime

import requests


WORKFLOWS = {
    "split": {
        "repo": "zx18522296069-commits/tuzhichaifen",
        "workflow": "split_drawing.yml",
    },
    "parts": {
        "repo": "zx18522296069-commits/weijiagong-lingjian-guidang",
        "workflow": "update_parts.yml",
    },
}


def get_workflow_status(task):
    config = WORKFLOWS.get(task)
    if not config:
        return {"task": task, "status": "unknown"}

    token = os.getenv("GITHUB_TOKEN")
    if not token:
        return {
            "task": task,
            "repository": config["repo"],
            "workflow": config["workflow"],
            "status": "token_missing",
            "checked_at": datetime.utcnow().isoformat(),
        }

    url = (
        f"https://api.github.com/repos/{config['repo']}"
        f"/actions/workflows/{config['workflow']}/runs?per_page=1"
    )

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )

    if response.status_code != 200:
        return {
            "task": task,
            "status": "api_error",
            "code": response.status_code,
            "checked_at": datetime.utcnow().isoformat(),
        }

    runs = response.json().get("workflow_runs", [])
    if not runs:
        status = "no_runs"
    else:
        latest = runs[0]
        status = latest.get("status")
        if status == "completed":
            status = latest.get("conclusion") or status

    return {
        "task": task,
        "repository": config["repo"],
        "workflow": config["workflow"],
        "status": status,
        "checked_at": datetime.utcnow().isoformat(),
    }


def get_all_status():
    return {
        "split": get_workflow_status("split"),
        "parts": get_workflow_status("parts"),
    }
