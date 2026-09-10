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

export function runSplit() {
  return request('/api/run/split', { method: 'POST' });
}

export function runParts() {
  return request('/api/run/parts', { method: 'POST' });
}

export function getStatus() {
  return request('/api/status');
}

export function getConfig() {
  return request('/api/config');
}

export function saveConfig(config) {
  return request('/api/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}
