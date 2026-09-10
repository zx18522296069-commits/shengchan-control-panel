import React, { useState } from 'react';

function Settings() {
  const [partsTime, setPartsTime] = useState('17:25');
  const [splitTime, setSplitTime] = useState('22:00');

  return (
    <div className="container">
      <h1>自动任务设置</h1>

      <div className="task-card">
        <h3>未加工更新</h3>
        <p>状态：开启</p>
        <label>
          执行时间：
          <input value={partsTime} onChange={(e) => setPartsTime(e.target.value)} />
        </label>
      </div>

      <div className="task-card">
        <h3>拆图</h3>
        <p>状态：开启</p>
        <label>
          执行时间：
          <input value={splitTime} onChange={(e) => setSplitTime(e.target.value)} />
        </label>
      </div>

      <button>保存设置</button>
    </div>
  );
}

export default Settings;
