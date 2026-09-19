# 生产自动化控制台

面向车间同事的简洁操作入口，集中控制三个生产任务：

- 画图：触发 `pdf-dxf-huatu` 的正式 GitHub Actions 工作流
- 拆图：触发 `tuzhichaifen` 的正式生产工作流
- 未加工更新：触发 `weijiagong-lingjian-guidang` 的正式生产工作流

页面同时显示最近一次运行状态，并可修改定时计划。

## 未加工更新调度规则

“未加工更新”以本控制台前端保存的定时配置为唯一正式业务时间来源。

执行链固定为：

`前端定时配置 -> 控制台后台调度器 -> GitHub API workflow_dispatch -> weijiagong-lingjian-guidang/update_parts.yml -> Google Drive 增量处理`

规则：

- `weijiagong-lingjian-guidang/.github/workflows/update_parts.yml` 不包含 `schedule`，不维护任何固定业务 cron。
- 前端修改未加工执行时间时，只更新 `backend/config.json`；控制台不得再把该时间写回目标 workflow。
- 控制台使用通用调度心跳唤醒后台调度器。心跳本身只负责周期检查，不包含任何未加工业务时间。
- 后台调度器读取前端配置，命中计划时间后通过 GitHub API `workflow_dispatch` 触发未加工工作流。
- 调度器记录计划时间去重状态，同一个任务、同一个计划时刻只允许 dispatch 一次。
- 前端“未加工更新”按钮也通过 `workflow_dispatch` 立即执行，与自动定时共用同一正式入口。
- 目标仓库的 `workflow_dispatch` 同时保留给人工 test、production 补跑和故障恢复。
- 禁止再在 README、未加工 workflow、Python 脚本或其他服务中维护第二套未加工固定业务时间。

## 结构

- `frontend/`：React + Vite 页面，通过 GitHub Pages 发布
- `backend/`：控制台配置与结果解析代码
- `worker/production-control-api/`：线上控制 API Worker 源码；负责立即执行、配置保存、运行状态读取和未加工后台调度
- `.github/workflows/scheduler-heartbeat.yml`：控制台通用调度心跳，只唤醒调度器，不保存业务执行时间
- `backend/scheduler_state.json`：未加工定时 dispatch 去重状态

## 后端环境变量

- `GITHUB_TOKEN`：需对自动化仓库拥有 Actions 写入和控制台仓库 Contents 写入权限
- `CONTROL_PANEL_KEY`：同事进入页面时使用的内部口令

> 不得把 `GITHUB_TOKEN` 或 `CONTROL_PANEL_KEY` 写入仓库或前端构建变量。


## 画图任务正式接口

“画图”使用现有 GitHub Actions 执行，不依赖 Cloud Run、Cloud Build 或 Artifact Registry。

固定链路：

前端画图按钮 → production-control-api → GitHub API workflow_dispatch → pdf-dxf-huatu/draw.yml → Google Drive 读取订单 → PDF→DXF 正式处理 → Actions artifact / Google Drive

当前 Actions 模式只支持从 Google Drive 按订单名执行。本地文件上传、异常项单独复跑和网页内人工复核依赖常驻任务 API，暂不在此模式中启用。画图规则、正式复核门控和 Drive 正式交付条件保持不变。
