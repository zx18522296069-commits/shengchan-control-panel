import React, { useCallback, useEffect, useState } from 'react';
import { getStatus, hasControlKey, runParts, runSplit, setControlKey } from './api';
import Settings from './pages/Settings';

const TASKS = {
  split: { label: '拆图', description: '扫描待拆图纸并生成拆图结果' },
  parts: { label: '未加工更新', description: '汇总各订单未加工零件明细' },
};

const STATUS_TEXT = {
  success: '成功', failure: '失败', cancelled: '已取消', in_progress: '运行中',
  queued: '排队中', requested: '已提交', waiting: '等待中', no_runs: '暂无记录',
  token_missing: '服务未配置', api_error: '读取失败', unknown: '未知',
};

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function taskState(task) {
  const value = task?.status || 'unknown';
  const tone = value === 'success' ? 'success'
    : ['in_progress', 'queued', 'requested', 'waiting'].includes(value) ? 'running'
      : ['failure', 'cancelled', 'api_error'].includes(value) ? 'failed' : 'idle';
  return { value, tone, text: STATUS_TEXT[value] || value };
}

function App() {
  const [unlocked, setUnlocked] = useState(hasControlKey());
  const [passcode, setPasscode] = useState('');
  const [status, setStatus] = useState({});
  const [notice, setNotice] = useState({ tone: 'idle', text: '系统待机，可选择任务执行' });
  const [running, setRunning] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refreshStatus = useCallback(async (quiet = false) => {
    try {
      const data = await getStatus();
      setStatus(data || {});
      setLastRefresh(new Date());
    } catch (error) {
      if (!quiet) setNotice({ tone: 'failed', text: error.message });
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return undefined;
    refreshStatus();
    const timer = window.setInterval(() => refreshStatus(true), 30000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, unlocked]);

  async function unlock(event) {
    event.preventDefault();
    setControlKey(passcode.trim());
    try {
      const data = await getStatus();
      setStatus(data || {});
      setUnlocked(true);
      setLastRefresh(new Date());
      setNotice({ tone: 'idle', text: '系统待机，可选择任务执行' });
    } catch (error) {
      setControlKey('');
      setNotice({ tone: 'failed', text: error.message });
    }
  }

  if (!unlocked) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={unlock}>
          <p className="eyebrow">火切生产中心</p>
          <h1>生产自动化控制台</h1>
          <p>请输入内部操作口令</p>
          <label className="field-label">操作口令<input type="password" autoFocus value={passcode} onChange={(event) => setPasscode(event.target.value)} /></label>
          {notice.tone === 'failed' && <p className="form-message error">{notice.text}</p>}
          <button className="primary-button login-button" type="submit" disabled={!passcode.trim()}>进入控制台</button>
        </form>
      </main>
    );
  }

  async function execute(key, action) {
    const name = TASKS[key].label;
    setRunning(key);
    setNotice({ tone: 'running', text: `${name}任务正在提交…` });
    try {
      await action();
      setNotice({ tone: 'success', text: `${name}任务已提交，状态会自动刷新` });
      window.setTimeout(() => refreshStatus(true), 2500);
    } catch (error) {
      setNotice({ tone: 'failed', text: `${name}提交失败：${error.message}` });
    } finally {
      setRunning('');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">火切生产中心</p>
          <h1>生产自动化控制台</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="打开定时设置">
          <span aria-hidden="true">⚙</span><span>定时设置</span>
        </button>
      </header>

      <section className="action-grid" aria-label="任务操作">
        <button className="action-card reserved" type="button" onClick={() => setNotice({ tone: 'idle', text: '画图功能已预留，接入规则后即可启用' })}>
          <span className="action-number">01</span>
          <span className="action-title">画图</span>
          <span className="action-description">PDF 转 DXF 接口预留</span>
          <span className="action-state">暂未接入</span>
        </button>

        <button className="action-card" type="button" disabled={Boolean(running)} onClick={() => execute('split', runSplit)}>
          <span className="action-number">02</span>
          <span className="action-title">拆图</span>
          <span className="action-description">{TASKS.split.description}</span>
          <span className="action-state">{running === 'split' ? '提交中…' : '点击执行'}</span>
        </button>

        <button className="action-card" type="button" disabled={Boolean(running)} onClick={() => execute('parts', runParts)}>
          <span className="action-number">03</span>
          <span className="action-title">未加工更新</span>
          <span className="action-description">{TASKS.parts.description}</span>
          <span className="action-state">{running === 'parts' ? '提交中…' : '点击执行'}</span>
        </button>
      </section>

      <section className={`notice ${notice.tone}`} aria-live="polite">
        <span className="status-dot" />
        <span>{notice.text}</span>
      </section>

      <section className="status-section">
        <div className="section-heading">
          <div><p className="eyebrow">实时状态</p><h2>任务运行情况</h2></div>
          <button className="text-button" type="button" onClick={() => refreshStatus()}>刷新状态</button>
        </div>
        <div className="status-grid">
          {Object.entries(TASKS).map(([key, task]) => {
            const current = taskState(status[key]);
            return (
              <article className="status-card" key={key}>
                <div className="status-row">
                  <h3>{task.label}</h3>
                  <span className={`badge ${current.tone}`}><span className="status-dot" />{current.text}</span>
                </div>
                <p>{task.description}</p>
                <dl>
                  <div><dt>最后执行</dt><dd>{formatTime(status[key]?.updated_at || status[key]?.run_started_at)}</dd></div>
                  <div><dt>触发方式</dt><dd>{status[key]?.event === 'schedule' ? '定时' : status[key]?.event ? '手动' : '—'}</dd></div>
                </dl>
                {status[key]?.html_url && <a href={status[key].html_url} target="_blank" rel="noreferrer">查看运行详情 →</a>}
              </article>
            );
          })}
        </div>
        <p className="refresh-note">{lastRefresh ? `状态刷新：${formatTime(lastRefresh.toISOString())}` : '正在连接控制服务…'}</p>
      </section>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

export default App;
