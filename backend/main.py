from fastapi import FastAPI

app = FastAPI(title="生产自动化控制台 API")


@app.get("/")
def root():
    return {"status": "ok", "service": "production-control-api"}


@app.post("/api/run/split")
def run_split():
    # 后续接 GitHub Actions workflow_dispatch
    return {"task": "split", "status": "prepared"}


@app.post("/api/run/parts")
def run_parts():
    # 后续接 GitHub Actions workflow_dispatch
    return {"task": "parts", "status": "prepared"}


@app.get("/api/status")
def status():
    return {"tasks": []}
