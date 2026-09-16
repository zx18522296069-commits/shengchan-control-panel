import React from 'react';

function splitItemTitle(item) {
  return String(item?.board_id || item?.title || '未识别图纸').trim() || '未识别图纸';
}

export function normalizeSplitResults(result) {
  const rows = new Map();

  const add = (item, kind, priority) => {
    const board = splitItemTitle(item);
    const existing = rows.get(board);
    if (existing && existing.priority > priority) return;

    const isFailed = kind === 'failed';
    const isSkipped = kind === 'skipped';
    const recordStatus = item?.record_status
      || (isFailed ? '未拆出结果' : isSkipped ? '已跳过' : '已拆出');
    const detail = item?.cause || item?.reason || item?.detail
      || (isFailed ? '未提供失败原因' : isSkipped ? '本次未处理该资料' : '拆图结果已生成');
    const action = item?.action
      || (isFailed
        ? '核对该板图纸和基础资料后重新执行。'
        : isSkipped
          ? '核对或补齐资料后重新执行。'
          : '已生成并保存拆图结果。');

    rows.set(board, {
      board,
      kind,
      record_status: recordStatus,
      cause: detail,
      action,
      priority,
    });
  };

  (result?.successes || []).forEach((item) => add(item, 'success', 1));
  (result?.warnings || []).forEach((item) => add(item, 'skipped', 2));
  (result?.issues || []).forEach((item) => add(item, 'failed', 3));

  const all = Array.from(rows.values());
  const success = all.filter((item) => item.kind === 'success');
  const failed = all.filter((item) => item.kind === 'failed');
  const skipped = all.filter((item) => item.kind === 'skipped');
  const reportedTotal = Number(result?.completion?.total || 0);
  const total = Math.max(reportedTotal, all.length);
  const ended = ['success', 'partial', 'failure'].includes(result?.status);
  const inferredSuccess = result?.status === 'success' && !failed.length && !skipped.length
    ? Math.max(total, success.length)
    : success.length;
  const percent = ended ? 100 : Number(result?.completion?.percent || 0);

  return {
    all,
    success,
    successCount: inferredSuccess,
    failed,
    skipped,
    total,
    percent,
    finished: ended,
  };
}

function SplitResultTable({ rows, type }) {
  const lastHeading = type === 'success' ? '文件去向' : '下一步怎么处理';
  return (
    <div className="board-result-table" role="table">
      <div className="board-result-head" role="row">
        <strong>板材编号（待拆文件名）</strong>
        <strong>拆图状态</strong>
        <strong>处理说明</strong>
        <strong>{lastHeading}</strong>
      </div>
      {rows.map((item) => (
        <div className={`board-result-row board-row-${type}`} role="row" key={`${type}-${item.board}`}>
          <strong>{item.board}</strong>
          <span>{item.record_status}</span>
          <span>{item.cause}</span>
          <span>{item.action}</span>
        </div>
      ))}
    </div>
  );
}

export default function SplitResults({ result }) {
  const rows = normalizeSplitResults(result);
  return (
    <>
      <div className="parts-summary-grid" aria-label="本次拆图处理统计">
        <div className="parts-stat"><span>本次扫描</span><strong>{rows.total}</strong><small>个图纸文件</small></div>
        <div className="parts-stat success"><span>成功拆出</span><strong>{rows.successCount}</strong><small>个</small></div>
        <div className="parts-stat failed"><span>未拆出</span><strong>{rows.failed.length}</strong><small>个</small></div>
        <div className="parts-stat skipped"><span>已跳过</span><strong>{rows.skipped.length}</strong><small>个</small></div>
      </div>

      <section className="result-block success-block">
        <div className="result-block-title"><h3>成功拆出</h3><span>{rows.successCount}</span></div>
        {rows.success.length
          ? <SplitResultTable rows={rows.success} type="success" />
          : rows.successCount
            ? <p className="empty-result">本次运行已确认拆图成功，当前日志没有提供逐项成功明细。</p>
            : <p className="empty-result">本次没有成功拆出的图纸。</p>}
      </section>

      <section className="result-block issues-block">
        <div className="result-block-title"><h3>未拆出</h3><span>{rows.failed.length}</span></div>
        {rows.failed.length
          ? <SplitResultTable rows={rows.failed} type="failed" />
          : <p className="empty-result">本次扫描到的图纸均没有拆图失败项。</p>}
      </section>

      <section className="result-block skipped-block">
        <div className="result-block-title"><h3>已跳过资料</h3><span>{rows.skipped.length}</span></div>
        {rows.skipped.length
          ? <SplitResultTable rows={rows.skipped} type="skipped" />
          : <p className="empty-result">本次没有跳过资料。</p>}
      </section>
    </>
  );
}
