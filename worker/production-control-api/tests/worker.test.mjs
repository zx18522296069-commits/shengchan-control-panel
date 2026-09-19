import assert from "node:assert/strict";
import worker, { duePartsSlots, runSchedulerTick } from "../worker/index.js";

const env = {
  CONTROL_PANEL_KEY: "test-key",
  GITHUB_TOKEN: "test-token",
  DRAW_API_BASE_URL: "https://draw.example",
  DRAW_API_TOKEN: "draw-token",
};
const origin = "https://zx18522296069-commits.github.io";

function request(path, init = {}) {
  return new Request(`https://api.example${path}`, {
    ...init,
    headers: { origin, "x-control-key": "test-key", ...(init.headers || {}) },
  });
}

function encoded(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64");
}

const health = await worker.fetch(new Request("https://api.example/"), env);
assert.equal(health.status, 200);

const denied = await worker.fetch(request("/api/status", {
  headers: { origin, "x-control-key": "wrong" },
}), env);
assert.equal(denied.status, 401);

const calls = [];
const originalFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url) === "https://draw.example/api/jobs/drive") {
    assert.equal(init.headers.authorization, "Bearer draw-token");
    return Response.json({
      id: "draw-job-1",
      order_name: "159.26-08-31 YT27-2400Z-1004",
      source: "drive",
      status: "queued",
      created_at: "2026-09-19T16:00:00Z",
      updated_at: "2026-09-19T16:00:00Z",
      steps: [],
      alerts: [],
    });
  }
  if (String(url) === "https://draw.example/api/jobs/latest") {
    assert.equal(init.headers.authorization, "Bearer draw-token");
    return Response.json({
      id: "draw-job-1",
      order_name: "159.26-08-31 YT27-2400Z-1004",
      source: "drive",
      status: "completed",
      created_at: "2026-09-19T16:00:00Z",
      updated_at: "2026-09-19T16:20:00Z",
      steps: [
        { status: "ok", text: "读取输入完成" },
        { status: "ok", text: "DXF生成完成" },
        { status: "ok", text: "真实核对完成" },
        { status: "ok", text: "汇总/预览/排版完成" },
        { status: "ok", text: "ZIP终检完成" },
        { status: "ok", text: "Drive交付完成" },
      ],
      alerts: [],
      download_url: "/download/draw-job-1",
      drive_url: "https://drive.example/order",
    });
  }
  if (String(url).includes("/dispatches")) return new Response(null, { status: 204 });
  if (String(url).includes("/actions/workflows/") && String(url).includes("/runs?")) {
    return Response.json({ workflow_runs: [{
      id: 123, run_number: 14, status: "completed", conclusion: "success",
      event: "workflow_dispatch", updated_at: "2026-09-16T08:20:09Z", html_url: "https://example.test/run/123",
    }] });
  }
  if (String(url).includes("/actions/runs/123/jobs")) {
    return Response.json({ jobs: [{ id: 456, name: "update" }] });
  }
  if (String(url).includes("/actions/jobs/456/logs")) {
    return new Response([
      "2026-09-16T08:18:51Z [2026-09-16T16:18:51+08:00] INFO 发现订单原始汇总表 22 个",
      "2026-09-16T08:18:52Z [2026-09-16T16:18:52+08:00] INFO 拆图结果根目录待处理完成文件 2 个",
      "2026-09-16T08:18:53Z [2026-09-16T16:18:53+08:00] INFO 复用订单源缓存 159.26-07-15  YT71S-2500Z-0715：56 条零件",
      "2026-09-16T08:18:54Z [2026-09-16T16:18:54+08:00] INFO 重新读取订单源 THP10-8000J-0911：18 条零件",
      "2026-09-16T08:18:55Z [2026-09-16T16:18:55+08:00] INFO 订单源增量处理：复用缓存 21 个，重新下载解析 1 个",
      "2026-09-16T08:19:01Z [2026-09-16T16:19:01+08:00] INFO 板材 #88 校验通过：计入 4 件",
      "2026-09-16T08:19:10Z [2026-09-16T16:19:10+08:00] INFO 板材处理结果｜文件=#88_完成.xlsx｜板材=#88｜状态=已累计、已录入｜原因=首次校验通过并已写回累计台账｜处理建议=无",
      "2026-09-16T08:19:11Z [2026-09-16T16:19:11+08:00] WARNING 板材 #89 阻断：基础数据不唯一",
      "2026-09-16T08:19:12Z [2026-09-16T16:19:12+08:00] WARNING 板材处理结果｜文件=#89_完成.xlsx｜板材=#89｜状态=未累计、未记录｜原因=基础数据不唯一｜处理建议=核对该板拆图结果和对应订单原始汇总表后重新执行。",
      "2026-09-16T08:19:13Z [2026-09-16T16:19:13+08:00] INFO 生成后活动订单当前剩余件数 123",
      "2026-09-16T08:19:14Z [2026-09-16T16:19:14+08:00] INFO 生成后活动订单当前未出重量 45.678 t",
    ].join("\n"));
  }
  return Response.json({});
};

const split = await worker.fetch(request("/api/run/split", { method: "POST" }), env);
assert.equal(split.status, 200);
assert.equal((await split.json()).status, "requested");
assert.match(calls[0].url, /tuzhichaifen\/actions\/workflows\/split_drawing\.yml\/dispatches$/);
assert.deepEqual(JSON.parse(calls[0].init.body).inputs, { dry_run: "false", only: "" });

const partsRun = await worker.fetch(request("/api/run/parts", { method: "POST" }), env);
assert.equal(partsRun.status, 200);
const partsRunBody = JSON.parse(calls[1].init.body);
assert.match(calls[1].url, /weijiagong-lingjian-guidang\/actions\/workflows\/update_parts\.yml\/dispatches$/);
assert.deepEqual(partsRunBody.inputs, {
  mode: "production",
  trigger_source: "control-panel-manual",
  scheduled_for: "",
});

const drawRun = await worker.fetch(request("/api/run/draw", {
  method: "POST",
  body: JSON.stringify({ order_name: "159.26-08-31 YT27-2400Z-1004" }),
}), env);
assert.equal(drawRun.status, 200);
const drawRunPayload = await drawRun.json();
assert.equal(drawRunPayload.status, "requested");
assert.equal(drawRunPayload.job_id, "draw-job-1");

const status = await worker.fetch(request("/api/status"), env);
assert.equal(status.status, 200);
const statusPayload = await status.json();
assert.deepEqual(Object.keys(statusPayload).sort(), ["draw", "parts", "split"]);
assert.equal(statusPayload.draw.status, "success");
assert.equal(statusPayload.draw.job_id, "draw-job-1");

const drawResult = await worker.fetch(request("/api/results/draw"), env);
assert.equal(drawResult.status, 200);
const drawPayload = await drawResult.json();
assert.equal(drawPayload.status, "success");
assert.deepEqual(drawPayload.completion, { percent: 100, completed: 6, total: 6, unit: "个阶段" });
assert.equal(drawPayload.links.length, 2);
assert.match(drawPayload.links[0].url, /draw\.example\/download\/draw-job-1$/);

const result = await worker.fetch(request("/api/results/parts"), env);
assert.equal(result.status, 200);
const resultPayload = await result.json();
assert.equal(resultPayload.status, "partial");
assert.deepEqual(resultPayload.completion, { percent: 50, completed: 1, total: 2, unit: "张板材" });
assert.equal(resultPayload.successes.length, 1);
assert.equal(resultPayload.successes[0].title, "板材 #88");
assert.equal(resultPayload.issues.length, 1);
assert.equal(resultPayload.issues[0].title, "#89（#89_完成.xlsx）");
assert.equal(resultPayload.issues[0].record_status, "未累计、未记录");
assert.match(resultPayload.issues[0].reason, /基础数据不唯一/);
assert.match(resultPayload.summary.join("｜"), /复用缓存 21 个，重新下载解析 1 个/);
assert.match(resultPayload.summary.join("｜"), /当前剩余 123 件/);
assert.match(resultPayload.summary.join("｜"), /45\.678 t/);

// 无待处理板材时，成功运行应显示“台账已刷新”，不能显示 0/N 个订单失败。
global.fetch = async (url) => {
  if (String(url).includes("/actions/workflows/") && String(url).includes("/runs?")) {
    return Response.json({ workflow_runs: [{ id: 124, run_number: 15, status: "completed", conclusion: "success", event: "workflow_dispatch", updated_at: "2026-09-16T08:30:09Z", html_url: "https://example.test/run/124" }] });
  }
  if (String(url).includes("/actions/runs/124/jobs")) return Response.json({ jobs: [{ id: 457, name: "update" }] });
  if (String(url).includes("/actions/jobs/457/logs")) return new Response([
    "2026-09-16 16:29:01,100 INFO 发现订单原始汇总表 22 个",
    "2026-09-16 16:29:02,100 INFO 拆图结果根目录待处理完成文件 0 个",
    "2026-09-16 16:29:03,100 INFO 订单源增量处理：复用缓存 22 个，重新下载解析 0 个",
    "2026-09-16 16:29:04,100 INFO 生成后活动订单当前剩余件数 123",
  ].join("\n"));
  return Response.json({});
};
const noBoardResult = await worker.fetch(request("/api/results/parts"), env);
const noBoardPayload = await noBoardResult.json();
assert.equal(noBoardPayload.status, "success");
assert.deepEqual(noBoardPayload.completion, { percent: 100, completed: 0, total: 0, unit: "张板材" });
assert.match(noBoardPayload.summary[0], /没有待处理板材/);
assert.match(noBoardPayload.summary.join("｜"), /复用缓存 22 个，重新下载解析 0 个/);

// 新生产日志以“图纸文件”统计；同时验证 PDF 原生文本成功和 PDF 失败提示。
global.fetch = async (url) => {
  if (String(url).includes("/actions/workflows/") && String(url).includes("/runs?")) {
    return Response.json({ workflow_runs: [{ id: 2260, run_number: 48, status: "completed", conclusion: "failure", event: "workflow_dispatch", updated_at: "2026-09-16T06:58:41Z", html_url: "https://example.test/run/2260" }] });
  }
  if (String(url).includes("/actions/runs/2260/jobs")) return Response.json({ jobs: [{ id: 2261, name: "split" }] });
  if (String(url).includes("/actions/jobs/2261/logs")) return new Response([
    "2026-09-16 14:55:00,100 INFO 扫描到 2 个未完成图纸文件（图片/PDF）",
    "2026-09-16 14:55:05,100 INFO PDF 原生文本解析成功：#2330 T30退0.pdf（未使用 OCR）",
    "2026-09-16 14:55:10,100 INFO 处理完成：#2330 T30退0.pdf -> #2330_完成.xlsx",
    "2026-09-16 14:55:12,100 ERROR 处理失败｜阶段=PDF 内容提取失败｜文件=#2331 T40.pdf；PDF 原生文本提取未通过：未能识别钢板重量；OCR 回退也未通过：未能识别钢板重量｜处理建议=确认 PDF 由 FastNEST/FastCAM 正常导出。",
    "2026-09-16 14:55:14,100 WARNING 跳过不可读基础表：模板.xlsm：未找到汇总表表头",
  ].join("\n"));
  return Response.json({});
};
const splitResult = await worker.fetch(request("/api/results/split"), env);
assert.equal(splitResult.status, 200);
const splitPayload = await splitResult.json();
assert.equal(splitPayload.status, "partial");
assert.deepEqual(splitPayload.completion, { percent: 50, completed: 1, total: 2, unit: "个图纸文件" });
assert.deepEqual(splitPayload.successes, [{ title: "#2330", detail: "已生成 #2330_完成.xlsx" }]);
assert.equal(splitPayload.issues.length, 1);
assert.equal(splitPayload.issues[0].title, "#2331");
assert.equal(splitPayload.issues[0].record_status, "未拆出");
assert.match(splitPayload.issues[0].cause, /PDF 内容提取失败/);
assert.match(splitPayload.issues[0].action, /FastNEST\/FastCAM/);
assert.equal(splitPayload.warnings.length, 1);
assert.equal(splitPayload.warnings[0].title, "模板.xlsm");

// 历史日志仍兼容“张未完成图片/PDF”。
global.fetch = async (url) => {
  if (String(url).includes("/actions/workflows/") && String(url).includes("/runs?")) {
    return Response.json({ workflow_runs: [{ id: 2262, run_number: 47, status: "completed", conclusion: "failure", event: "workflow_dispatch", updated_at: "2026-09-15T06:58:41Z", html_url: "https://example.test/run/2262" }] });
  }
  if (String(url).includes("/actions/runs/2262/jobs")) return Response.json({ jobs: [{ id: 2263, name: "split" }] });
  if (String(url).includes("/actions/jobs/2263/logs")) return new Response([
    "2026-09-15 03:51:00,100 INFO 扫描到 4 张未完成图片/PDF",
    "2026-09-15 03:51:30,704 INFO 验证完成: #2330 T30退0.pdf -> #2330_完成.xlsx",
    "2026-09-14 15:48:38,704 ERROR 处理失败｜阶段=图片识别失败｜文件=#2260.png；OCR/版式识别未通过：零件图号在多次 OCR 中不一致，无法安全匹配模板｜处理建议=重点检查序号后的零件图号是否清晰、完整。",
  ].join("\n"));
  return Response.json({});
};
const oldSplitResult = await worker.fetch(request("/api/results/split"), env);
const oldSplitPayload = await oldSplitResult.json();
assert.equal(oldSplitPayload.completion.total, 4);
assert.equal(oldSplitPayload.completion.unit, "个图纸文件");
assert.equal(oldSplitPayload.successes[0].title, "#2330");
assert.equal(oldSplitPayload.issues[0].title, "#2260");

// 调度判定：命中前端计划才触发；禁用、已触发、或配置更新时间晚于计划都不得触发。
const scheduleConfig = {
  timezone: "Asia/Shanghai",
  tasks: {
    split: { enabled: false, schedule_mode: "daily", minute: 0, times: [] },
    parts: {
      enabled: true,
      schedule_mode: "daily",
      minute: 0,
      times: ["17:00", "12:00"],
      schedule_updated_at: "2026-09-16T08:35:00Z",
    },
  },
};
const emptyState = { version: 1, parts: { dispatched: [] } };
const due = duePartsSlots(scheduleConfig, emptyState, new Date("2026-09-16T09:03:00Z"));
assert.deepEqual(due.map((item) => item.scheduledFor), ["2026-09-16T17:00:00+08:00"]);
assert.deepEqual(
  duePartsSlots(scheduleConfig, { version: 1, parts: { dispatched: ["2026-09-16T17:00:00+08:00"] } }, new Date("2026-09-16T09:03:00Z")),
  [],
);
assert.deepEqual(
  duePartsSlots({ ...scheduleConfig, tasks: { ...scheduleConfig.tasks, parts: { ...scheduleConfig.tasks.parts, enabled: false } } }, emptyState, new Date("2026-09-16T09:03:00Z")),
  [],
);
assert.deepEqual(
  duePartsSlots({ ...scheduleConfig, tasks: { ...scheduleConfig.tasks, parts: { ...scheduleConfig.tasks.parts, schedule_updated_at: "2026-09-16T09:01:00Z" } } }, emptyState, new Date("2026-09-16T09:03:00Z")),
  [],
);

// 真正的后台 tick：读取控制台配置 -> workflow_dispatch -> 写入去重状态。
const schedulerCalls = [];
global.fetch = async (url, init = {}) => {
  const text = String(url);
  schedulerCalls.push({ url: text, init });
  if (text.includes(`/repos/zx18522296069-commits/shengchan-control-panel/contents/backend/config.json`)) {
    return Response.json({ content: encoded(scheduleConfig), sha: "config-sha" });
  }
  if (text.includes(`/repos/zx18522296069-commits/shengchan-control-panel/contents/backend/scheduler_state.json`) && (!init.method || init.method === "GET")) {
    return Response.json({ content: encoded(emptyState), sha: "state-sha" });
  }
  if (text.includes(`/repos/zx18522296069-commits/weijiagong-lingjian-guidang/actions/workflows/update_parts.yml/dispatches`)) {
    return new Response(null, { status: 204 });
  }
  if (text.includes(`/repos/zx18522296069-commits/shengchan-control-panel/contents/backend/scheduler_state.json`) && init.method === "PUT") {
    return Response.json({ commit: { sha: "state-commit" } });
  }
  throw new Error(`unexpected scheduler request: ${text}`);
};
const tick = await runSchedulerTick(env, new Date("2026-09-16T09:03:00Z"));
assert.deepEqual(tick.dispatched, ["2026-09-16T17:00:00+08:00"]);
const scheduledDispatch = schedulerCalls.find((item) => item.url.includes("weijiagong-lingjian-guidang/actions/workflows/update_parts.yml/dispatches"));
assert.ok(scheduledDispatch);
assert.deepEqual(JSON.parse(scheduledDispatch.init.body).inputs, {
  mode: "production",
  trigger_source: "control-panel-scheduler",
  scheduled_for: "2026-09-16T17:00:00+08:00",
});
assert.ok(schedulerCalls.some((item) => item.url.includes("backend/scheduler_state.json") && item.init.method === "PUT"));

// 保存前端未加工时间只能更新控制台 config，禁止再写 update_parts.yml 的 schedule。
const previousConfig = {
  timezone: "Asia/Shanghai",
  tasks: {
    split: { enabled: false, schedule_mode: "daily", minute: 0, times: [] },
    parts: { enabled: true, schedule_mode: "daily", minute: 0, times: ["17:00", "12:00"], schedule_updated_at: "2026-09-16T08:35:00Z" },
  },
};
const nextConfig = {
  timezone: "Asia/Shanghai",
  tasks: {
    split: { enabled: false, schedule_mode: "daily", minute: 0, times: [] },
    parts: { enabled: true, schedule_mode: "daily", minute: 0, times: ["18:00", "12:30"] },
  },
};
const saveCalls = [];
global.fetch = async (url, init = {}) => {
  const text = String(url);
  saveCalls.push({ url: text, init });
  if (text.includes(`/repos/zx18522296069-commits/shengchan-control-panel/contents/backend/config.json`) && (!init.method || init.method === "GET")) {
    return Response.json({ content: encoded(previousConfig), sha: "config-sha" });
  }
  if (text.includes(`/repos/zx18522296069-commits/tuzhichaifen/contents/.github/workflows/split_drawing.yml`)) {
    return Response.json({ content: encoded("name: split\non:\n  workflow_dispatch:\n"), sha: "split-sha" });
  }
  if (text.includes(`/repos/zx18522296069-commits/shengchan-control-panel/contents/backend/config.json`) && init.method === "PUT") {
    return Response.json({ commit: { sha: "config-commit" } });
  }
  throw new Error(`unexpected save request: ${text}`);
};
const savedResponse = await worker.fetch(request("/api/config", { method: "POST", body: JSON.stringify(nextConfig) }), env);
assert.equal(savedResponse.status, 200);
const savedPayload = await savedResponse.json();
assert.equal(savedPayload.commits.parts, "control-panel-scheduler");
assert.ok(saveCalls.some((item) => item.url.includes("shengchan-control-panel/contents/backend/config.json") && item.init.method === "PUT"));
assert.ok(!saveCalls.some((item) => item.url.includes("weijiagong-lingjian-guidang/contents/.github/workflows/update_parts.yml")));

global.fetch = originalFetch;
console.log("Worker routes, dispatch, incremental status, PDF parsing, control-panel scheduling, and dedup tests passed");
