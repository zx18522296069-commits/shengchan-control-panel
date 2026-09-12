import os
from datetime import datetime, timezone
import requests

WORKFLOWS = {
    "split": ("zx18522296069-commits/tuzhichaifen", "split_drawing.yml"),
    "parts": ("zx18522296069-commits/weijiagong-lingjian-guidang", "update_parts.yml"),
    "draw": ("zx18522296069-commits/pdf-dxf-huatu", "draw.yml"),
}

def get_workflow_status(task):
    repo, workflow = WORKFLOWS[task]
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.getenv("GITHUB_TOKEN")
    if token: headers["Authorization"] = f"Bearer {token}"
    try:
        response = requests.get(f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs", headers=headers, params={"per_page": 1}, timeout=12)
        response.raise_for_status(); runs = response.json().get("workflow_runs", [])
    except requests.RequestException as error:
        return {"task":task,"status":"api_error","message":str(error),"checked_at":datetime.now(timezone.utc).isoformat()}
    if not runs: return {"task":task,"status":"no_runs","checked_at":datetime.now(timezone.utc).isoformat()}
    latest=runs[0]; status=latest.get("conclusion") if latest.get("status")=="completed" else latest.get("status")
    return {"task":task,"status":status or "unknown","event":latest.get("event"),"run_started_at":latest.get("run_started_at"),"updated_at":latest.get("updated_at"),"html_url":latest.get("html_url"),"run_number":latest.get("run_number"),"checked_at":datetime.now(timezone.utc).isoformat()}

def get_all_status(): return {key:get_workflow_status(key) for key in WORKFLOWS}
