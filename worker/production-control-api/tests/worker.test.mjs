import assert from "node:assert/strict";
import worker from "../worker/index.js";

const env = { CONTROL_PANEL_KEY: "test-key", GITHUB_TOKEN: "test-token" };
const origin = "https://zx18522296069-commits.github.io";

function request(path, init = {}) {
  return new Request(`https://api.example${path}`, {
    ...init,
    headers: { origin, "x-control-key": "test-key", ...(init.headers || {}) },
  });
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
  if (String(url).includes("/dispatches")) return new Response(null, { status: 204 });
  if (String(url).includes("/actions/workflows/") && String(url).includes("/runs?")) {
    return Response.json({ workflow_runs: [{
      id: 123, run_number: 14, status: "completed", conclusion: "failure",
      event: "workflow_dispatch", updated_at: "2026-09-11T11:35:09Z", html_url: "https://example.test/run/123",
    }] });
  }
  if (String(url).includes("/actions/runs/123/jobs")) {
    return Response.json({ jobs: [{ id: 456, name: "update" }] });
  }
  if (String(url).includes("/actions/jobs/456/logs")) {
    return new Response([
      "2026-09-11T11:33:51Z [2026-09-11T19:33:51+08:00] INFO 发现订单原始汇总表 2 个",
      "2026-09-11T11:34:01Z [2026-09-11T19:34:01+08:00] INFO 读取订单源 159.26-07-15  YT71S-2500Z-0715 已做完核算表：56 条零件",
      "2026-09-11T11:34:02Z [2026-09-11T19:34:02+08:00] WARNING 订单源未完成 THP11-10000Q-0825: 订单号不一致",
      "2026-09-11T11:34:03Z [2026-09-11T19:34:03+08:00] INFO 板材 #88 编号重复但内容不同：按新板材继续校验并分别入账",
    ].join("\n"));
  }
  return Response.json({});
};

const split = await worker.fetch(request("/api/run/split", { method: "POST" }), env);
assert.equal(split.status, 200);
assert.equal((await split.json()).status, "requested");
assert.match(calls[0].url, /tuzhichaifen\/actions\/workflows\/split_drawing\.yml\/dispatches$/);
assert.deepEqual(JSON.parse(calls[0].init.body).inputs, { dry_run: "false", only: "" });

const status = await worker.fetch(request("/api/status"), env);
assert.equal(status.status, 200);
assert.deepEqual(Object.keys(await status.json()).sort(), ["parts", "split"]);

const result = await worker.fetch(request("/api/results/parts"), env);
assert.equal(result.status, 200);
const resultPayload = await result.json();
assert.equal(resultPayload.completion.percent, 50);
assert.equal(resultPayload.completion.completed, 1);
assert.equal(resultPayload.issues[0].title, "THP11-10000Q-0825");
assert.match(resultPayload.issues[0].reason, /订单号不一致/);
assert.equal(resultPayload.warnings[0].title, "同号板材 #88");

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

global.fetch = originalFetch;
console.log("Worker route, authentication, dispatch, PDF parsing, and status tests passed");
