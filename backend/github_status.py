"""GitHub Actions status reader.

Reads workflow execution status for the production control panel.
The first version keeps repository/workflow mapping centralized here.
"""

from datetime import datetime


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
    """Return workflow status placeholder.

    GitHub API authentication will be connected in the next step.
    """
    config = WORKFLOWS.get(task)
    return {
        "task": task,
        "repository": config["repo"] if config else None,
        "workflow": config["workflow"] if config else None,
        "status": "unknown",
        "checked_at": datetime.utcnow().isoformat(),
    }


def get_all_status():
    return {
        "split": get_workflow_status("split"),
        "parts": get_workflow_status("parts"),
    }
