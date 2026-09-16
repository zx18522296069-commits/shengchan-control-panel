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

  // “未加工更新”的本次扫描总数只能来自逐板结果。
  // completion.total 可能来自旧接口的“订单源数量”，绝不能拿来当板材数量。
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

  for (const item of Array.isArray(payload.issues) ? payload.issues : []) {
    const status = String(item.record_status || '');
    if (!(status === '未累计、未记录' || status.includes('未累计'))) continue;
    const key = boardKey(item);
    if (!key) continue;
    rows.set(key, {
      title: item.title || key,
      board_id: key,
      record_status: item.record_status || '未累计、未记录',
      cause: item.cause || item.reason || '未提供原因',
      action: item.action || '核对该板拆图结果和对应订单原始汇总表后重新执行。',
    });
  }

  // 兼容尚未更新的线上 Worker：历史已入账但本次无法复核的板材，
  // 旧接口可能放在 warnings 而不是 issues。只把明确“本次未成功”的逐板 warning 补进来，
  // 普通订单源/资料 warning 不参与板材计数。
  for (const item of Array.isArray(payload.warnings) ? payload.warnings : []) {
    const key = boardKey(item);
    if (!key || rows.has(key)) continue;
    const detail = `${item.record_status || ''} ${item.cause || ''} ${item.reason || ''} ${item.detail || ''}`;
    if (!/无法复核|无法安全补归档|保留根目录|内容冲突|内容不同|不重复扣减、不归档|未累计|未记录/.test(detail)) continue;
    rows.set(key, {
      title: item.title || key,
      board_id: key,
      record_status: '未累计、未记录',
      cause: item.cause || item.reason || item.detail || '本次未能安全完成入账',
      action: item.action || '核对该板当前文件与历史入账记录及对应订单原始汇总表后重新执行。',
    });
  }

  const boardResults = [...rows.values()];
  const completed = boardResults.filter(isSuccessfulBoard).length;
  const total = boardResults.length;
  const failed = total - completed;
  const executionFinished = ['success', 'partial', 'failure'].includes(payload.status);

  return {
    ...payload,
    status: total
      ? (failed ? (completed ? 'partial' : 'failure') : 'success')
      : payload.status,
    board_results: boardResults,
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

export function getStatus() {
  return request('/api/status');
}

export async function getResult(task) {
  const payload = await request(`/api/results/${task}`);
  return task === 'parts' ? normalizePartsResult(payload) : payload;
}

export function getConfig() {
  return request('/api/config');
}

export function saveConfig(config) {
  return request('/api/config', { method: 'POST', body: JSON.stringify(config) });
}
