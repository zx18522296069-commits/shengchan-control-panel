import React, {useState} from 'react';

function ActionButton({name, desc, onClick}){
  const [status, setStatus] = useState('待执行');

  async function run(){
    setStatus('执行中...');
    try {
      await onClick();
      setStatus('已提交');
    } catch(e){
      setStatus('失败');
    }
  }

  return (
    <div className="card">
      <button onClick={run}>{name}</button>
      <p>{desc}</p>
      <span>状态：{status}</span>
    </div>
  );
}

async function placeholderRun(task){
  console.log('准备调用任务:', task);
}

export default function App(){
  return (
    <main>
      <h1>生产自动化控制台</h1>
      <div className="grid">
        <ActionButton name="画图" desc="预留：PDF转DXF、图纸处理" onClick={() => placeholderRun('drawing')} />
        <ActionButton name="拆图" desc="调用图纸拆分自动化" onClick={() => placeholderRun('split')} />
        <ActionButton name="未加工更新" desc="调用未加工零件自动更新" onClick={() => placeholderRun('parts')} />
      </div>
      <section className="log">
        <h2>最近执行</h2>
        <p>等待接入 GitHub Actions 状态接口</p>
      </section>
    </main>
  );
}
