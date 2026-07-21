export async function bootstrapApplication(createApplication, onFatalError) {
  try {
    const application = createApplication();
    await application.start();
    return true;
  } catch (error) {
    reportSafely(onFatalError, error, "处理应用启动错误失败");
    return false;
  }
}

export async function listenRuntimeEvent(listen, eventName, handler, onError) {
  try {
    await listen(eventName, handler);
    return true;
  } catch (error) {
    reportSafely(onError, error, "处理事件监听错误失败");
    return false;
  }
}

function reportSafely(report, error, fallbackMessage) {
  try {
    report(error);
  } catch (reportError) {
    console.error(fallbackMessage, reportError);
  }
}
