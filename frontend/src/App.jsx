import React, { useCallback, useEffect, useState } from 'react';
import { getConfig, getDrawReview, getResult, getStatus, hasControlKey, markDrawReviewPass, rerunDrawIssues, runDraw, runDrawUpload, runParts, runSplit, setControlKey } from './api';
import Settings from './pages/Settings';
import SplitResults, { normalizeSplitResults } from './SplitResults';

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
  const status = String(item?.record_status || '');
  const text = `${status} ${item?.cause || ''} ${item?.reason || ''} ${item?.detail || ''}`;
  // 失败优先级最高。历史已经入账并不代表当前根目录文件就是可安全补归档的重复件。
  if (/未累计|未记录|阻断/.test(status)
    || /内容冲突|内容不同|无法(?:安全|唯一)?(?:一致)?复核|本次无法复核|不归档/.test(text)) return 'failed';
  if (/仅补归档|补归档|未重复累计|重复内容/.test(text)) return 'duplicate';
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
  // 板材总数只能来自逐板结果，禁止再次使用接口里的订单源 total。
  const total = classified;
  const executionEnded = ['success', 'partial', 'failure'].includes(result?.status);
  const finished = total > 0
    ? executionEnded && classified === total
    : ['success', 'partial'].includes(result?.status);
  const percent = total > 0
    ? 100
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

function DrawReview({ result }) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(Boolean(result?.job_id));
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!result?.job_id) return;
    setLoading(true);
    setError('');
    try {
      const payload = await getDrawReview(result.job_id);
      setReview(payload);
      setIndex((value) => Math.min(value, Math.max(0, (payload.items?.length || 1) - 1)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [result?.job_id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!result?.job_id) return <p className="empty-result">当前画图任务没有验收任务编号。</p>;
  if (loading) return <div className="result-loading">正在加载 PDF ↔ DXF 验收工作台…</div>;
  if (error) return <div className="result-error"><strong>验收工作台读取失败</strong><span>{error}</span></div>;

  const items = review?.items || [];
  if (!items.length) return <p className="empty-result">当前没有可人工验收的 DXF 候选。</p>;
  const item = items[index];
  const passed = item.review_status === 'REVIEWED_PASS';

  async function confirmPass() {
    setSaving(true);
    setError('');
    try {
      await markDrawReviewPass(result.job_id, item.fingerprint, '控制台人工复核');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="draw-review">
      <div className="draw-review-toolbar">
        <div>
          <p className="eyebrow">PDF ↔ DXF 真实验收</p>
          <h3>{item.drawing_no || item.source_pdf}</h3>
          <p>{item.variant ? '版本：' + item.variant + '　' : ''}T{item.thickness ?? '—'}　{item.quantity ?? '—'}件</p>
        </div>
        <div className="draw-review-count">
          <strong>{index + 1}/{items.length}</strong>
          <span>已确认 {review.reviewed || 0}</span>
        </div>
      </div>

      <div className="draw-review-grid">
        <figure>
          <figcaption>原 PDF</figcaption>
          <a href={item.source_image_url} target="_blank" rel="noreferrer">
            <img src={item.source_image_url} alt={(item.drawing_no || '') + ' 原PDF'} />
          </a>
        </figure>
        <figure>
          <figcaption>最终 DXF 验收预览</figcaption>
          <a href={item.preview_url} target="_blank" rel="noreferrer">
            <img src={item.preview_url} alt={(item.drawing_no || '') + ' DXF验收图'} />
          </a>
        </figure>
      </div>

      <div className="draw-review-rule">
        对照检查：外形、实际尺寸、孔径、孔中心定位、孔距、槽/缺口、R值及取中/对称/同心中心线。
        验收图数值来自最终 DXF 几何回读，不直接复制 PDF 尺寸数字。
      </div>

      {error && <div className="result-error"><span>{error}</span></div>}

      <div className="draw-review-actions">
        <button type="button" disabled={index === 0 || saving} onClick={() => setIndex((value) => Math.max(0, value - 1))}>上一张</button>
        <button
          type="button"
          className={passed ? 'review-pass confirmed' : 'review-pass'}
          disabled={passed || saving}
          onClick={confirmPass}
        >
          {passed ? '✓ 已确认 PASS' : saving ? '正在登记…' : '确认正确 PASS'}
        </button>
        <button type="button" disabled={index >= items.length - 1 || saving} onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))}>下一张</button>
      </div>
    </section>
  );
}

function DrawIssues({ result }) {
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  const [rerunning, setRerunning] = useState(false);
  const [message, setMessage] = useState('');

  async function rerun() {
    if (!result?.job_id || !issues.length) return;
    setRerunning(true);
    setMessage('');
    try {
      const payload = await rerunDrawIssues(result.job_id);
      setMessage(`已创建异常项复跑任务：${payload.job_id}`);
    } catch (error) {
      setMessage(`复跑失败：${error.message}`);
    } finally {
      setRerunning(false);
    }
  }

  if (!issues.length) {
    return (
      <section className="result-block draw-issue-block clear">
        <div className="result-block-title"><h3>异常图纸</h3><span>0</span></div>
        <p className="empty-result">当前没有需要处理的异常图纸。</p>
      </section>
    );
  }

  return (
    <section className="result-block draw-issue-block">
      <div className="result-block-title"><h3>异常图纸</h3><span>{issues.length}</span></div>
      <div className="draw-issue-list">
        {issues.map((item, index) => (
          <article className="draw-issue-row" key={`${item.title || 'issue'}-${index}`}>
            <div>
              <strong>{item.title || '未命名图纸'}</strong>
              <span>{item.record_status || '需要复核'}</span>
            </div>
            <p>{item.cause || item.reason || '未提供异常原因'}</p>
            <small>{item.action || '核对图纸后重新处理该异常项。'}</small>
          </article>
        ))}
      </div>
      <button className="draw-rerun-button active" type="button" disabled={rerunning || !result?.job_id} onClick={rerun}>
        {rerunning ? '正在创建复跑任务…' : `只重新处理异常项 · ${issues.length}张`}
      </button>
      {message && <p className="draw-rerun-message">{message}</p>}
    </section>
  );
}

function ResultPanel({ task, result, loading, error, onClose }) {
  const meta = TASKS[task];
  const defaultCompletion = { percent: 0, completed: 0, total: 0, unit: task === 'split' ? '个图纸文件' : '张板材' };
  const completion = result?.completion || defaultCompletion;
  const resultState = taskState(result);
  const partsBoards = task === 'parts' ? normalizePartsBoards(result) : null;
  const splitRows = task === 'split' ? normalizeSplitResults(result) : null;
  const splitCompleted = splitRows
    ? (splitRows.finished
      ? splitRows.total
      : Math.min(splitRows.total, splitRows.successCount + splitRows.failed.length + splitRows.skipped.length))
    : 0;
  const shownCompletion = task === 'parts'
    ? { percent: partsBoards.percent, completed: partsBoards.classified, total: partsBoards.total, unit: '张板材' }
    : task === 'split'
      ? { percent: splitRows.percent, completed: splitCompleted, total: splitRows.total, unit: '个图纸文件' }
      : completion;
  const shownState = task === 'parts' && partsBoards.finished
    ? { tone: 'success', text: '执行完成' }
    : task === 'split' && splitRows.finished
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
                <strong>{shownCompletion.percent}%</strong><span>{task === 'parts' || task === 'split' ? '扫描完成度' : '完成度'}</span>
              </div>
              <div className="completion-copy">
                <span className={`badge ${shownState.tone}`}><span className="status-dot" />{shownState.text}</span>
                {task === 'parts' ? (
                  <>
                    <h3>本次扫描 {partsBoards.total} 张板材</h3>
                    <p>成功录入 {partsBoards.success.length} 张｜重复已处理 {partsBoards.duplicate.length} 张｜未成功 {partsBoards.failed.length} 张</p>
                  </>
                ) : task === 'split' ? (
                  <>
                    <h3>本次扫描 {splitRows.total} 个图纸文件</h3>
                    <p>成功拆出 {splitRows.successCount} 个｜未拆出 {splitRows.failed.length} 个｜已跳过 {splitRows.skipped.length} 个</p>
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

            {task === 'parts' ? <PartsResults result={result} /> : task === 'split' ? <SplitResults result={result} /> : task === 'draw' ? (
              <>
                <DrawReview result={result} />
                <DrawIssues result={result} />
              </>
            ) : (
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

            {task !== 'split' && result.warnings?.length > 0 && (
              <section className="result-block warning-block">
                <div className="result-block-title"><h3>{task === 'parts' ? '订单源 / 资料异常' : '已跳过资料'}</h3><span>{result.warnings.length}</span></div>
                <ul className="result-list">
                  {result.warnings.map((item, index) => <li className="warning-item" key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.reason}</span></li>)}
                </ul>
              </section>
            )}

            {task === 'draw' && result.successes?.length > 0 && (
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


const DRAW_STAGES = [
  '读取输入',
  'PDF解析 / 缓存',
  'DXF生成',
  'DXF验收预览',
  '人工复核',
  '汇总 / 排版 / ZIP',
];

function DrawWorkbench({
  orderName,
  files,
  running,
  drawStatus,
  onOrderChange,
  onFilesChange,
  onStart,
  onOpenResult,
}) {
  const state = taskState(drawStatus);
  const hasFiles = false;
  const hasOrder = Boolean(orderName.trim());
  const source = hasFiles ? 'upload' : hasOrder ? 'drive' : 'empty';
  const sourceText = source === 'upload'
    ? `本地上传 · ${files.length} 个文件`
    : source === 'drive'
      ? `Google Drive · ${orderName.trim()}`
      : '尚未选择输入来源';
  const canStart = source !== 'empty' && !running;
  const phaseStatus = Array.isArray(drawStatus?.steps) ? drawStatus.steps : [];
  const metrics = [
    ['PDF', drawStatus?.pdf_total ?? '—'],
    ['缓存命中', drawStatus?.cache_hits ?? '—'],
    ['DXF完成', drawStatus?.dxf_completed ?? '—'],
    ['异常', drawStatus?.issue_count ?? '—'],
  ];

  return (
    <section className="draw-workbench" aria-label="画图生产任务">
      <div className="draw-workbench-head">
        <div>
          <p className="eyebrow">03 画图生产任务</p>
          <h2>PDF → DXF 一键执行</h2>
          <p className="draw-subtitle">选订单，点一次开始；后续按缓存、DXF回读、验收预览、人工复核和ZIP交付顺序执行。</p>
        </div>
        <div className="draw-live-meta">
          <span className={`badge ${state.tone}`}><span className="status-dot" />{state.text}</span>
          <span className="draw-job-id">任务ID：{drawStatus?.job_id || '—'}</span>
          <span className="draw-job-order">{drawStatus?.order_name || '尚未创建画图任务'}</span>
        </div>
      </div>

      <div className="draw-source-grid">
        <label className="draw-source-card">
          <span className="draw-source-number">A</span>
          <span className="draw-source-title">Google Drive 订单</span>
          <span className="draw-source-desc">从“赵欣/来图”读取指定订单文件夹</span>
          <input
            type="text"
            value={orderName}
            onChange={(event) => onOrderChange(event.target.value)}
            placeholder="例如：159.26-08-31 YT27-2400Z-1004"
            disabled={Boolean(running) || hasFiles}
          />
        </label>

        <label className="draw-source-card upload-source">
          <span className="draw-source-number">B</span>
          <span className="draw-source-title">本地上传（当前不可用）</span>
          <span className="draw-source-desc">GitHub Actions 模式请使用 Google Drive 订单</span>
          <input
            type="file"
            multiple
            accept=".zip,.pdf,.xlsx,.xlsm,.xls"
            disabled
            onChange={(event) => onFilesChange(Array.from(event.target.files || []))}
          />
          <span className="draw-source-note">无需 Cloud Run；文件请放入“赵欣/来图/订单名”</span>
        </label>
      </div>

      <div className="draw-command-bar">
        <div className="draw-source-current">
          <span>本次输入</span>
          <strong>{sourceText}</strong>
        </div>
        <button
          className="draw-start-button"
          type="button"
          disabled={!canStart}
          onClick={onStart}
          title={source === 'empty' ? '请填写 Google Drive 订单文件夹名' : ''}
        >
          {running === 'draw' ? '正在提交…' : '开始画图'}
        </button>
      </div>

      <div className="draw-metrics">
        {metrics.map(([label, value]) => (
          <div className="draw-metric" key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>

      <div className="draw-stage-panel">
        <div className="draw-stage-title">
          <strong>执行进度</strong>
          <button type="button" className="text-button" onClick={onOpenResult}>查看最新结果 →</button>
        </div>
        <div className="draw-stage-grid">
          {DRAW_STAGES.map((label, index) => {
            const phase = phaseStatus[index];
            const phaseState = phase?.status || 'pending';
            return (
              <div className={`draw-stage ${phaseState}`} key={label}>
                <span className="draw-stage-index">{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{label}</strong><small>{phase?.text || '等待任务数据'}</small></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="draw-quick-actions" aria-label="画图快捷操作">
        <button type="button" className="draw-quick primary" onClick={onOpenResult}>
          查看 DXF 验收 / 运行结果
        </button>
        <button type="button" className="draw-quick" disabled title="异常项重跑后端尚未接入">
          只重跑异常项 · 待接入
        </button>
        <button type="button" className="draw-quick" disabled title="最终ZIP生成后会在运行结果中提供真实下载链接">
          下载最终 ZIP · 完成后开放
        </button>
      </div>

      <div className="draw-workbench-footer">
        <span>正式结果：DXF + DXF验收预览 + 汇总表 + 排版预览 + ZIP</span>
        <span>缓存命中不会替代 PDF ↔ DXF 真实复核</span>
      </div>
    </section>
  );
}

function App() {
  const [unlocked, setUnlocked] = useState(hasControlKey());
  const [passcode, setPasscode] = useState('');
  const [status, setStatus] = useState({});
  const [notice, setNotice] = useState({ tone: 'idle', text: '系统待机，可选择任务执行' });
  const [running, setRunning] = useState('');
  const [drawOrder, setDrawOrder] = useState('');
  const [drawFiles, setDrawFiles] = useState([]);
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
    refreshStatus(true);
    const timer = window.setInterval(() => refreshStatus(true), 30000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, unlocked]);

  async function unlock(event) {
    event.preventDefault();
    setControlKey(passcode.trim());
    try {
      // 登录只验证控制口令，不再依赖三个下游 GitHub 任务的状态都能成功读取。
      // 这样即使某一个自动化仓库临时无权访问，也不会把整个控制台锁在登录页。
      await getConfig();
      setUnlocked(true);
      setLastRefresh(new Date());
      setNotice({ tone: 'idle', text: '系统待机，可选择任务执行' });
      refreshStatus(true);
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
      setNotice({ tone: 'failed', text: '请输入网盘“赵欣/来图”中的完整订单文件夹名。' });
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

      <DrawWorkbench
        orderName={drawOrder}
        files={drawFiles}
        running={running}
        drawStatus={status.draw}
        onOrderChange={setDrawOrder}
        onFilesChange={setDrawFiles}
        onStart={startDraw}
        onOpenResult={() => openResult('draw')}
      />

      <section className="action-grid secondary-actions" aria-label="其他生产任务">
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
