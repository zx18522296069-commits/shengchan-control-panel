from fastapi import FastAPI
from github_client import run_split, run_parts
from status import get_status

app = FastAPI(title="生产自动化控制台 API")


@app.get("/")
def root():
    return {"status": "ok", "service": "production-control-api"}


@app.post("/api/run/split")
def split():
    return run_split()


@app.post("/api/run/parts")
def parts():
    return run_parts()


@app.get("/api/status")
def status():
    return get_status()
