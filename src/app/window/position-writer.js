export function createLatestPositionWriter(writePosition, onError) {
  let pendingPosition = null;
  let activeWrite = null;

  function enqueue(position) {
    pendingPosition = { x: position.x, y: position.y };
    ensureActiveWrite();
  }

  function whenIdle() {
    return activeWrite ?? Promise.resolve();
  }

  function ensureActiveWrite() {
    if (!activeWrite) {
      // 延后一拍启动，确保 activeWrite 先赋值，写入同步抛错也能正确清理状态。
      activeWrite = Promise.resolve().then(drain);
    }
    return activeWrite;
  }

  async function drain() {
    while (pendingPosition) {
      const position = pendingPosition;
      pendingPosition = null;
      try {
        await writePosition(position);
      } catch (error) {
        reportError(error);
      }
    }
    activeWrite = null;
  }

  function reportError(error) {
    try {
      onError(error);
    } catch (loggingError) {
      console.error("记录窗口移动错误失败", loggingError);
    }
  }

  return { enqueue, whenIdle };
}
