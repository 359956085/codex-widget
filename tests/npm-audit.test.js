import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyAuditResult, runAudit, runAuditAttempt } from "../scripts/npm-audit.mjs";

function auditReport(severity, code) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  if (severity) {
    counts[severity] = 1;
    counts.total = 1;
  }
  return {
    code: code ?? (["high", "critical"].includes(severity) ? 1 : 0),
    stdout: JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: severity ? {
        example: { severity, via: [{ title: "503 ECONNRESET is part of this advisory" }] }
      } : {},
      metadata: { vulnerabilities: counts }
    }),
    stderr: ""
  };
}

function endpointError(statusCode = 503) {
  return {
    code: 1,
    stdout: JSON.stringify({
      message: `${statusCode} Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick`,
      statusCode,
      body: { error: "Service Unavailable" },
      error: { summary: "", detail: "" }
    }),
    stderr: `npm warn audit ${statusCode} Service Unavailable\nnpm error audit endpoint returned an error\n`
  };
}

function startAudit(results, signal) {
  const attempt = vi.fn();
  for (const result of results) attempt.mockResolvedValueOnce(result);
  const log = vi.fn();
  const writeStdout = vi.fn();
  const writeStderr = vi.fn();
  const completion = runAudit({ attempt, signal, log, writeStdout, writeStderr });
  return { completion, attempt, log, writeStdout, writeStderr };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

describe("npm 审计结果分类", () => {
  it.each([undefined, "low", "moderate"])("%s 漏洞不触发 high 门槛", (severity) => {
    expect(classifyAuditResult(auditReport(severity))).toMatchObject({ exitCode: 0, retryable: false });
  });

  it.each(["high", "critical"])("%s 漏洞立即失败，不匹配漏洞正文中的网络错误", (severity) => {
    expect(classifyAuditResult(auditReport(severity))).toMatchObject({ exitCode: 1, retryable: false });
  });

  it.each([408, 429, 500, 502, 503, 504, 599])("HTTP %i 可重试", (status) => {
    expect(classifyAuditResult(endpointError(status))).toMatchObject({ exitCode: 1, retryable: true });
  });

  it.each(["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNECTIONTIMEOUT", "EIDLETIMEOUT", "ERESPONSETIMEOUT", "ETRANSFERTIMEOUT", "E503"])("识别结构化错误码 %s", (code) => {
    expect(classifyAuditResult({ code: 1, stdout: JSON.stringify({ error: { code } }) }).retryable).toBe(true);
  });

  it.each([
    "request to https://registry.npmjs.org failed, reason: read ECONNRESET",
    "request to https://registry.npmjs.org failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org",
    "request to https://registry.npmjs.org failed, reason: socket hang up",
    "network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk"
  ])("识别 npm 丢失错误码后的顶层消息：%s", (message) => {
    expect(classifyAuditResult({
      code: 1, stdout: JSON.stringify({ message, error: { summary: "", detail: "" } })
    }).retryable).toBe(true);
  });

  it.each(["npm ERR! code ECONNRESET", "npm error code ETIMEDOUT", "npm warn audit 503 Service Unavailable"])("识别明确的 npm stderr 标记：%s", (stderr) => {
    expect(classifyAuditResult({ code: 1, stdout: "", stderr }).retryable).toBe(true);
  });

  it.each(["EACCES", "E401", "E403", "ENOLOCK", "EUSAGE", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ENOTFOUND"])("权限、配置、证书等错误 %s 不重试", (code) => {
    expect(classifyAuditResult({ code: 2, stdout: JSON.stringify({ error: { code } }) }))
      .toMatchObject({ exitCode: 2, retryable: false });
  });

  it.each([401, 403, 404])("HTTP %i 不重试", (status) => {
    expect(classifyAuditResult(endpointError(status)).retryable).toBe(false);
  });

  it.each(["", "not json", "null", "[]", "{}", '{"metadata":{"vulnerabilities":{}}}'])("退出码为零但报告无效时失败：%s", (stdout) => {
    expect(classifyAuditResult({ code: 0, stdout })).toMatchObject({ exitCode: 1, retryable: false });
  });

  it("未知错误正文和普通 stderr 中的网络字样不触发重试", () => {
    expect(classifyAuditResult({
      code: 1,
      stdout: JSON.stringify({ body: { title: "503 ECONNRESET" } }),
      stderr: "This is an unrelated 503 ECONNRESET message"
    }).retryable).toBe(false);
  });

  it("完整漏洞报告优先于 stderr 的网络警告，并保留 npm 退出码", () => {
    expect(classifyAuditResult({ ...auditReport("high", 7), stderr: "npm warn audit 503 Service Unavailable" }))
      .toMatchObject({ exitCode: 7, retryable: false });
  });
});

describe("npm 审计重试与取消", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("临时故障后等待 10 秒再重试，并保留报告与诊断输出", async () => {
    const failed = endpointError();
    const passed = auditReport();
    const run = startAudit([failed, passed]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(run.attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run.completion).toBe(0);
    expect(run.attempt).toHaveBeenCalledTimes(2);
    expect(run.writeStdout.mock.calls).toEqual([[failed.stdout], [passed.stdout]]);
    expect(run.writeStderr).toHaveBeenCalledWith(failed.stderr);
    expect(run.log).toHaveBeenCalledWith("HTTP 503；10 秒后重试");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("第二次失败后等待 20 秒，第三次失败停止且保留退出码", async () => {
    const failed = { ...endpointError(), code: 9 };
    const run = startAudit([failed, failed, failed]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(run.attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run.completion).toBe(9);
    expect(run.attempt).toHaveBeenCalledTimes(3);
    expect(run.log).toHaveBeenLastCalledWith("HTTP 503；3 次尝试均失败，审计未完成");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("重试后发现高危漏洞立即停止", async () => {
    const run = startAudit([endpointError(), auditReport("high")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run.completion).toBe(1);
    expect(run.attempt).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("不可重试错误不会等待", async () => {
    const run = startAudit([{ code: 1, stdout: '{"error":{"code":"ENOLOCK"}}' }]);
    expect(await run.completion).toBe(1);
    expect(run.attempt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("等待期间取消立即结束，清理计时器且不再启动 npm", async () => {
    const controller = new AbortController();
    const run = startAudit([endpointError()], controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(130);
    expect(await run.completion).toBe(130);
    expect(run.attempt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("启动前已取消时不创建子进程", async () => {
    const controller = new AbortController();
    controller.abort(143);
    const run = startAudit([], controller.signal);
    expect(await run.completion).toBe(143);
    expect(run.attempt).not.toHaveBeenCalled();
  });

  it("超时后终止进程，等到 close 才重试", async () => {
    const children = [fakeChild(), fakeChild()];
    const spawnProcess = vi.fn().mockReturnValueOnce(children[0]).mockReturnValueOnce(children[1]);
    const run = runAudit({
      attempt: (options) => runAuditAttempt({ ...options, spawnProcess, npmExecPath: "/npm-cli.js" }),
      log: vi.fn(), writeStdout: vi.fn(), writeStderr: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(children[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spawnProcess).toHaveBeenCalledOnce();
    children[0].emit("close", null, "SIGKILL");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    children[1].stdout.write(auditReport().stdout);
    children[1].emit("close", 0, null);
    expect(await run).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("执行期间取消会终止 npm，并等待其退出后返回取消状态", async () => {
    const controller = new AbortController();
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    const settled = vi.fn();
    const run = runAudit({
      signal: controller.signal,
      attempt: (options) => runAuditAttempt({ ...options, spawnProcess, npmExecPath: "/npm-cli.js" }),
      log: vi.fn()
    }).then((code) => { settled(); return code; });
    controller.abort(143);
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(settled).not.toHaveBeenCalled();
    child.emit("close", null, "SIGKILL");
    expect(await run).toBe(143);
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("npm 子进程调用", () => {
  it("Node 与 npm 路径含空格时使用独立参数，并正确收集 UTF-8 输出", async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    const result = runAuditAttempt({
      spawnProcess, npmExecPath: "C:/Program Files/nodejs/npm-cli.js", nodeExecPath: "C:/Program Files/nodejs/node.exe"
    });
    expect(spawnProcess).toHaveBeenCalledWith("C:/Program Files/nodejs/node.exe", [
      "C:/Program Files/nodejs/npm-cli.js", "audit", "--json", "--audit-level=high",
      "--registry=https://registry.npmjs.org", "--fetch-retries=0", "--fetch-timeout=20000", "--color=false"
    ], expect.objectContaining({ shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
    const bytes = Buffer.from("漏洞报告");
    child.stdout.write(bytes.subarray(0, 2));
    child.stdout.write(bytes.subarray(2));
    child.stderr.write("diagnostic");
    child.emit("close", 7, null);
    expect(await result).toMatchObject({ stdout: "漏洞报告", stderr: "diagnostic", code: 7, timedOut: false });
  });

  it("缺少 npm_execpath 时明确失败，不尝试通过 shell 查找 npm", async () => {
    const spawnProcess = vi.fn();
    const result = await runAuditAttempt({ spawnProcess, npmExecPath: "" });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(classifyAuditResult(result)).toMatchObject({ exitCode: 1, retryable: false });
    expect(result.error.message).toContain("npm run audit");
  });

  it("启动异常不重试", async () => {
    const error = new Error("spawn EACCES");
    const result = await runAuditAttempt({ spawnProcess: () => { throw error; }, npmExecPath: "/npm-cli.js" });
    expect(classifyAuditResult(result)).toMatchObject({ exitCode: 1, retryable: false });
  });

  it("异步启动错误后正确结束并清理取消监听", async () => {
    const controller = new AbortController();
    const child = fakeChild();
    const result = runAuditAttempt({ signal: controller.signal, spawnProcess: () => child, npmExecPath: "/npm-cli.js" });
    child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    child.emit("close", -2, null);
    expect(classifyAuditResult(await result)).toMatchObject({ exitCode: 1, retryable: false });
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
