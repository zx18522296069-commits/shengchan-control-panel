import React, { useCallback, useEffect, useState } from 'react';
import { getResult, getStatus, hasControlKey, runDraw, runParts, runSplit, setControlKey } from './api';
import Settings from './pages/Settings';

const TASKS = {
  split: { label: '拆图', description: '扫描待拆图纸（PDF/图片）并生成拆图结果' },
  parts: { label: '未加工更新', description: '汇总各订单未加工零件明细' },
  draw: { label: '画图', description: '读取网盘来图，生成严格标注的 DXF、预览图和汇总表' },
};

const STATUS_TEXT = {
  success: '成功', partial: '部分完成', failure: '失败', cancelled: '已取消', in_progress: '运行中',
  queued: '排队中', requested: '已提交', waiting: '等待中', no_runs: '暂无记录',
  token_missing: '服务未配置', api_error: '读取失败', unknown: '未知',
};

function extractBoardId(item) {
  const original = String(item?.board_id || item?.title || '').trim();
  if (!original) return '';
  const archived = original.match(/已归档拆图结果[:：]\s*(.+?)_完成(?:\.[A-Za-z0-9]+)?(?:\s|$|->)/);
  if (archived) return archived[1].trim();
  return original
    .replace(/^板材\s+/, '')
    .replace(/（.*$/, '')
    .replace(/\(.*$/, '')
    .trim();
}

function isBoardResultItem(item, source) {
  if (source === 'board_results') return true;
  const status = String(item?.record_status || '');
  if (/订单源未完成|运行异常/.test(status)) return false;
  const board = extractBoardId(item);
  const text = `${status} ${item?.cause || ''} ${item?.reason || ''} ${item?.detail || ''}`;
  return Boolean(board) && (
    /^#/.test(board)
    || /^废\d/.test(board)
    || /已累计|未累计|补归档|首次校验通过|同板材号|板材/.test(text)
    || /已归档拆图结果/.test(String(item?.title || ''))
  );
}

function classifyBoardItem(item, inferredKind = '') {
  const text = `${item?.record_status || ''} ${item?.cause || ''} ${item?.reason || ''} ${item?.detail || ''}`;
  if (/内容冲突|内容不同|无法唯一一致复核/.test(text)) return 'failed';
  if (/仅补归档|补归档|未重复累计|重复内容|历史已入账/.test(text)) return 'duplicate';
  if (/已累计、已录入|首次校验通过|成功计入|已写回累计台账/.test(text)) return 'success';
  if (inferredKind === 'success') return 'success';
  return 'failed';
}

function normalizePartsBoards(result) {
  const rows = new Map();

  const add = (item, source, inferredKind, priority) => {
    if (!isBoardResultItem(item, source)) return;
    const board = extractBoardId(item);
    if (!board) return;
    const kind = classifyBoardItem(item, inferredKind);
    const existing = rows.get(board);
    if (existing && existing.priority > priority) return;

    const defaultStatus = kind === 'success'
      ? '已累计、已录入'
      : kind === 'duplicate' ? '已累计、仅补归档' : '未累计、未记录';
    const detail = item?.cause || item?.reason || item?.detail || '';
    const defaultAction = kind === 'failed'
      ? '核对该板拆图结果和对应订单原始汇总表后重新执行。'
      : '已移动到“已录入数量”。';

    rows.set(board, {
      board,
      kind,
      record_status: item?.record_status || defaultStatus,
      cause: detail || defaultStatus,
      action: item?.action || defaultAction,
      priority,
    });
  };

  (result?.board_results || []).forEach((item) => add(item, 'board_results', '', 3));
  (result?.successes || []).forEach((item) => add(item, 'successes', 'success', 2));
  (result?.issues || []).forEach((item) => add(item, 'issues', 'failed', 2));

  const all = Array.from(rows.values());
  const success = all.filter((item) => item.kind === 'success');
  const duplicate = all.filter((item) => item.kind === 'duplicate');
  const failed = all.filter((item) => item.kind === 'failed');
  const classified = success.length + duplicate.length + failed.length;
  const reportedTotal = Number(result?.completion?.total || 0);
  const total = Math.max(reportedTotal, classified);
  const finished = ['success', 'partial'].includes(result?.status) && classified >= total;
  const percent = total > 0
    ? Math.min(100, Math.round((classified / total) * 100))
    : (['success', 'partial'].includes(result?.status) ? 100 : Number(result?.completion?.percent || 0));

  return { all, success, duplicate, failed, classified, total, percent, finished };
}

function PartsBoardTable({ rows, type }) {
  const lastHeading = type === 'failed' ? '下一步怎么处理' : '文件去向';
  return (
    <div className="board-result-table" role="table">
      <div className="board-result-head" role="row">
        <strong>板材编号</strong>
        <strong>处理状态</strong>
        <strong>处理说明</strong>
        <strong>{lastHeading}</strong>
      </div>
      {rows.map((item) => (
        <div className={`board-result-row board-row-${type}`} role="row" key={item.board}>
          <strong>{item.board}</strong>
          <span>{item.record_status}</span>
          <span>{item.cause}</span>
          <span>{item.action}</span>
        </div>
      ))}
    </div>
  );
}

function PartsResults({ result }) {
  const boards = normalizePartsBoards(result);
  return (
    <>
      <div className="parts-summary-grid" aria-label="本次板材处理统计">
        <div className="parts-stat"><span>本次扫描</span><strong>{boards.total}</strong><small>张板材</small></div>
        <div className="parts-stat success"><span>成功录入</span><strong>{boards.success.length}</strong><small>张</small></div>
        <div className="parts-stat duplicate"><span>重复已处理</span><strong>{boards.duplicate.length}</strong><small>张</small></div>
        <div className="parts-stat failed"><span>未成功</span><strong>{boards.failed.length}</strong><small>张</small></div>
      </div>

      <section className="result-block success-block">
        <div className="result-block-title"><h3>成功录入</h3><span>{boards.success.length}</span></div>
        {boards.success.length
          ? <PartsBoardTable rows={boards.success} type="success" />
          : <p className="empty-result">本次没有新录入板材。</p>}
      </section>

      <section className="result-block duplicate-block">
        <div className="result-block-title"><h3>重复板材（已处理）</h3><span>{boards.duplicate.length}</span></div>
        {boards.duplicate.length
          ? <PartsBoardTable rows={boards.duplicate} type="duplicate" />
          : <p className="empty-result">本次没有“同板号 + 同内容”的重复板材。</p>}
      </section>

      <section className="result-block issues-block">
        <div className="result-block-title"><h3>未成功</h3><span>{boards.failed.length}</span></div>
        {boards.failed.length
          ? <PartsBoardTable rows={boards.failed} type="failed" />
          : <p className="empty-result">本次扫描到的板材均已处理完成。</p>}
      </section>
    </>
  );
}

function ResultPanel({ task, result, loading, error, onClose }) {
  const meta = TASKS[task];
  const defaultCompletion = { percent: 0, completed: 0, total: 0, unit: task === 'split' ? '个图纸文件' : '个订单' };
  const completion = result?.completion || defaultCompletion;
  const resultState = taskState(result);
  const partsBoards = task === 'parts' ? normalizePartsBoards(result) : null;
  const shownCompletion = task === 'parts'
    ? { percent: partsBoards.percent, completed: partsBoards.classified, total: partsBoards.total, unit: '张板材' }
    : completion;
  const shownState = task === 'parts' && partsBoards.finished
    ? { tone: 'success', text: '执行完成' }
    : resultState;
  const boardRows = result?.issues || [];

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
              <div className="completion-ring" style={{ '--progress': `${shownCompletion.percent}%` }}>
                <strong>{shownCompletion.percent}%</strong><span>{task === 'parts' ? '扫描完成度' : '完成度'}</span>
              </div>
              <div className="completion-copy">
                <span className={`badge ${shownState.tone}`}><span className="status-dot" />{shownState.text}</span>
                {task === 'parts' ? (
                  <>
                    <h3>本次扫描 {partsBoards.total} 张板材</h3>
                    <p>成功录入 {partsBoards.success.length} 张｜重复已处理 {partsBoards.duplicate.length} 张｜未成功 {partsBoards.failed.length} 张</p>
                  </>
                ) : (
                  <>
                    <h3>{shownCompletion.completed}/{shownCompletion.total} {shownCompletion.unit}已完成</h3>
                    <p>{result.summary?.length ? result.summary.join('；') : '本次结果已整理完成'}</p>
                  </>
                )}
              </div>
            </div>

            <div className="progress-track" aria-label={`完成度 ${shownCompletion.percent}%`}><span style={{ width: `${shownCompletion.percent}%` }} /></div>

            {task === 'parts' ? <PartsResults result={result} /> : (
              <section className="result-block issues-block">
                <div className="result-block-title"><h3>未拆出板材</h3><span>{boardRows.length}</span></div>
                {boardRows.length ? (
                  <div className="board-result-table" role="table" aria-label="未拆出板材处理清单">
                    <div className="board-result-head" role="row">
                      <strong>板材编号（待拆文件名）</strong>
                      <strong>是否拆出结果</strong>
                      <strong>为什么没有拆出</strong>
                      <strong>下一步怎么处理</strong>
                    </div>
                    {boardRows.map((item, index) => (
                      <div className="board-result-row" role="row" key={`${item.title}-${index}`}>
                        <strong>{item.title}</strong>
                        <span>{item.record_status || '未拆出'}</span>
                        <span>{item.cause || item.reason}</span>
                        <span>{item.action || '核对该板图纸和基础资料后重新执行。'}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="empty-result">没有发现未完成项目。</p>}
              </section>
            )}

            {result.warnings?.length > 0 && (
              <section className="result-block warning-block">
                <div className="result-block-title"><h3>已跳过资料</h3><span>{result.warnings.length}</span></div>
                <ul className="result-list">
                  {result.warnings.map((item, index) => <li className="warning-item" key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.reason}</span></li>)}
                </ul>
              </section>
            )}

            {task !== 'parts' && result.successes?.length > 0 && (
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
        <button className="action-card" type="button" disabled={Boolean(running)} onClick={() => execute('split', runSplit)}>
          <span className="action-number">01</span><span className="action-title">拆图</span>
          <span className="action-description">{TASKS.split.description}</span>
          <span className="action-state">{running === 'split' ? '提交中…' : '点击执行'}</span>
        </button>
        <button className="action-card" type="button" disabled={Boolean(running)} onClick={() => execute('parts', runParts)}>
          <span className="action-number">02</span><span className="action-title">未加工更新</span>
          <span className="action-description">{TASKS.parts.description}</span>
          <span className="action-state">{running === 'parts' ? '提交中…' : '点击执行'}</span>
        </button>
        <button className="action-card" type="button" disabled={Boolean(running)} onClick={startDraw}>
          <span className="action-number">03</span><span className="action-title">画图</span>
          <span className="action-description">{TASKS.draw.description}</span>
          <span className="action-state">{running === 'draw' ? '提交中…' : '点击执行'}</span>
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
