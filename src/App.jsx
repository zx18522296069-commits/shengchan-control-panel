import React from 'react';

function ActionButton({name,desc}){
  return (
    <div className="card">
      <button>{name}</button>
      <p>{desc}</p>
      <span>状态：待接入</span>
    </div>
  );
}

export default function App(){
  return (
    <main>
      <h1>生产自动化控制台</h1>
      <div className="grid">
        <ActionButton name="画图" desc="预留：PDF转DXF、图纸处理" />
        <ActionButton name="拆图" desc="调用图纸拆分自动化" />
        <ActionButton name="未加工更新" desc="调用未加工零件自动更新" />
      </div>
      <section className="log">
        <h2>最近执行</h2>
        <p>暂无执行记录</p>
      </section>
    </main>
  );
}
