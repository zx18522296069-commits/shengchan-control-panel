import React, { useEffect, useState } from 'react';
import { runSplit, runParts, getStatus } from './api';

function App() {
  const [status, setStatus] = useState({});
  const [message, setMessage] = useState('待机');

  const refreshStatus = async () => {
    try {
      const data = await getStatus();
      setStatus(data);
    } catch (e) {
      setMessage('状态读取失败');
    }
  };

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 30000);
    return () => clearInterval(timer);
  }, []);

  const handleSplit = async () => {
    setMessage('拆图执行中');
    await runSplit();
    refreshStatus();
  };

  const handleParts = async () => {
    setMessage('未加工更新执行中');
    await runParts();
    refreshStatus();
  };

  return (
    <div className="container">
      <h1>生产自动化控制台</h1>

      <button onClick={() => setMessage('画图功能预留')}>画图</button>
      <button onClick={handleSplit}>拆图</button>
      <button onClick={handleParts}>未加工更新</button>

      <div className="status">
        <h2>运行状态</h2>
        <p>{message}</p>
        <pre>{JSON.stringify(status, null, 2)}</pre>
      </div>
    </div>
  );
}

export default App;
