import os
import requests


GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")


def dispatch_workflow(owner_repo, workflow_file, inputs=None):
    """Trigger GitHub Actions workflow_dispatch."""
    if not GITHUB_TOKEN:
        return {
            "status": "error",
            "message": "GITHUB_TOKEN not configured"
        }

    url = f"https://api.github.com/repos/{owner_repo}/actions/workflows/{workflow_file}/dispatches"

    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json"
    }

    data = {
        "ref": "main",
        "inputs": inputs or {}
    }

    response = requests.post(url, headers=headers, json=data)

    if response.status_code == 204:
        return {
            "status": "started",
            "workflow": workflow_file
        }

    return {
        "status": "error",
        "code": response.status_code,
        "message": response.text
    }


def run_split():
    return dispatch_workflow(
        "zx18522296069-commits/tuzhichaifen",
        "split_drawing.yml"
    )


def run_parts():
    return dispatch_workflow(
        "zx18522296069-commits/weijiagong-lingjian-guidang",
        "update_parts.yml"
    )
