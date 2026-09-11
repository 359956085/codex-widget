// 每个实例独立持有监听与清理函数，异步注册晚于销毁时立即释放。
export function createLifecycle() {
  const cleanups = new Set();
  let destroyed = false;
  let bound = false;

  function release(cleanup) {
    try {
      Promise.resolve(cleanup()).catch(reportCleanupError);
    } catch (error) {
      reportCleanupError(error);
    }
  }

  function add(cleanup) {
    if (typeof cleanup !== "function") return;
    if (destroyed) release(cleanup);
    else cleanups.add(cleanup);
  }

  function listen(target, type, handler, options) {
    if (destroyed || !target) return;
    target.addEventListener(type, handler, options);
    add(() => target.removeEventListener(type, handler, options));
  }

  function bind() {
    if (destroyed || bound) return false;
    bound = true;
    return true;
  }

  function guard(callback) {
    return (...args) => {
      if (!destroyed) return callback(...args);
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const cleanup of cleanups) release(cleanup);
    cleanups.clear();
  }

  return { add, bind, destroy, guard, listen, get destroyed() { return destroyed; } };
}

function reportCleanupError(error) {
  console.error("释放应用资源失败", error);
}
