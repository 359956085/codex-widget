import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const retryDelays = [10_000, 20_000];
const attemptTimeout = 60_000;
const transientCodes = new Set([
  "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "ESOCKETTIMEDOUT",
  "ECONNECTIONTIMEOUT", "EIDLETIMEOUT", "ERESPONSETIMEOUT", "ETRANSFERTIMEOUT"
]);

function failure(reason, retryable = false, exitCode = 1) {
  return { reason, retryable, exitCode };
}

function classifyStatus(status, exitCode) {
  const retryable = status === 408 || status === 429 || (status >= 500 && status <= 599);
  return failure(`HTTP ${status}`, retryable, exitCode);
}

function classifyCode(code, exitCode) {
  const status = /^E(\d{3})$/.exec(code);
  return status
    ? classifyStatus(Number(status[1]), exitCode)
    : failure(code, transientCodes.has(code), exitCode);
}

function isAuditReport(report) {
  const counts = report?.metadata?.vulnerabilities;
  return report?.auditReportVersion === 2 && !report.error &&
    report.vulnerabilities !== null && typeof report.vulnerabilities === "object" &&
    !Array.isArray(report.vulnerabilities) &&
    ["info", "low", "moderate", "high", "critical", "total"].every(
      (severity) => Number.isInteger(counts?.[severity]) && counts[severity] >= 0
    );
}

export function classifyAuditResult(result) {
  const exitCode = Number.isInteger(result.code) && result.code > 0 ? result.code : 1;
  if (result.error) return failure(`npm 无法运行：${result.error.message}`, false, exitCode);
  if (result.timedOut) return failure("单次审计超过 60 秒", true, exitCode);
  if (result.signal) return failure(`npm 被信号 ${result.signal} 终止`, false, exitCode);

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // npm 启动或配置失败时可能只在 stderr 输出错误码。
  }

  // 完整报告优先：漏洞标题、URL 或说明里的网络错误字样不能触发重试。
  if (isAuditReport(report)) {
    return result.code === 0
      ? { exitCode: 0, retryable: false, reason: "审计通过" }
      : failure("审计未通过安全门槛", false, exitCode);
  }
  if (result.code === 0) return failure("npm 未返回有效的审计报告");

  const status = report?.statusCode ?? report?.error?.statusCode;
  if (Number.isInteger(status)) return classifyStatus(status, exitCode);

  const stderr = result.stderr ?? "";
  const stderrCode = /^npm (?:ERR!|error) code\s+(\S+)\s*$/im.exec(stderr)?.[1];
  const code = report?.error?.code ?? report?.code ?? stderrCode;
  if (typeof code === "string") return classifyCode(code, exitCode);

  // npm 的 audit endpoint 错误可能丢失 error.code，仅保留顶层 message。
  const messages = [report?.message, report?.error?.message, report?.error?.summary];
  for (const match of stderr.matchAll(/^npm (?:ERR!|error|WARN|warn) audit\s+(.+)$/gim)) {
    messages.push(match[1]);
  }
  for (const message of messages) {
    if (typeof message !== "string") continue;
    const httpStatus = /^(?:E)?([45]\d{2})\b/.exec(message);
    if (httpStatus) return classifyStatus(Number(httpStatus[1]), exitCode);
    const networkCode = message.match(/\bE[A-Z_]+\b/g)?.find((value) => transientCodes.has(value));
    if (networkCode) return classifyCode(networkCode, exitCode);
    if (/^(?:request to .+ failed, reason: |.*\bFetchError: )?(?:socket hang up|network timeout at:|request timed out\b)/i.test(message)) {
      return failure("npm 审计请求连接中断或超时", true, exitCode);
    }
  }
  return failure("npm 未返回有效的审计报告，错误不可重试", false, exitCode);
}

export async function runAuditAttempt({
  signal,
  spawnProcess = spawn,
  npmExecPath = process.env.npm_execpath,
  nodeExecPath = process.execPath
} = {}) {
  if (signal?.aborted) return { code: null, stdout: "", stderr: "" };
  if (!npmExecPath) {
    return { error: new Error("缺少 npm_execpath，请使用 npm run audit 启动审计") };
  }

  return new Promise((resolveAttempt) => {
    let child;
    try {
      child = spawnProcess(nodeExecPath, [
        npmExecPath, "audit", "--json", "--audit-level=high",
        "--registry=https://registry.npmjs.org", "--fetch-retries=0",
        "--fetch-timeout=20000", "--color=false"
      ], {
        cwd: repoRoot,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      resolveAttempt({ error });
      return;
    }

    const result = { stdout: "", stderr: "", timedOut: false };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { result.stdout += chunk; });
    child.stderr.on("data", (chunk) => { result.stderr += chunk; });
    child.once("error", (error) => { result.error = error; });
    const stop = () => { child.kill("SIGKILL"); };
    const timer = setTimeout(() => {
      result.timedOut = true;
      stop();
    }, attemptTimeout);
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolveAttempt({ ...result, code, signal: exitSignal });
    });
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}

function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolveWait) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolveWait();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function runAudit({
  attempt = runAuditAttempt,
  signal,
  log = (message) => console.error(`[npm audit] ${message}`),
  writeStdout = (chunk) => process.stdout.write(chunk),
  writeStderr = (chunk) => process.stderr.write(chunk)
} = {}) {
  const maxAttempts = retryDelays.length + 1;
  for (let index = 0; index < maxAttempts; index += 1) {
    if (signal?.aborted) break;
    log(`开始审计，第 ${index + 1}/${maxAttempts} 次尝试`);
    const result = await attempt({ signal });
    if (result.stdout) writeStdout(result.stdout);
    if (result.stderr) writeStderr(result.stderr);
    if (signal?.aborted) break;

    const outcome = classifyAuditResult(result);
    if (outcome.exitCode === 0) {
      log(outcome.reason);
      return 0;
    }
    if (!outcome.retryable) {
      log(`${outcome.reason}，停止审计`);
      return outcome.exitCode;
    }
    if (index === retryDelays.length) {
      log(`${outcome.reason}；${maxAttempts} 次尝试均失败，审计未完成`);
      return outcome.exitCode;
    }
    const delay = retryDelays[index];
    log(`${outcome.reason}；${delay / 1000} 秒后重试`);
    await waitForRetry(delay, signal);
  }
  log("审计已取消");
  return signal?.reason === 143 ? 143 : 130;
}

async function main() {
  const controller = new AbortController();
  const onInterrupt = () => controller.abort(130);
  const onTerminate = () => controller.abort(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    return await runAudit({ signal: controller.signal });
  } catch (error) {
    console.error(`[npm audit] 审计执行失败：${error.message}`);
    return 1;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
