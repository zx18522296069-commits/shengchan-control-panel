"""GitHub Actions status query placeholder.

This module will provide task status aggregation for the control panel.
"""

from datetime import datetime


def get_status():
    return {
        "updated": datetime.utcnow().isoformat(),
        "tasks": {
            "split": "unknown",
            "parts": "unknown"
        }
    }
