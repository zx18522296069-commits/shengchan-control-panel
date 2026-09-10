// GitHub Actions 调用接口预留
// 正式接入时通过安全后端调用，不在前端保存 GitHub Token

export async function runSplitDrawing() {
  return {
    task: '拆图',
    status: '接口待接入'
  };
}

export async function runPartsUpdate() {
  return {
    task: '未加工更新',
    status: '接口待接入'
  };
}

export async function runDrawing() {
  return {
    task: '画图',
    status: '预留'
  };
}
