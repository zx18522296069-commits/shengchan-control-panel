const API_VERSION = "2022-11-28";
const CONTROL_API_REVISION = "2026-09-20.4";
const ALLOWED_ORIGIN = "https://zx18522296069-commits.github.io";
const CONTROL_REPO = "zx18522296069-commits/shengchan-control-panel";
const CONFIG_PATH = "backend/config.json";
const SCHEDULER_STATE_PATH = "backend/scheduler_state.json";
const SCHEDULER_AUDIENCE = "production-control-scheduler";
const SCHEDULER_WORKFLOW = `${CONTROL_REPO}/.github/workflows/scheduler-heartbeat.yml@refs/heads/main`;
const SHANGHAI_OFFSET = "+08:00";
const SCHEDULER_LOOKBACK_MS = 60 * 60 * 1000;

const RESULT_LINKS = {
  split: [{ label: "打开拆图结果文件夹", url: "https://drive.google.com/drive/folders/1lr9AUd9hO81Ylbkt4iJf88og4aazC797" }],
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
    inputs: { mode: "production", trigger_source: "control-panel-manual", scheduled_for: "" },
  },
  draw: {
    repo: "zx18522296069-commits/pdf-dxf-huatu",
    workflow: "chat-draw.yml",
    inputs: {},
  },
};

// 配置文件读取失败时必须默认“不自动运行”，禁止在代码里保留任何业务固定时间。
const DEFAULT_CONFIG = {
  timezone: "Asia/Shanghai",
  tasks: {
    split: { enabled: false, schedule_mode: "daily", minute: 0, times: [] },
    parts: { enabled: false, schedule_mode: "daily", minute: 0, times: [], schedule_updated_at: null },
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

async function startDraw(env, orderName) {
  const name = String(orderName || "").trim();
  throw Object.assign(new Error(
    name
      ? `画图已切换为ChatGPT Chat模式。请在固定画图Chat中发送序号 ${name}，本控制台只显示状态和结果。`
      : "画图已切换为ChatGPT Chat模式。请在固定画图Chat中发送订单序号。"
  ), { status: 422 });
}

function actionsOnlyError() {
  throw Object.assign(new Error("当前 GitHub Actions 模式仅支持从 Google Drive 按订单执行画图"), { status: 422 });
}

async function zipEntryText(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const text = new TextDecoder();
  for (let offset = 0; offset + 30 <= bytes.length;) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
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
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(env), redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("GitHub 日志下载地址缺失");
    const redirected = await fetch(location);
    if (!redirected.ok) throw new Error(`GitHub 日志下载失败（${redirected.status}）`);
    const body = await redirected.arrayBuffer();
    const bytes = new Uint8Array(body);
    return bytes.length >= 4 && new DataView(body).getUint32(0, true) === 0x04034b50 ? zipEntryText(body) : new TextDecoder().decode(bytes);
  }
  if (!response.ok) throw new Error(`GitHub 日志读取失败（${response.status}）`);
  const body = await response.arrayBuffer();
  const bytes = new Uint8Array(body);
  return bytes.length >= 4 && new DataView(body).getUint32(0, true) === 0x04034b50 ? zipEntryText(body) : new TextDecoder().decode(bytes);
}

async function dispatch(env, task, inputOverrides = {}) {
  const target = TASKS[task];
  const inputs = { ...target.inputs, ...inputOverrides };
  try {
    await github(env, `/repos/${target.repo}/actions/workflows/${target.workflow}/dispatches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs }),
    });
  } catch (error) {
    if (error?.status === 403 || error?.status === 404) {
      throw Object.assign(new Error(
        `GITHUB_TOKEN 无法触发 ${target.repo} 的 ${target.workflow}。请给该 Token 授权此仓库，并开启 Actions: Read and write。`
      ), { status: 403 });
    }
    throw error;
  }
  return { status: "requested", workflow: target.workflow, inputs };
}

async function drawSequenceForRun(env, run) {
  if (!run?.head_sha) return "";
  const target = TASKS.draw;
  const commit = await github(env, `/repos/${target.repo}/commits/${encodeURIComponent(run.head_sha)}`);
  for (const file of commit.files || []) {
    const match = String(file.filename || "").match(/^chat_jobs\/([^/]+)\/ready\.json$/);
    if (match) return match[1];
  }
  return "";
}

async function latestWorkflowRun(env, task, orderRef = "") {
  const target = TASKS[task];
  const requestedOrder = task === "draw" ? String(orderRef || "").trim() : "";
  const perPage = requestedOrder ? 30 : 1;
  const payload = await github(env, `/repos/${target.repo}/actions/workflows/${target.workflow}/runs?branch=main&per_page=${perPage}`);
  const runs = payload.workflow_runs || [];
  if (!requestedOrder) return runs[0] || null;

  for (const run of runs) {
    try {
      const orderSequence = await drawSequenceForRun(env, run);
      if (orderSequence === requestedOrder) return { ...run, order_sequence: orderSequence };
    } catch (error) {
      if (error?.status === 403 || error?.status === 404) throw error;
    }
  }
  return null;
}

async function workflowStatus(env, task, orderRef = "") {
  const latest = await latestWorkflowRun(env, task, orderRef);
  if (!latest) return { task, order_sequence: task === "draw" ? String(orderRef || "").trim() : "", status: "no_runs", checked_at: new Date().toISOString() };
  return {
    task,
    order_sequence: latest.order_sequence || (task === "draw" ? String(orderRef || "").trim() : ""),
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

async function safeWorkflowStatus(env, task, orderRef = "") {
  try {
    return await workflowStatus(env, task, orderRef);
  } catch (error) {
    const target = TASKS[task];
    return {
      task,
      status: "api_error",
      detail: (error?.status === 403 || error?.status === 404)
        ? `GITHUB_TOKEN 无法读取 ${target.repo} 的 ${target.workflow}，请检查该仓库授权和 Actions 权限`
        : (error?.message || "状态读取失败"),
      checked_at: new Date().toISOString(),
    };
  }
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

function fatalIssue(lines) {
  return lines.map((line) => line.match(/(?:ValueError|RuntimeError|FileNotFoundError):\s*(.+)$/)?.[1]).filter(Boolean).at(-1) || "";
}

function splitBoardId(filename) {
  const stem = filename.replace(/^完成_/, "").replace(/\.[^.]+$/, "").trim();
  return stem.split(/\s+/)[0] || stem || filename;
}

function parsePartsResult(log, latest) {
  const lines = log.split(/\r?\n/).map(cleanLogLine);
  const orderTotal = Number(lines.map((line) => line.match(/发现订单原始汇总表\s+(\d+)\s+个/)?.[1]).filter(Boolean).at(-1) || 0);
  const pendingTotal = Number(
    lines.map((line) => line.match(/拆图结果根目录待处理完成文件\s+(\d+)\s+个/)?.[1]).filter(Boolean).at(-1)
      || lines.map((line) => line.match(/待处理板材\s*(\d+)\s*张/)?.[1]).filter(Boolean).at(-1)
      || 0,
  );
  const boardOutcomes = new Map();
  const fallbackBoards = new Map();
  const sourceIssues = [];
  const warnings = [];
  let reusedSources = null;
  let refreshedSources = null;

  for (const line of lines) {
    let match = line.match(/^板材处理结果｜文件=([^｜]+)｜板材=([^｜]+)｜状态=([^｜]+)｜原因=([^｜]+)｜处理建议=(.+)$/);
    if (match) {
      const [, filename, board, record_status, cause, action] = match;
      const success = record_status.startsWith("已") && !record_status.includes("未");
      boardOutcomes.set(board, success ? {
        success: true,
        item: { title: `板材 ${board}`, record_status, detail: cause || record_status },
      } : {
        success: false,
        item: { title: `${board}（${filename}）`, record_status, cause, action, reason: cause },
      });
      continue;
    }

    match = line.match(/^订单源增量处理：复用缓存\s+(\d+)\s+个，重新下载解析\s+(\d+)\s+个$/);
    if (match) {
      reusedSources = Number(match[1]);
      refreshedSources = Number(match[2]);
      continue;
    }

    match = line.match(/^(?:复用订单源缓存|重新读取订单源|读取订单源)\s+(.+?)：\s*(\d+)\s+条零件$/);
    if (match) continue;

    match = line.match(/^订单源未完成\s+(.+?):\s*(.+)$/);
    if (match) {
      sourceIssues.push({ title: match[1], record_status: "订单源未完成", cause: match[2], action: "修正该订单原始汇总表后重新执行。", reason: match[2] });
      continue;
    }
    match = line.match(/^复用订单源异常缓存\s+(.+?):\s*(.+)$/);
    if (match) {
      sourceIssues.push({ title: match[1], record_status: "订单源未完成", cause: match[2], action: "修正该订单原始汇总表后重新执行。", reason: match[2] });
      continue;
    }
    match = line.match(/^未完成订单\s+(.+?):\s*(.+)$/);
    if (match) {
      sourceIssues.push({ title: match[1], record_status: "订单源未完成", cause: match[2], action: "修正该订单原始汇总表后重新执行。", reason: match[2] });
      continue;
    }

    match = line.match(/^板材\s+(.+?)\s+校验通过：计入\s+(\d+)\s+件$/);
    if (match) {
      fallbackBoards.set(match[1], {
        success: true,
        item: { title: `板材 ${match[1]}`, detail: `成功计入 ${match[2]} 件` },
      });
      continue;
    }
    match = line.match(/^板材\s+(.+?)\s+阻断：(.+)$/);
    if (match) {
      fallbackBoards.set(match[1], {
        success: false,
        item: { title: `板材 ${match[1]}`, record_status: "未累计、未记录", cause: match[2], action: "核对该板拆图结果和对应订单原始汇总表后重新执行。", reason: match[2] },
      });
      continue;
    }
    match = line.match(/^测试发现阻断板材\s+(.+?):\s*(.+)$/);
    if (match) {
      fallbackBoards.set(match[1], {
        success: false,
        item: { title: `板材 ${match[1]}`, record_status: "未累计、未记录", cause: match[2], action: "核对该板拆图结果和对应订单原始汇总表后重新执行。", reason: match[2] },
      });
      continue;
    }
    match = line.match(/^板材\s+(.+?)\s+已入账但根目录文件无法安全补归档：(.+)$/);
    if (match) {
      warnings.push({ title: `板材 ${match[1]}`, reason: match[2] });
      continue;
    }
    match = line.match(/^板材\s+(.+?)\s+编号重复但内容不同：(.+)$/);
    if (match) warnings.push({ title: `同号板材 ${match[1]}`, reason: match[2] });
  }

  for (const [board, outcome] of fallbackBoards) {
    if (!boardOutcomes.has(board)) boardOutcomes.set(board, outcome);
  }

  const boardSuccesses = [];
  const boardIssues = [];
  for (const outcome of boardOutcomes.values()) {
    if (outcome.success) boardSuccesses.push(outcome.item);
    else boardIssues.push(outcome.item);
  }

  const fatal = fatalIssue(lines);
  const fatalIssues = fatal ? [{ title: "任务中断", record_status: "运行异常", cause: fatal, action: "打开 GitHub 运行日志核对后重新执行。", reason: fatal }] : [];
  const issues = uniqueItems([...boardIssues, ...sourceIssues, ...fatalIssues]);
  const completed = boardSuccesses.length;
  const total = pendingTotal || boardOutcomes.size;
  const percent = total ? Math.round((completed / total) * 100) : (latest.conclusion === "success" ? 100 : 0);
  const remaining = lines.map((line) => line.match(/生成后活动订单当前剩余件数\s+(-?\d+)/)?.[1]).filter(Boolean).at(-1);
  const weight = lines.map((line) => line.match(/生成后活动订单当前未出重量\s+([\d.]+)\s+t/)?.[1]).filter(Boolean).at(-1);
  const summary = [];

  if (total === 0 && latest.conclusion === "success") summary.push("本次没有待处理板材，台账已刷新");
  else if (completed) summary.push(`本次成功处理 ${completed}/${total || completed} 张板材`);
  if (reusedSources !== null && refreshedSources !== null) {
    summary.push(`订单源：复用缓存 ${reusedSources} 个，重新下载解析 ${refreshedSources} 个`);
  } else if (orderTotal) {
    summary.push(`当前订单源 ${orderTotal} 个`);
  }
  if (remaining !== undefined) summary.push(`当前剩余 ${remaining} 件`);
  if (weight !== undefined) summary.push(`当前未出重量 ${weight} t`);

  let status = latest.conclusion || "unknown";
  if (fatal) status = "failure";
  else if (issues.length) status = completed || latest.conclusion === "success" ? "partial" : "failure";

  return {
    status,
    completion: { percent, completed, total, unit: "张板材" },
    summary,
    successes: uniqueItems(boardSuccesses),
    issues,
    warnings: uniqueItems(warnings),
  };
}

function parseSplitResult(log, latest) {
  const lines = log.split(/\r?\n/).map(cleanLogLine);
  const total = Number(lines.map((line) => line.match(/扫描到\s+(\d+)\s+(?:个未完成图纸文件(?:（图片\/PDF）)?|张未完成图片(?:\/PDF)?)/)?.[1]).filter(Boolean).at(-1) || 0);
  const successes = [];
  const issues = [];
  const warnings = [];
  for (const line of lines) {
    let match = line.match(/^处理失败：(.+?)：(.+)$/);
    if (match) issues.push({ title: match[1], record_status: "未拆出", cause: match[2], action: "核对该板图纸和基础资料后重新执行。", reason: match[2] });
    match = line.match(/^处理失败｜阶段=([^｜]+)｜文件=([^；]+)；([^｜]+)｜处理建议=(.+)$/);
    if (match) {
      const [, stage, filename, cause, action] = match;
      issues.push({
        title: splitBoardId(filename),
        record_status: "未拆出",
        cause: `${stage}：${cause}`,
        action,
        reason: `${stage}：${cause}｜下一步：${action}`,
      });
    }
    match = line.match(/^(?:处理|验证)(?:成功|完成)[：:]\s*(.+?)\s*->\s*(.+)$/);
    if (match) successes.push({ title: splitBoardId(match[1]), detail: `已生成 ${match[2].trim()}` });
    match = line.match(/^跳过不可读基础表：(.+?)：(.+)$/);
    if (match) warnings.push({ title: match[1], reason: match[2] });
  }
  const fatal = fatalIssue(lines);
  if (fatal && !issues.length) issues.push({ title: "运行异常", record_status: "未拆出", cause: fatal, action: "打开 GitHub 运行日志核对后重新执行。", reason: fatal });
  const completed = Math.min(successes.length, total || successes.length);
  const percent = total ? Math.round((completed / total) * 100) : (latest.conclusion === "success" ? 100 : 0);
  return {
    status: issues.length ? (completed ? "partial" : "failure") : (latest.conclusion || "unknown"),
    completion: { percent, completed, total: total || completed, unit: "个图纸文件" },
    summary: warnings.length ? [`另有 ${warnings.length} 个基础表无法读取，已跳过`] : [],
    successes: uniqueItems(successes),
    issues: uniqueItems(issues),
    warnings: uniqueItems(warnings),
  };
}

function parseDrawResult(log, latest) {
  const lines = log.split(/\r?\n/).map(cleanLogLine);
  const stepMap = new Map();
  for (const line of lines) {
    const match = line.match(/^(?:DRAW_STEP|DRAW_FINAL_STEP)=(\d+)\|([^|]+)\|(.*)$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 0 || index > 5) continue;
    stepMap.set(index, { status: match[2] || "pending", text: match[3] || "等待任务数据" });
  }
  const steps = Array.from({ length: 6 }, (_, index) => stepMap.get(index) || { status: "pending", text: "等待任务数据" });
  const encoded = lines
    .map((line) => line.match(/^(?:DRAW_RESULT_JSON|DRAW_FINAL_RESULT_JSON)=(\{.*\})$/)?.[1])
    .filter(Boolean)
    .at(-1);
  if (!encoded) {
    const completedSteps = steps.filter((item) => item.status === "ok").length;
    if (latest.status && latest.status !== "completed") {
      return {
        status: latest.status,
        completion: { percent: Math.round((completedSteps / 6) * 100), completed: completedSteps, total: 6, unit: "个阶段" },
        summary: ["画图任务正在运行，阶段状态来自当前 GitHub Actions 日志"],
        successes: [],
        warnings: [],
        issues: [],
        steps,
        issue_count: 0,
      };
    }
    const failure = fatalIssue(lines) || (latest.conclusion === "success" ? "画图运行完成，但未找到结构化结果" : "画图运行失败，请打开 GitHub 日志查看");
    return {
      status: latest.conclusion === "success" ? "partial" : "failure",
      completion: { percent: Math.round((completedSteps / 6) * 100), completed: completedSteps, total: 6, unit: "个阶段" },
      summary: [], successes: [], warnings: [],
      issues: [{ title: "画图任务", record_status: "需要检查", cause: failure, action: "打开 GitHub 运行日志核对。", reason: failure }],
      steps,
      issue_count: 1,
    };
  }
  let payload;
  try { payload = JSON.parse(encoded); } catch { throw new Error("画图运行结果格式无法读取"); }
  const rawStatus = String(payload.status || "").toLowerCase();
  const status = rawStatus === "completed" ? "success" : rawStatus === "needs_review" ? "partial" : "failure";
  const alerts = Array.isArray(payload.alerts) ? payload.alerts.map(String) : [];
  return {
    status,
    completion: { percent: status === "success" ? 100 : 83, completed: status === "success" ? 6 : 5, total: 6, unit: "个阶段" },
    summary: [status === "success" ? "画图流程已完成" : "候选结果已生成，仍需人工复核"],
    successes: status === "success" ? [{ title: "画图交付", detail: "已完成并通过正式门控" }] : [],
    issues: alerts.map((message) => ({ title: "画图提示", record_status: status === "failure" ? "失败" : "需要复核", cause: message, action: "按提示核对后重新执行订单。", reason: message })),
    warnings: [],
    drive_url: payload.drive_url || null,
    zip_download_url: payload.zip_download_url || null,
    order_name: payload.order_name || null,
    steps,
    issue_count: alerts.length,
  };
}

async function workflowResult(env, task, orderRef = "") {
  const target = TASKS[task];
  const latest = await latestWorkflowRun(env, task, orderRef);
  if (!latest) return { task, status: "no_runs", completion: { percent: 0, completed: 0, total: 0, unit: task === "split" ? "个图纸文件" : "张板材" }, summary: [], successes: [], issues: [], warnings: [], links: RESULT_LINKS[task] };
  const payload = await github(env, `/repos/${target.repo}/actions/runs/${latest.id}/jobs?per_page=100`);
  const expectedJob = task === "split" ? "split" : task === "draw" ? "draw" : "update";
  const job = payload.jobs?.find((item) => item.name === expectedJob) || payload.jobs?.[0];
  if (!job) throw new Error("本次运行没有可读取的任务记录");
  const log = await githubText(env, `/repos/${target.repo}/actions/jobs/${job.id}/logs`);
  const parsed = task === "split" ? parseSplitResult(log, latest) : task === "draw" ? parseDrawResult(log, latest) : parsePartsResult(log, latest);
  const links = [{ label: "打开 GitHub 运行日志", url: latest.html_url }];
  if (parsed.drive_url) links.push({ label: "打开 Google Drive", url: parsed.drive_url });
  if (parsed.zip_download_url) links.push({ label: "下载最终 ZIP", url: parsed.zip_download_url });
  if (RESULT_LINKS[task]) links.push(...RESULT_LINKS[task]);
  return { task, run_id: latest.id, run_number: latest.run_number, event: latest.event, updated_at: latest.updated_at, html_url: latest.html_url, ...parsed, links };
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
  const body = { message, content: encodeBase64(content), branch: "main" };
  if (sha) body.sha = sha;
  const payload = await github(env, `/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
  if (splitTimes.some((value) => !timePattern.test(value))) throw new Error("拆图执行时间无效");
  if (tasks.split.enabled && splitMode === "daily" && splitTimes.length !== 1) throw new Error("拆图执行时间无效");

  const partsTimes = Array.isArray(tasks.parts.times) ? tasks.parts.times.slice(0, 2) : [];
  if (partsTimes.some((value) => !timePattern.test(value))) throw new Error("未加工执行时间无效");
  if (tasks.parts.enabled && partsTimes.length !== 2) throw new Error("未加工执行时间无效");

  return {
    timezone: "Asia/Shanghai",
    tasks: {
      split: { enabled: Boolean(tasks.split.enabled), schedule_mode: splitMode, minute: Number(tasks.split.minute || 0), times: splitTimes },
      parts: { enabled: Boolean(tasks.parts.enabled), schedule_mode: "daily", minute: 0, times: partsTimes, schedule_updated_at: tasks.parts.schedule_updated_at || null },
    },
  };
}

// 拆图当前仍沿用原有控制台写 schedule 机制；未加工不再经过这里。
function toUtcCron(value) {
  const [hour, minute] = value.split(":").map(Number);
  return `${minute} ${(hour - 8 + 24) % 24} * * *`;
}

function splitCrons(task) {
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
    return validateConfig(JSON.parse(file.content));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function partsScheduleSignature(task) {
  return JSON.stringify({ enabled: Boolean(task?.enabled), times: Array.isArray(task?.times) ? task.times : [] });
}

async function saveConfig(env, payload) {
  const previous = await getConfig(env);
  const config = validateConfig(payload);
  const commits = {};

  // 拆图保持当前既有实现；未加工从此不再改写目标 workflow 的 schedule。
  const splitTarget = TASKS.split;
  const splitWorkflow = await getFile(env, splitTarget.repo, splitTarget.workflowPath);
  const updatedSplitWorkflow = replaceSchedule(splitWorkflow.content, splitCrons(config.tasks.split), config.tasks.split.enabled);
  commits.split = updatedSplitWorkflow === splitWorkflow.content
    ? "unchanged"
    : await putFile(env, splitTarget.repo, splitTarget.workflowPath, updatedSplitWorkflow, splitWorkflow.sha, "通过控制台更新split定时设置");

  const partsChanged = partsScheduleSignature(previous.tasks.parts) !== partsScheduleSignature(config.tasks.parts);
  config.tasks.parts.schedule_updated_at = partsChanged
    ? new Date().toISOString()
    : (previous.tasks.parts.schedule_updated_at || new Date().toISOString());
  commits.parts = "control-panel-scheduler";

  const current = await getFile(env, CONTROL_REPO, CONFIG_PATH);
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  commits.config = current.content === serialized
    ? "unchanged"
    : await putFile(env, CONTROL_REPO, CONFIG_PATH, serialized, current.sha, "保存生产控制台定时设置");
  return { status: "success", config, commits };
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

async function verifySchedulerIdentity(request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw Object.assign(new Error("调度器缺少 GitHub OIDC 身份"), { status: 401 });
  const segments = token.split(".");
  if (segments.length !== 3) throw Object.assign(new Error("调度器 OIDC 格式无效"), { status: 401 });

  const header = decodeJwtPart(segments[0]);
  const claims = decodeJwtPart(segments[1]);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== "https://token.actions.githubusercontent.com") throw Object.assign(new Error("调度器 OIDC 签发方无效"), { status: 403 });
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(SCHEDULER_AUDIENCE)) throw Object.assign(new Error("调度器 OIDC audience 无效"), { status: 403 });
  if (!claims.exp || claims.exp < now || (claims.nbf && claims.nbf > now + 30)) throw Object.assign(new Error("调度器 OIDC 已过期或尚未生效"), { status: 403 });
  if (claims.repository !== CONTROL_REPO || claims.ref !== "refs/heads/main" || claims.event_name !== "schedule") {
    throw Object.assign(new Error("调度器 OIDC 来源仓库或事件无效"), { status: 403 });
  }
  if (claims.workflow_ref && claims.workflow_ref !== SCHEDULER_WORKFLOW) {
    throw Object.assign(new Error("调度器 OIDC workflow 无效"), { status: 403 });
  }

  const jwksResponse = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");
  if (!jwksResponse.ok) throw new Error("GitHub OIDC 公钥读取失败");
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find((item) => item.kid === header.kid);
  if (!jwk) throw Object.assign(new Error("GitHub OIDC 公钥不匹配"), { status: 403 });
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  const signature = base64UrlBytes(segments[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!valid) throw Object.assign(new Error("调度器 OIDC 签名无效"), { status: 403 });
  return claims;
}

function shanghaiDateString(date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function previousShanghaiDate(dateString) {
  const midnight = new Date(`${dateString}T00:00:00${SHANGHAI_OFFSET}`);
  return shanghaiDateString(new Date(midnight.getTime() - 24 * 60 * 60 * 1000)).date;
}

function duePartsSlots(config, state, now = new Date()) {
  const task = config?.tasks?.parts;
  if (!task?.enabled || !Array.isArray(task.times) || !task.times.length) return [];
  const local = shanghaiDateString(now);
  const dates = [local.date, previousShanghaiDate(local.date)];
  const already = new Set(state?.parts?.dispatched || []);
  const updatedAt = task.schedule_updated_at ? Date.parse(task.schedule_updated_at) : 0;
  const nowMs = now.getTime();
  const due = [];

  for (const date of dates) {
    for (const time of task.times) {
      const scheduledFor = `${date}T${time}:00${SHANGHAI_OFFSET}`;
      const scheduledMs = Date.parse(scheduledFor);
      if (!Number.isFinite(scheduledMs)) continue;
      const age = nowMs - scheduledMs;
      if (age < 0 || age > SCHEDULER_LOOKBACK_MS) continue;
      if (updatedAt && scheduledMs < updatedAt) continue;
      if (already.has(scheduledFor)) continue;
      due.push({ scheduledFor, scheduledMs });
    }
  }
  return due.sort((a, b) => a.scheduledMs - b.scheduledMs);
}

async function getSchedulerState(env) {
  try {
    const file = await getFile(env, CONTROL_REPO, SCHEDULER_STATE_PATH);
    const parsed = JSON.parse(file.content);
    return { state: { version: 1, parts: { dispatched: parsed?.parts?.dispatched || [] } }, sha: file.sha };
  } catch (error) {
    if (error.status === 404) return { state: { version: 1, parts: { dispatched: [] } }, sha: null };
    throw error;
  }
}

async function saveSchedulerState(env, state, sha) {
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  return putFile(env, CONTROL_REPO, SCHEDULER_STATE_PATH, serialized, sha, "记录生产控制台调度去重状态");
}

function pruneSchedulerState(state, now = new Date()) {
  const cutoff = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  state.parts.dispatched = (state.parts.dispatched || []).filter((value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  return state;
}

async function runSchedulerTick(env, now = new Date()) {
  const config = await getConfig(env);
  const { state, sha } = await getSchedulerState(env);
  pruneSchedulerState(state, now);
  const due = duePartsSlots(config, state, now);
  const dispatched = [];

  for (const slot of due) {
    await dispatch(env, "parts", {
      mode: "production",
      trigger_source: "control-panel-scheduler",
      scheduled_for: slot.scheduledFor,
    });
    state.parts.dispatched.push(slot.scheduledFor);
    dispatched.push(slot.scheduledFor);
  }

  if (dispatched.length) await saveSchedulerState(env, state, sha);
  return {
    status: "success",
    checked_at: now.toISOString(),
    timezone: "Asia/Shanghai",
    due: due.map((item) => item.scheduledFor),
    dispatched,
  };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && origin !== ALLOWED_ORIGIN) return json({ detail: "来源不允许" }, 403, origin);
  if (url.pathname === "/" && request.method === "GET") {
    return json({
      status: "ok",
      service: "production-control-api",
      revision: CONTROL_API_REVISION,
    }, 200, origin);
  }
  if (url.pathname === "/api/meta" && request.method === "GET") {
    return json({
      status: "ok",
      service: "production-control-api",
      revision: CONTROL_API_REVISION,
      routes: [
        "POST /api/run/split",
        "POST /api/run/parts",
        "POST /api/run/draw",
        "GET /api/status",
        "GET /api/results/:task",
        "GET /api/config",
        "POST /api/config",
      ],
    }, 200, origin);
  }

  // 调度心跳使用 GitHub OIDC，不使用浏览器控制口令。
  if (url.pathname === "/api/scheduler/tick" && request.method === "POST") {
    try {
      await verifySchedulerIdentity(request);
      return json(await runSchedulerTick(env), 200, origin);
    } catch (error) {
      const status = [401, 403, 404, 422].includes(error.status) ? error.status : 502;
      return json({ detail: error.message || "后台调度异常" }, status, origin);
    }
  }

  if (!env.CONTROL_PANEL_KEY) return json({ detail: "CONTROL_PANEL_KEY 未配置" }, 503, origin);
  if (!await sameSecret(request.headers.get("x-control-key") || "", env.CONTROL_PANEL_KEY)) return json({ detail: "控制台口令不正确" }, 401, origin);
  try {
    if (url.pathname === "/api/run/split" && request.method === "POST") return json(await dispatch(env, "split"), 200, origin);
    if (url.pathname === "/api/run/parts" && request.method === "POST") {
      return json(await dispatch(env, "parts", { trigger_source: "control-panel-manual", scheduled_for: "" }), 200, origin);
    }
    if (url.pathname === "/api/run/draw" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      return json(await startDraw(env, payload.order_name), 200, origin);
    }
    if (url.pathname === "/api/run/draw/upload" && request.method === "POST") {
      return json(actionsOnlyError(), 200, origin);
    }
    if (url.pathname === "/api/run/draw/rerun-issues" && request.method === "POST") {
      return json(actionsOnlyError(), 200, origin);
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      const drawOrder = String(url.searchParams.get("draw_order") || "").trim();
      const [split, parts, draw] = await Promise.all([
        safeWorkflowStatus(env, "split"),
        safeWorkflowStatus(env, "parts"),
        safeWorkflowStatus(env, "draw", drawOrder),
      ]);
      return json({ split, parts, draw }, 200, origin);
    }
    const resultMatch = url.pathname.match(/^\/api\/results\/(split|parts|draw)$/);
    if (resultMatch && request.method === "GET") {
      const drawOrder = resultMatch[1] === "draw" ? String(url.searchParams.get("draw_order") || "").trim() : "";
      return json(await workflowResult(env, resultMatch[1], drawOrder), 200, origin);
    }
    const drawReviewMatch = url.pathname.match(/^\/api\/draw\/review\/([^/]+)$/);
    if (drawReviewMatch && request.method === "GET") {
      return json(actionsOnlyError(), 200, origin);
    }
    const drawPassMatch = url.pathname.match(/^\/api\/draw\/review\/([^/]+)\/([^/]+)\/pass$/);
    if (drawPassMatch && request.method === "POST") {
      return json(actionsOnlyError(), 200, origin);
    }
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

export { duePartsSlots, runSchedulerTick, validateConfig };
export default { fetch(request, env) { return handle(request, env); } };
