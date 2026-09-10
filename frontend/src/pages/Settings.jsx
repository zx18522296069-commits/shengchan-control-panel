import React, { useEffect, useState } from 'react';
import { getConfig, saveConfig } from '../api';

const DEFAULT_CONFIG = {
  tasks: {
    split: { enabled: true, schedule_mode: 'hourly', minute: 0, times: ['22:00'] },
    parts: { enabled: true, schedule_mode: 'daily', times: ['17:25', '22:00'] },
  },
};

function Settings({ onClose }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [state, setState] = useState({ saving: false, message: '正在读取当前计划…', error: false });

  useEffect(() => {
    getConfig()
      .then((data) => {
        setConfig(data);
        setState({ saving: false, message: '', error: false });
      })
      .catch((error) => setState({ saving: false, message: error.message, error: true }));
  }, []);

  function updateTask(key, patch) {
    setConfig((current) => ({
      ...current,
      tasks: { ...current.tasks, [key]: { ...current.tasks[key], ...patch } },
    }));
  }

  function updateTime(key, index, value) {
    const times = [...config.tasks[key].times];
    times[index] = value;
    updateTask(key, { times });
  }

  async function submit(event) {
    event.preventDefault();
    setState({ saving: true, message: '正在保存并同步定时任务…', error: false });
    try {
      const saved = await saveConfig(config);
      setConfig(saved.config || config);
      setState({ saving: false, message: '设置已保存并同步', error: false });
    } catch (error) {
      setState({ saving: false, message: error.message, error: true });
    }
  }

  const split = config.tasks?.split || DEFAULT_CONFIG.tasks.split;
  const parts = config.tasks?.parts || DEFAULT_CONFIG.tasks.parts;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="panel-header">
          <div><p className="eyebrow">自动任务</p><h2 id="settings-title">定时设置</h2></div>
          <button className="close-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="setting-card">
            <div className="setting-title"><div><h3>拆图</h3><p>可按小时扫描，也可改为每天固定时间</p></div><label className="switch"><input type="checkbox" checked={split.enabled} onChange={(e) => updateTask('split', { enabled: e.target.checked })} /><span /></label></div>
            <label className="field-label">执行频率
              <select value={split.schedule_mode} onChange={(e) => updateTask('split', { schedule_mode: e.target.value })}>
                <option value="hourly">每小时整点</option><option value="daily">每天指定时间</option>
              </select>
            </label>
            {split.schedule_mode === 'daily' && <label className="field-label">执行时间（北京时间）<input type="time" value={split.times?.[0] || '22:00'} onChange={(e) => updateTime('split', 0, e.target.value)} /></label>}
          </div>

          <div className="setting-card">
            <div className="setting-title"><div><h3>未加工更新</h3><p>每天两个固定时间执行</p></div><label className="switch"><input type="checkbox" checked={parts.enabled} onChange={(e) => updateTask('parts', { enabled: e.target.checked })} /><span /></label></div>
            <div className="time-row">
              <label className="field-label">第一次（北京时间）<input type="time" value={parts.times?.[0] || '17:25'} onChange={(e) => updateTime('parts', 0, e.target.value)} /></label>
              <label className="field-label">第二次（北京时间）<input type="time" value={parts.times?.[1] || '22:00'} onChange={(e) => updateTime('parts', 1, e.target.value)} /></label>
            </div>
          </div>

          {state.message && <p className={`form-message ${state.error ? 'error' : ''}`}>{state.message}</p>}
          <div className="panel-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={state.saving}>{state.saving ? '保存中…' : '保存设置'}</button></div>
        </form>
      </section>
    </div>
  );
}

export default Settings;
