import React, { useCallback, useEffect, useState } from 'react';
import { getResult, getStatus, hasControlKey, runDraw, runParts, runSplit, setControlKey } from './api';
import Settings from './pages/Settings';

const TASKS = {
  draw: { label: '画图', description: '读取网盘来图，生成严格标注的 DXF、预览图和汇总表' },
  split: { label: '拆图', description: '扫描待拆图纸并生成拆图结果' },
  parts: { label: '未加工更新', description: '汇总各订单未加工零件明细' },
};

const STATUS_TEXT = {
  success: '成功', partial: '部分完成', failure: '失败', cancelled: '已取消', in_progress: '运行中',
  queued: '排队中', requested: '已提交', waiting: '等待中', no_runs: '暂无记录',
  token_missing: '服务未配置', api_error: '读取失败', unknown: '未知',
};

function ResultPanel({ task, result, loading, error, onClose }) {
  const meta = TASKS[task];
  const completion = result?.completion || { percent: 0, completed: 0, total: 0, unit: task === 'split' ? '张图片' : '个订单' };
  const resultState = taskState(result);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <header className="panel-header">
          <div><p className="eyebrow">最近一次执行</p><h2 id="result-title">{meta.label}运行结果</h2></div>
          <button className="close-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {loading && <div className="result-loading">正在整理本次运行结果…</div>}
        {error && <div className="result-error"><strong>结果读取失败</strong><span>{error}</span></div>}

        {!loading && !error && result && (
          <>
            <div className="result-overview">
              <div className="completion-ring" style={{ '--progress': `${completion.percent}%` }}>
                <strong>{completion.percent}%</strong><span>完成度</span>
              </div>
              <div className="completion-copy">
                <span className={`badge ${resultState.tone}`}><span className="status-dot" />{resultState.text}</span>
                <h3>{completion.completed}/{completion.total} {completion.unit}已完成</h3>
                <p>{result.summary?.length ? result.summary.join('；') : '本次结果已整理完成'}</p>
              </div>
            </div>

            <div className="progress-track" aria-label={`完成度 ${completion.percent}%`}><span style={{ width: `${completion.percent}%` }} /></div>

            <section className="result-block issues-block">
              <div className="result-block-title"><h3>未完成项目</h3><span>{result.issues?.length || 0}</span></div>
              {result.issues?.length ? (
                <ul className="result-list">
                  {result.issues.map((item, index) => <li className="issue-item" key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.reason}</span></li>)}
                </ul>
              ) : <p className="empty-result">没有发现未完成项目。</p>}
            </section>

            {result.warnings?.length > 0 && (
              <section className="result-block warning-block">
                <div className="result-block-title"><h3>已跳过资料</h3><span>{result.warnings.length}</span></div>
                <ul className="result-list">
                  {result.warnings.map((item, index) => <li className="warning-item" key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.reason}</span></li>)}
                </ul>
              </section>
            )}

            {result.successes?.length > 0 && (
              <details className="success-details">
                <summary>查看已完成项目（{result.successes.length}）</summary>
                <ul className="result-list">
                  {result.successes.map((item, index) => <li className="success-item" key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.detail}</span></li>)}
                </ul>
              </details>
            )}

            {result.links?.length > 0 && (
              <div className="result-links">
                {result.links.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>{link.label} ↗</a>)}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

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
    : ['partial', 'in_progress', 'queued', 'requested', 'waiting'].includes(value) ? 'running'
      : ['failure', 'cancelled', 'api_error'].includes(value) ? 'failed' : 'idle';
  return { value, tone, text: STATUS_TEXT[value] || value };
}

function App() {
  const [unlocked, setUnlocked] = useState(hasControlKey());
  const [passcode, setPasscode] = useState('');
  const [status, setStatus] = useState({});
  const [notice, setNotice] = useState({ tone: 'idle', text: '系统待机，可选择任务执行' });
  const [running, setRunning] = useState('');
  const [drawOrder, setDrawOrder] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [resultTask, setResultTask] = useState('');
  const [result, setResult] = useState(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');

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

  async function startDraw() {
    const orderName = drawOrder.trim();
    if (!orderName) {
      setNotice({ tone: 'failed', text: '请先输入网盘“赵欣/来图”中的完整订单文件夹名' });
      return;
    }
    await execute('draw', () => runDraw(orderName));
  }

  async function openResult(key) {
    setResultTask(key);
    setResult(null);
    setResultError('');
    setResultLoading(true);
    try {
      setResult(await getResult(key));
    } catch (error) {
      setResultError(error.message);
    } finally {
      setResultLoading(false);
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

      <section aria-label="画图订单选择" style={{ marginBottom: '18px' }}>
        <label className="field-label">要画图的订单文件夹名
          <input type="text" value={drawOrder} onChange={(event) => setDrawOrder(event.target.value)} placeholder="例如：200.UUU-1000_0912" disabled={Boolean(running)} />
        </label>
        <p className="refresh-note">必须与网盘“赵欣/来图”中的文件夹名称完全一致，每次只处理这个订单。</p>
      </section>

      <section className="action-grid" aria-label="任务操作">
        <button className="action-card" type="button" disabled={Boolean(running)} onClick={startDraw}>
          <span className="action-number">01</span>
          <span className="action-title">画图</span>
          <span className="action-description">{TASKS.draw.description}</span>
          <span className="action-state">{running === 'draw' ? '提交中…' : '点击执行'}</span>
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
                <button className="result-button" type="button" onClick={() => openResult(key)}>查看运行结果 →</button>
              </article>
            );
          })}
        </div>
        <p className="refresh-note">{lastRefresh ? `状态刷新：${formatTime(lastRefresh.toISOString())}` : '正在连接控制服务…'}</p>
      </section>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {resultTask && <ResultPanel task={resultTask} result={result} loading={resultLoading} error={resultError} onClose={() => setResultTask('')} />}
    </main>
  );
}

export default App;
