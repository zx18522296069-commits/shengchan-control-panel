import os

import requests


GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")


def dispatch_workflow(owner_repo, workflow_file, inputs):
    if not GITHUB_TOKEN:
        return {"status": "error", "message": "GITHUB_TOKEN 未配置"}

    response = requests.post(
        f"https://api.github.com/repos/{owner_repo}/actions/workflows/{workflow_file}/dispatches",
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        json={"ref": "main", "inputs": inputs},
        timeout=15,
    )
    if response.status_code == 204:
        return {"status": "requested", "workflow": workflow_file}
    try:
        message = response.json().get("message", response.text)
    except ValueError:
        message = response.text
    return {
        "status": "error",
        "code": response.status_code,
        "message": message,
    }


def run_split():
    return dispatch_workflow(
        "zx18522296069-commits/tuzhichaifen",
        "split_drawing.yml",
        {"dry_run": "false", "only": ""},
    )


def run_parts():
    return dispatch_workflow(
        "zx18522296069-commits/weijiagong-lingjian-guidang",
        "update_parts.yml",
        {"mode": "production"},
    )
