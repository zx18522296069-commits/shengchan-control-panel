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

// The production log format is board-first.  Supplementary source files must
// remain warnings, while #2260 is the only "not split" record.
global.fetch = async (url) => {
  if (String(url).includes("/actions/workflows/") && String(url).includes("/runs?")) {
    return Response.json({ workflow_runs: [{ id: 2260, run_number: 48, status: "completed", conclusion: "failure", event: "workflow_dispatch", updated_at: "2026-09-14T15:48:41Z", html_url: "https://example.test/run/2260" }] });
  }
  if (String(url).includes("/actions/runs/2260/jobs")) return Response.json({ jobs: [{ id: 2261, name: "split" }] });
  if (String(url).includes("/actions/jobs/2261/logs")) return new Response([
    "2026-09-14 15:43:12,697 WARNING 跳过不可读基础表：模板.xlsm：未找到汇总表表头",
    "2026-09-14 15:48:38,704 ERROR 处理失败｜阶段=图片识别失败｜文件=#2260.png；OCR/版式识别未通过：零件图号在多次 OCR 中不一致，无法安全匹配模板｜处理建议=重点检查序号后的零件图号是否清晰、完整，以及钢板重量是否可读；标题栏和程序号不作为失败条件。确认后保留原文件重新执行。",
  ].join("\n"));
  return Response.json({});
};
const splitResult = await worker.fetch(request("/api/results/split"), env);
assert.equal(splitResult.status, 200);
const splitPayload = await splitResult.json();
assert.equal(splitPayload.issues.length, 1);
assert.deepEqual(splitPayload.issues[0], {
  title: "#2260",
  record_status: "未拆出",
  cause: "图片识别失败：OCR/版式识别未通过：零件图号在多次 OCR 中不一致，无法安全匹配模板",
  action: "重点检查序号后的零件图号是否清晰、完整，以及钢板重量是否可读；标题栏和程序号不作为失败条件。确认后保留原文件重新执行。",
  reason: "图片识别失败：OCR/版式识别未通过：零件图号在多次 OCR 中不一致，无法安全匹配模板｜下一步：重点检查序号后的零件图号是否清晰、完整，以及钢板重量是否可读；标题栏和程序号不作为失败条件。确认后保留原文件重新执行。",
});
assert.equal(splitPayload.warnings.length, 1);
assert.equal(splitPayload.warnings[0].title, "模板.xlsm");

global.fetch = originalFetch;
console.log("Worker route, authentication, dispatch, and status tests passed");
