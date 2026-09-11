export function normalizeError(error, fallback = "未知错误") {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  try {
    return JSON.stringify(error) || fallback;
  } catch {
    return String(error ?? fallback);
  }
}
