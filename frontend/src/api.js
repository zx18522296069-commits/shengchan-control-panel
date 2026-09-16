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
  const text = `${item.title || ''} ${item.filename || ''}`;
  return text.match(/#\d+(?:-\d+)?/)?.[0] || item.title || text;
}

function isSuccessfulBoard(item = {}) {
  const status = String(item.record_status || '');
  return status.startsWith('已') && !status.includes('未');
}

function normalizePartsResult(payload) {
  if (!payload || payload.task !== 'parts') return payload;

  const rows = new Map();
  for (const item of Array.isArray(payload.board_results) ? payload.board_results : []) {
    const key = boardKey(item);
    if (key && /#\d+/.test(key)) rows.set(key, item);
  }

  for (const item of Array.isArray(payload.successes) ? payload.successes : []) {
    const key = boardKey(item);
    if (!key || !/#\d+/.test(key) || rows.has(key)) continue;
    rows.set(key, {
      title: item.title || key,
      record_status: item.record_status || '已累计、已处理',
      cause: item.cause || item.detail || '本次处理成功',
      action: item.action || '无',
    });
  }

  for (const item of Array.isArray(payload.issues) ? payload.issues : []) {
    const status = String(item.record_status || '');
    if (!(status === '未累计、未记录' || status.includes('未累计'))) continue;
    const key = boardKey(item);
    if (!key || !/#\d+/.test(key)) continue;
    rows.set(key, {
      title: item.title || key,
      record_status: item.record_status || '未累计、未记录',
      cause: item.cause || item.reason || '未提供原因',
      action: item.action || '核对该板拆图结果和对应订单原始汇总表后重新执行。',
    });
  }

  const boardResults = [...rows.values()];
  if (!boardResults.length) return payload;

  const completed = boardResults.filter(isSuccessfulBoard).length;
  const total = boardResults.length;
  const failed = total - completed;

  return {
    ...payload,
    status: failed ? (completed ? 'partial' : 'failure') : 'success',
    board_results: boardResults,
    completion: {
      percent: Math.round((completed / total) * 100),
      completed,
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
