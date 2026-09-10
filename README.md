# 生产自动化控制台

面向车间同事的简洁操作入口，集中控制三个生产任务：

- 画图：PDF 转 DXF 接口预留
- 拆图：触发 `tuzhichaifen` 的正式生产工作流
- 未加工更新：触发 `weijiagong-lingjian-guidang` 的正式生产工作流

页面同时显示最近一次运行状态，并可修改定时计划。当前真实计划为：拆图每小时整点扫描；未加工更新每天北京时间 17:25 和 22:00 执行。

## 结构

- `frontend/`：React + Vite 页面，通过 GitHub Pages 发布
- `backend/`：FastAPI 控制服务，安全代理 GitHub Actions 操作

## 后端环境变量

- `GITHUB_TOKEN`：需对三个仓库拥有 Actions 写入和 Contents 写入权限
- `CONTROL_PANEL_KEY`：同事进入页面时使用的内部口令
- `ALLOWED_ORIGINS`：允许访问后端的前端来源，多个地址用逗号分隔

启动命令：

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

后端上线后，在仓库 Variables 中设置 `VITE_API_BASE_URL` 为后端公网地址，重新运行 `Deploy Frontend Pages`。

> 不得把 `GITHUB_TOKEN` 或 `CONTROL_PANEL_KEY` 写入仓库或前端构建变量。
