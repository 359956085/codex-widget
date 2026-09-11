export async function bootstrapApplication(createApplication, onFatalError) {
  let application;
  try {
    application = createApplication();
    await application.start();
    return true;
  } catch (error) {
    try {
      await application?.destroy?.();
    } catch (cleanupError) {
      console.error("清理启动失败的应用时出错", cleanupError);
    }
    reportSafely(onFatalError, error, "处理应用启动错误失败");
    return false;
  }
}

export async function listenRuntimeEvent(listen, eventName, handler, onError) {
  try {
    return await listen(eventName, handler);
  } catch (error) {
    reportSafely(onError, error, "处理事件监听错误失败");
    return null;
  }
}

function reportSafely(report, error, fallbackMessage) {
  try {
    report(error);
  } catch (reportError) {
    console.error(fallbackMessage, reportError);
  }
}
