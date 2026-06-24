export function createLogger(service) {
  function write(level, message, context = "frontend") {
    if (!service.isAvailable()) return;
    service.commands
      .writeFrontendLog(level, message, context)
      .catch((error) => console.error("写入前端日志失败", error));
  }

  function error(message, error, context) {
    console.error(message, error);
    write("error", formatErrorMessage(message, error), context);
  }

  function debug(message, context) {
    write("debug", message, context);
  }

  return { debug, error };
}

function formatErrorMessage(message, error) {
  if (!error) return message;
  if (typeof error === "string") return `${message}: ${error}`;
  if (error?.message) return `${message}: ${error.message}`;
  try {
    return `${message}: ${JSON.stringify(error)}`;
  } catch {
    return `${message}: ${String(error)}`;
  }
}
