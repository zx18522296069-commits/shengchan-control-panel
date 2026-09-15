const API_VERSION = "2022-11-28";
const ALLOWED_ORIGIN = "https://zx18522296069-commits.github.io";
const CONTROL_REPO = "zx18522296069-commits/shengchan-control-panel";
const CONFIG_PATH = "backend/config.json";
const RESULT_LINKS = {
  split: [
    { label: "打开拆图结果文件夹", url: "https://drive.google.com/drive/folders/1lr9AUd9hO81Ylbkt4iJf88og4aazC797" },
  ],
  parts: [
    { label: "累计加工台账", url: "https://drive.google.com/open?id=1BDXfJN8afgla9Z9Al-tVQmqP107afkPb" },
    { label: "当前待加工零件", url: "https://drive.google.com/open?id=1Lw91mzMQkqEx4sAn_U6JgHaDfa6bQpUG" },
  ],
};

const TASKS = {
  split: {
    repo: "zx18522296069-commits/tuzhichaifen",
    workflow: "split_drawing.yml",
    workflowPath: ".github/workflows/split_drawing.yml",
    inputs: { dry_run: "false", only: "" },
  },
  parts: {
    repo: "zx18522296069-commits/weijiagong-lingjian-guidang",
    workflow: "update_parts.yml",
    workflowPath: ".github/workflows/update_parts.yml",
    inputs: { mode: "production" },
  },
};

const DEFAULT_CONFIG = {
  timezone: "Asia/Shanghai",
  tasks: {
    split: { enabled: true, schedule_mode: "hourly", minute: 0, times: ["22:00"] },
    parts: { enabled: true, schedule_mode: "daily", minute: 0, times: ["17:25", "22:00"] },
  },
};

function corsHeaders(origin) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, X-Control-Key",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  if (origin === ALLOWED_ORIGIN) headers["access-control-allow-origin"] = origin;
  return headers;
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

async function sameSecret(actual, expected) {
  if (!actual || !expected) return false;
  const bytes = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes.encode(actual)),
    crypto.subtle.digest("SHA-256", bytes.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function githubHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
    "user-agent": "production-control-panel",
  };
}

async function github(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN 未配置");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...githubHeaders(env), ...(options.headers || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || `GitHub 请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function zipEntryText(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const text = new TextDecoder();
  for (let offset = 0; offset + 30 <= bytes.length; ) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    // GitHub Action job logs are normal ZIP entries with known sizes.  Avoid
    // accepting data-descriptor entries, which would make the archive ambiguous.
    if (flags & 0x08) throw new Error("GitHub 日志 ZIP 格式不受支持");
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error("GitHub 日志 ZIP 已损坏");
    const data = bytes.slice(dataStart, dataEnd);
    if (method === 0) return text.decode(data);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return text.decode(await new Response(stream).arrayBuffer());
    }
    throw new Error(`GitHub 日志 ZIP 使用了不支持的压缩方式（${method}）`);
  }
  throw new Error("GitHub 日志 ZIP 中没有可读取的内容");
}

async function githubText(env, path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("GitHub 日志下载地址缺失");
    const redirected = await fetch(location);
    if (!redirected.ok) throw new Error(`GitHub 日志下载失败（${redirected.status}）`);
    const body = await redirected.arrayBuffer();
    const bytes = new Uint8Array(body);
    return bytes.length >= 4 && new DataView(body).getUint32(0, true) === 0x04034b50
      ? zipEntryText(body)
      : new TextDecoder().decode(bytes);
  }
  if (!response.ok) throw new Error(`GitHub 日志读取失败（${response.status}）`);
  const body = await response.arrayBuffer();
  const bytes = new Uint8Array(body);
  return bytes.length >= 4 && new DataView(body).getUint32(0, true) === 0x04034b50
    ? zipEntryText(body)
    : new TextDecoder().decode(bytes);
}

async function dispatch(env, task) {
  const target = TASKS[task];
  await github(env, `/repos/${target.repo}/actions/workflows/${target.workflow}/dispatches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: target.inputs }),
  });
  return { status: "requested", workflow: target.workflow };
}

async function latestWorkflowRun(env, task) {
  const target = TASKS[task];
  const payload = await github(
    env,
    `/repos/${target.repo}/actions/workflows/${target.workflow}/runs?branch=main&per_page=1`,
  );
  return payload.workflow_runs?.[0] || null;
}

async function workflowStatus(env, task) {
  const latest = await latestWorkflowRun(env, task);
  if (!latest) return { task, status: "no_runs", checked_at: new Date().toISOString() };
  return {
    task,
    status: latest.status === "completed" ? (latest.conclusion || "unknown") : latest.status,
    event: latest.event,
    run_started_at: latest.run_started_at,
    updated_at: latest.updated_at,
    html_url: latest.html_url,
    run_id: latest.id,
    run_number: latest.run_number,
    checked_at: new Date().toISOString(),
  };
}

function cleanLogLine(line) {
  return line
    .replace(/^\ufeff/, "")
    .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s+/, "")
    .replace(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+(?:INFO|WARNING|ERROR)\s+/, "")
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+\s+(?:INFO|WARNING|ERROR)\s+/, "")
    .trim();
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}\n${item.reason || item.detail || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 前端所有拆图结果都以待拆文件开头的板材编号为入口。
// “#2323 … (1)”中的 (1) 是同板号小序号，须保留；厚度、余料等
// 文件名后缀不是板材编号，不能显示在结果标题中。
function splitBoardId(filename) {
  const stem = String(filename || "")
    .replace(/^完成_/, "")
    .replace(/\.[^.]+$/, "");
  return stem.match(/#\d+(?:\s*\(\d+\))?/)?.[0] || stem.split(/\s+/)[0] || stem;
}

function fatalIssue(lines) {
  const candidates = lines
    .map((line) => line.match(/(?:ValueError|RuntimeError|FileNotFoundError):\s*(.+)$/)?.[1])
    .filter(Boolean);
  return candidates.at(-1) || "";
}

function parsePartsResult(log, latest) {
  const lines = log.split(/\r?\n/).map(cleanLogLine);
  const total = Number(lines.map((line) => line.match(/发现订单原始汇总表\s+(\d+)\s+个/)?.[1]).filter(Boolean).at(-1) || 0);
  const successes = [];
  const issues = [];
  const acceptedBoards = [];
  const warnings = [];

  for (const line of lines) {
    let match = line.match(/^读取订单源\s+(.+?)：\s*(\d+)\s+条零件$/);
    if (match) successes.push({ title: match[1], detail: `读取 ${match[2]} 条零件` });
    match = line.match(/^订单源未完成\s+(.+?):\s*(.+)$/);
    if (match) issues.push({ title: match[1], reason: match[2] });
    match = line.match(/^未完成订单\s+(.+?):\s*(.+)$/);
    if (match) issues.push({ title: match[1], reason: match[2] });
    match = line.match(/^板材\s+(.+?)\s+阻断：(.+)$/);
    if (match) issues.push({ title: `板材 ${match[1]}`, reason: match[2] });
    match = line.match(/^测试发现阻断板材\s+(.+?):\s*(.+)$/);
    if (match) issues.push({ title: `板材 ${match[1]}`, reason: match[2] });
    match = line.match(/^板材\s+(.+?)\s+已入账但根目录文件无法安全补归档：(.+)$/);
    if (match) warnings.push({ title: `板材 ${match[1]}`, reason: match[2] });
    match = line.match(/^板材\s+(.+?)\s+校验通过：计入\s+(\d+)\s+件$/);
    if (match) acceptedBoards.push({ title: `板材 ${match[1]}`, detail: `成功计入 ${match[2]} 件` });
    match = line.match(/^板材\s+(.+?)\s+编号重复但内容不同：(.+)$/);
    if (match) warnings.push({ title: `同号板材 ${match[1]}`, reason: match[2] });
  }

  const fatal = fatalIssue(lines);
  if (fatal && !issues.some((item) => fatal.includes(item.reason) || item.reason.includes(fatal))) {
    issues.push({ title: "任务中断", reason: fatal });
  }

  const completed = Math.min(successes.length, total || successes.length);
  const percent = total ? Math.round((completed / total) * 100) : (latest.conclusion === "success" ? 100 : 0);
  const remaining = lines.map((line) => line.match(/生成后活动订单当前剩余件数\s+(-?\d+)/)?.[1]).filter(Boolean).at(-1);
  const weight = lines.map((line) => line.match(/生成后活动订单当前未出重量\s+([\d.]+)\s+t/)?.[1]).filter(Boolean).at(-1);
  const summary = [];
  if (acceptedBoards.length) summary.push(`本次成功入账 ${acceptedBoards.length} 张板材`);
  if (remaining !== undefined) summary.push(`当前剩余 ${remaining} 件`);
  if (weight !== undefined) summary.push(`当前未出重量 ${weight} t`);

  return {
    status: issues.length ? (completed ? "partial" : "failure") : (latest.conclusion || "unknown"),
    completion: { percent, completed, total: total || completed, unit: "个订单" },
    summary,
    successes: uniqueItems([...acceptedBoards, ...successes]),
    issues: uniqueItems(issues),
    warnings: uniqueItems(warnings),
  };
}

function parseSplitResult(log, latest) {
  const lines = log.split(/\r?\n/).map(cleanLogLine);
  const total = Number(lines.map((line) => line.match(/扫描到\s+(\d+)\s+张未完成(?:图片|图片\/PDF)/)?.[1]).filter(Boolean).at(-1) || 0);
  const successes = [];
  const issues = [];
  const warnings = [];

  for (const line of lines) {
    let match = line.match(/^处理失败：(.+?)：(.+)$/);
    if (match) issues.push({ title: match[1], record_status: "未拆出", cause: match[2], action: "核对该板图纸和基础资料后重新执行。", reason: match[2] });
    match = line.match(/^处理失败｜阶段=([^｜]+)｜文件=([^；]+)；([^｜]+)｜处理建议=(.+)$/);
    if (match) {
      const [, stage, filename, cause, action] = match;
      const boardId = splitBoardId(filename);
      issues.push({
        title: boardId,
        record_status: "未拆出",
        cause: `${stage}：${cause}`,
        action,
        reason: `${stage}：${cause}｜下一步：${action}`,
      });
    }
    match = line.match(/^(?:处理|验证)(?:成功|完成)[：:]\s*(.+?)(?:\s*->\s*(.+))?$/);
    if (match) successes.push({
      title: splitBoardId(match[1]),
      detail: match[2] ? `已生成 ${match[2]}` : "已生成拆图结果",
    });
    match = line.match(/^跳过不可读基础表：(.+?)：(.+)$/);
    if (match) warnings.push({ title: match[1], reason: match[2] });
  }

  const fatal = fatalIssue(lines);
  // 运行级异常只在没有板材级失败信息时显示，避免把目录、模板或基础表
  // 误当作未拆出的板材。
  if (fatal && !issues.length) issues.push({ title: "运行异常", record_status: "未拆出", cause: fatal, action: "打开 GitHub 运行日志核对后重新执行。", reason: fatal });
  const completed = Math.min(successes.length, total || successes.length);
  const percent = total ? Math.round((completed / total) * 100) : (latest.conclusion === "success" ? 100 : 0);

  return {
    status: issues.length ? (completed ? "partial" : "failure") : (latest.conclusion || "unknown"),
    completion: { percent, completed, total: total || completed, unit: "张图片" },
    summary: warnings.length ? [`另有 ${warnings.length} 个基础表无法读取，已跳过`] : [],
    successes: uniqueItems(successes),
    issues: uniqueItems(issues),
    warnings: uniqueItems(warnings),
  };
}

async function workflowResult(env, task) {
  const target = TASKS[task];
  const latest = await latestWorkflowRun(env, task);
  if (!latest) return { task, status: "no_runs", completion: { percent: 0, completed: 0, total: 0, unit: task === "split" ? "张图片" : "个订单" }, summary: [], successes: [], issues: [], warnings: [], links: RESULT_LINKS[task] };
  const payload = await github(env, `/repos/${target.repo}/actions/runs/${latest.id}/jobs?per_page=100`);
  const job = payload.jobs?.find((item) => item.name === (task === "split" ? "split" : "update")) || payload.jobs?.[0];
  if (!job) throw new Error("本次运行没有可读取的任务记录");
  const log = await githubText(env, `/repos/${target.repo}/actions/jobs/${job.id}/logs`);
  const parsed = task === "split" ? parseSplitResult(log, latest) : parsePartsResult(log, latest);
  return {
    task,
    run_id: latest.id,
    run_number: latest.run_number,
    event: latest.event,
    updated_at: latest.updated_at,
    html_url: latest.html_url,
    ...parsed,
    links: RESULT_LINKS[task],
  };
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, "")), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function getFile(env, repo, path) {
  const payload = await github(env, `/repos/${repo}/contents/${path}?ref=main`);
  return { content: decodeBase64(payload.content), sha: payload.sha };
}

async function putFile(env, repo, path, content, sha, message) {
  const payload = await github(env, `/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content: encodeBase64(content), sha, branch: "main" }),
  });
  return payload.commit.sha;
}

function validateConfig(config) {
  const tasks = config?.tasks;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!tasks?.split || !tasks?.parts) throw new Error("任务设置不完整");

  const splitMode = tasks.split.schedule_mode || "daily";
  if (!["hourly", "daily"].includes(splitMode)) throw new Error("拆图执行频率无效");
  const splitTimes = Array.isArray(tasks.split.times) ? tasks.split.times.slice(0, 1) : [];
  if (splitMode === "daily" && (splitTimes.length !== 1 || !splitTimes.every((v) => timePattern.test(v)))) {
    throw new Error("拆图执行时间无效");
  }

  const partsTimes = Array.isArray(tasks.parts.times) ? tasks.parts.times.slice(0, 2) : [];
  if (partsTimes.length !== 2 || !partsTimes.every((v) => timePattern.test(v))) throw new Error("未加工执行时间无效");

  return {
    timezone: "Asia/Shanghai",
    tasks: {
      split: { enabled: Boolean(tasks.split.enabled), schedule_mode: splitMode, minute: 0, times: splitTimes },
      parts: { enabled: Boolean(tasks.parts.enabled), schedule_mode: "daily", minute: 0, times: partsTimes },
    },
  };
}

function toUtcCron(value) {
  const [hour, minute] = value.split(":").map(Number);
  return `${minute} ${(hour - 8 + 24) % 24} * * *`;
}

function crons(task) {
  if (task.schedule_mode === "hourly") return [`${Number(task.minute || 0)} * * * *`];
  return task.times.map(toUtcCron);
}

function replaceSchedule(workflow, values, enabled) {
  const schedulePattern = /^  schedule:\n(?:(?:    .*|[ \t]*)\n)*/m;
  const stripped = workflow.replace(schedulePattern, "");
  if (!enabled) return stripped;
  const schedule = `  schedule:\n${values.map((value) => `    - cron: '${value}'\n`).join("")}`;
  if (!/^on:[ \t]*$/m.test(stripped)) throw new Error("工作流缺少 on 配置");
  return stripped.replace(/^on:[ \t]*$/m, (match) => `${match}\n${schedule.trimEnd()}`);
}

async function getConfig(env) {
  try {
    const file = await getFile(env, CONTROL_REPO, CONFIG_PATH);
    return JSON.parse(file.content);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(env, payload) {
  const config = validateConfig(payload);
  const commits = {};
  for (const key of ["split", "parts"]) {
    const target = TASKS[key];
    const file = await getFile(env, target.repo, target.workflowPath);
    const updated = replaceSchedule(file.content, crons(config.tasks[key]), config.tasks[key].enabled);
    commits[key] = updated === file.content
      ? "unchanged"
      : await putFile(env, target.repo, target.workflowPath, updated, file.sha, `通过控制台更新${key}定时设置`);
  }
  const current = await getFile(env, CONTROL_REPO, CONFIG_PATH);
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  commits.config = current.content === serialized
    ? "unchanged"
    : await putFile(env, CONTROL_REPO, CONFIG_PATH, serialized, current.sha, "保存生产控制台定时设置");
  return { status: "success", config, commits };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && origin !== ALLOWED_ORIGIN) return json({ detail: "来源不允许" }, 403, origin);
  if (url.pathname === "/" && request.method === "GET") return json({ status: "ok", service: "production-control-api" }, 200, origin);

  if (!env.CONTROL_PANEL_KEY) return json({ detail: "CONTROL_PANEL_KEY 未配置" }, 503, origin);
  if (!await sameSecret(request.headers.get("x-control-key") || "", env.CONTROL_PANEL_KEY)) {
    return json({ detail: "控制台口令不正确" }, 401, origin);
  }

  try {
    if (url.pathname === "/api/run/split" && request.method === "POST") return json(await dispatch(env, "split"), 200, origin);
    if (url.pathname === "/api/run/parts" && request.method === "POST") return json(await dispatch(env, "parts"), 200, origin);
    if (url.pathname === "/api/status" && request.method === "GET") {
      const [split, parts] = await Promise.all([workflowStatus(env, "split"), workflowStatus(env, "parts")]);
      return json({ split, parts }, 200, origin);
    }
    const resultMatch = url.pathname.match(/^\/api\/results\/(split|parts)$/);
    if (resultMatch && request.method === "GET") return json(await workflowResult(env, resultMatch[1]), 200, origin);
    if (url.pathname === "/api/config" && request.method === "GET") return json(await getConfig(env), 200, origin);
    if (url.pathname === "/api/config" && request.method === "POST") {
      try {
        return json(await saveConfig(env, await request.json()), 200, origin);
      } catch (error) {
        if (/设置|时间|频率/.test(error.message || "")) error.status = 422;
        throw error;
      }
    }
    return json({ detail: "Not found" }, 404, origin);
  } catch (error) {
    const status = [401, 403, 404, 422].includes(error.status) ? error.status : 502;
    return json({ detail: error.message || "控制服务异常" }, status, origin);
  }
}

export default { fetch(request, env) { return handle(request, env); } };
