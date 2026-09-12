import hmac
import os

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config_manager import get_config, save_config
from .github_client import run_draw, run_parts, run_split
from .github_status import get_all_status

app = FastAPI(title="生产自动化控制台 API")
origins = [item.strip() for item in os.getenv(
    "ALLOWED_ORIGINS",
    "https://zx18522296069-commits.github.io,http://localhost:5173",
).split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Control-Key"],
)

def authorize(x_control_key: str = Header(default="")):
    expected = os.getenv("CONTROL_PANEL_KEY")
    if not expected: raise HTTPException(status_code=503, detail="CONTROL_PANEL_KEY 未配置")
    if not hmac.compare_digest(x_control_key, expected): raise HTTPException(status_code=401, detail="控制台口令不正确")

@app.get("/")
def root(): return {"status": "ok", "service": "production-control-api"}

@app.post("/api/run/split", dependencies=[Depends(authorize)])
def split(): return run_split()

@app.post("/api/run/parts", dependencies=[Depends(authorize)])
def parts(): return run_parts()

@app.post("/api/run/draw", dependencies=[Depends(authorize)])
def draw(payload: dict | None = None): return run_draw((payload or {}).get("order_name", ""))

@app.get("/api/status", dependencies=[Depends(authorize)])
def status(): return get_all_status()

@app.get("/api/config", dependencies=[Depends(authorize)])
def config(): return get_config()

@app.post("/api/config", dependencies=[Depends(authorize)])
def update_config(payload: dict):
    try: updated, commits = save_config(payload)
    except ValueError as error: raise HTTPException(status_code=422, detail=str(error)) from error
    except requests.RequestException as error: raise HTTPException(status_code=502, detail=f"GitHub 同步失败：{error}") from error
    except RuntimeError as error: raise HTTPException(status_code=503, detail=str(error)) from error
    return {"status": "success", "config": updated, "commits": commits}
