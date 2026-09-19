const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://production-control-api.zx18522296069.chatgpt.site').replace(/\/$/, '');

export function hasControlKey() {
  return Boolean(window.sessionStorage.getItem('control-panel-key'));
}

export function setControlKey(value) {
  if (value) window.sessionStorage.setItem('control-panel-key', value);
  else window.sessionStorage.removeItem('control-panel-key');
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Control-Key': window.sessionStorage.getItem('control-panel-key') || '',
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch {
    throw new Error('控制服务未连接');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === 'error') {
    const error = new Error(payload.detail || payload.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function requestMultipart(path, formData) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'X-Control-Key': window.sessionStorage.getItem('control-panel-key') || '',
      },
      body: formData,
    });
  } catch {
    throw new Error('控制服务未连接');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === 'error') {
    const error = new Error(payload.detail || payload.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function boardKey(item = {}) {
  const text = `${item.board_id || ''} ${item.title || ''} ${item.filename || ''}`;
  return text.match(/#\d+(?:-\d+)?/)?.[0]
    || text.match(/废\d+(?:-\d+)?/)?.[0]
    || '';
}

function isSuccessfulBoard(item = {}) {
  const status = String(item.record_status || '');
  return status.startsWith('已') && !status.includes('未');
}

function normalizePartsResult(payload) {
  if (!payload || payload.task !== 'parts') return payload;

  // “本次扫描板材数”只能来自本轮逐板处理结果。
  // completion.total 可能来自旧 Worker 的订单源数量，永远不能参与板材计数。
  const rows = new Map();
  for (const item of Array.isArray(payload.board_results) ? payload.board_results : []) {
    const key = boardKey(item);
    if (!key) continue;
    rows.set(key, item);
  }

  for (const item of Array.isArray(payload.successes) ? payload.successes : []) {
    const key = boardKey(item);
    if (!key || rows.has(key)) continue;
    rows.set(key, {
      title: item.title || key,
      board_id: key,
      record_status: item.record_status || '已累计、已处理',
      cause: item.cause || item.detail || '本次处理成功',
      action: item.action || '已移动到“已录入数量”。',
    });
  }

  const sourceIssues = [];
  for (const item of Array.isArray(payload.issues) ? payload.issues : []) {
    const status = String(item.record_status || '');
    const key = boardKey(item);
    if (status === '未累计、未记录' || status.includes('未累计')) {
      if (!key) continue;
      rows.set(key, {
        title: item.title || key,
        board_id: key,
        record_status: item.record_status || '未累计、未记录',
        cause: item.cause || item.reason || '未提供原因',
        action: item.action || '核对该板拆图结果和对应订单原始汇总表后重新执行。',
      });
      continue;
    }
    // 订单源异常、缺失汇总表、运行异常等不进入板材计数，但必须让用户看见。
    sourceIssues.push({
      title: item.title || '订单源异常',
      reason: item.cause || item.reason || item.detail || status || '未提供原因',
    });
  }

  // 兼容尚未更新的线上 Worker：历史已入账但本次无法复核的板材，
  // 旧接口可能放在 warnings 而不是 issues。只把明确“本次未成功”的逐板 warning 补进来。
  const nonBoardWarnings = [];
  for (const item of Array.isArray(payload.warnings) ? payload.warnings : []) {
    const key = boardKey(item);
    const detail = `${item.record_status || ''} ${item.cause || ''} ${item.reason || ''} ${item.detail || ''}`;
    if (key && /无法复核|无法安全补归档|保留根目录|内容冲突|内容不同|不重复扣减、不归档|未累计|未记录/.test(detail)) {
      if (!rows.has(key)) {
        rows.set(key, {
          title: item.title || key,
          board_id: key,
          record_status: '未累计、未记录',
          cause: item.cause || item.reason || item.detail || '本次未能安全完成入账',
          action: item.action || '核对该板当前文件与历史入账记录及对应订单原始汇总表后重新执行。',
        });
      }
      continue;
    }
    nonBoardWarnings.push(item);
  }

  const boardResults = [...rows.values()];
  const successful = boardResults.filter(isSuccessfulBoard).length;
  const total = boardResults.length;
  const failed = total - successful;
  const fatal = (Array.isArray(payload.issues) ? payload.issues : []).some((item) => String(item.record_status || '').includes('运行异常'));
  const executionFinished = ['success', 'partial', 'failure'].includes(payload.status);

  const mergedWarnings = [...nonBoardWarnings, ...sourceIssues].filter((item, index, all) => {
    const key = `${item.title || ''}\n${item.reason || item.detail || ''}`;
    return all.findIndex((other) => `${other.title || ''}\n${other.reason || other.detail || ''}` === key) === index;
  });

  return {
    ...payload,
    // GitHub 任务正常结束但存在业务阻断时属于“部分完成”，不是程序执行失败。
    status: fatal ? 'failure' : (failed || mergedWarnings.length ? 'partial' : (executionFinished ? 'success' : payload.status)),
    board_results: boardResults,
    warnings: mergedWarnings,
    completion: {
      percent: total ? 100 : (executionFinished ? 100 : 0),
      completed: total,
      total,
      unit: '张板材',
    },
  };
}

export function runSplit() {
  return request('/api/run/split', { method: 'POST' });
}

export function runParts() {
  return request('/api/run/parts', { method: 'POST' });
}

export function runDraw(orderName = '') {
  return request('/api/run/draw', { method: 'POST', body: JSON.stringify({ order_name: orderName }) });
}

export function runDrawUpload(orderName = '', files = []) {
  const form = new FormData();
  form.append('order_name', orderName);
  for (const file of files) form.append('files', file, file.name);
  return requestMultipart('/api/run/draw/upload', form);
}

export function getStatus() {
  return request('/api/status');
}

export async function getResult(task) {
  const payload = await request(`/api/results/${task}`);
  return task === 'parts' ? normalizePartsResult(payload) : payload;
}

export function getDrawReview(jobId) {
  return request(`/api/draw/review/${encodeURIComponent(jobId)}`);
}

export function markDrawReviewPass(jobId, fingerprint, reviewer = '控制台人工复核') {
  return request(
    `/api/draw/review/${encodeURIComponent(jobId)}/${encodeURIComponent(fingerprint)}/pass`,
    { method: 'POST', body: JSON.stringify({ reviewer }) },
  );
}

export function getConfig() {
  return request('/api/config');
}

export function saveConfig(config) {
  return request('/api/config', { method: 'POST', body: JSON.stringify(config) });
}
