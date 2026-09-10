const API_BASE = "";

export async function runSplit() {
  return fetch(`${API_BASE}/api/run/split`, {
    method: "POST",
  }).then((r) => r.json());
}

export async function runParts() {
  return fetch(`${API_BASE}/api/run/parts`, {
    method: "POST",
  }).then((r) => r.json());
}

export async function getStatus() {
  return fetch(`${API_BASE}/api/status`).then((r) => r.json());
}
