#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const INGEST_URL_ENV = "DEVELOPER_DASHBOARD_CODEX_INGEST_URL";
export const INGEST_TOKEN_ENV = "DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN";

const REQUEST_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

class SafeCliError extends Error {}

const usage = () => [
  "Usage:",
  "  report-codex-session complete --file PATH",
  "  report-codex-session complete < session.json",
  "  report-codex-session verify --github-full-name OWNER/REPOSITORY [--json]",
  "",
  `Required environment: ${INGEST_URL_ENV}, ${INGEST_TOKEN_ENV}`,
].join("\n");

const parseArguments = (argv) => {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true, command: null, filePath: null, githubFullName: null, json: false };
  }

  if (argv[0] !== "complete" && argv[0] !== "verify") {
    throw new SafeCliError("Use complete to report a session or verify to check a project association.");
  }

  const command = argv[0];
  let filePath = null;
  let githubFullName = null;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true, command: null, filePath: null, githubFullName: null, json: false };
    }
    if (argument === "--token" || argument.startsWith("--token=")) {
      throw new SafeCliError(`Supply the credential only through ${INGEST_TOKEN_ENV}.`);
    }
    if (command === "complete" && argument === "--file") {
      if (filePath !== null || index + 1 >= argv.length) {
        throw new SafeCliError("Provide exactly one path after --file.");
      }
      filePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (command === "verify" && argument === "--github-full-name") {
      if (githubFullName !== null || index + 1 >= argv.length) {
        throw new SafeCliError("Provide exactly one owner/repository value after --github-full-name.");
      }
      githubFullName = argv[index + 1];
      index += 1;
      continue;
    }
    if (command === "verify" && argument === "--json") {
      if (json) throw new SafeCliError("Provide --json at most once.");
      json = true;
      continue;
    }
    throw new SafeCliError("Unsupported command argument.");
  }

  if (command === "verify" && githubFullName === null) {
    throw new SafeCliError("The verify command requires --github-full-name OWNER/REPOSITORY.");
  }

  return { help: false, command, filePath, githubFullName, json };
};

const readStreamText = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const loadPayloadText = async ({ filePath, stdin, readFileImplementation }) => {
  if (filePath !== null) {
    try {
      return await readFileImplementation(filePath, "utf8");
    } catch {
      throw new SafeCliError("Unable to read the session JSON file.");
    }
  }

  if (stdin?.isTTY) {
    throw new SafeCliError("Provide --file PATH or pipe a JSON payload through stdin.");
  }

  try {
    return await readStreamText(stdin);
  } catch {
    throw new SafeCliError("Unable to read the session JSON from stdin.");
  }
};

const validateJsonPayload = (payloadText) => {
  if (!payloadText.trim()) {
    throw new SafeCliError("The session payload is empty.");
  }

  try {
    const parsed = JSON.parse(payloadText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Payload root must be an object.");
    }
    return parsed;
  } catch {
    throw new SafeCliError("The session payload must be valid JSON object data.");
  }
};

const readConfiguration = (environment) => {
  const rawEndpoint = environment[INGEST_URL_ENV]?.trim();
  if (!rawEndpoint) {
    throw new SafeCliError(`Missing ${INGEST_URL_ENV}.`);
  }

  let endpoint;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new SafeCliError(`${INGEST_URL_ENV} must be a valid URL.`);
  }

  const isSecure = endpoint.protocol === "https:";
  const isLoopbackHttp = endpoint.protocol === "http:" && LOOPBACK_HOSTS.has(endpoint.hostname);
  if ((!isSecure && !isLoopbackHttp) || endpoint.username || endpoint.password) {
    throw new SafeCliError(`${INGEST_URL_ENV} must use HTTPS.`);
  }

  const token = environment[INGEST_TOKEN_ENV]?.trim();
  if (!token) {
    throw new SafeCliError(`Missing ${INGEST_TOKEN_ENV}.`);
  }

  return { endpoint: endpoint.toString(), token };
};

const readSafeErrorCode = async (response) => {
  try {
    const rawResponse = await response.text();
    if (Buffer.byteLength(rawResponse, "utf8") > 32_768) return null;
    const parsed = JSON.parse(rawResponse);
    return typeof parsed?.error?.code === "string" ? parsed.error.code : null;
  } catch {
    return null;
  }
};

const safeHttpFailure = async (response) => {
  const { status } = response;
  if (status === 400 || status === 422) return "Developer Dashboard rejected the session payload.";
  if (status === 401 || status === 403) return "Developer Dashboard ingestion authentication failed.";
  if (status === 404) {
    return "Developer Dashboard could not safely associate the requested project.";
  }
  if (status === 409) {
    const code = await readSafeErrorCode(response);
    if (code === "idempotency_conflict") {
      return "Developer Dashboard rejected a conflicting retry for this external session ID.";
    }
    return "Developer Dashboard could not safely associate the session with a project.";
  }
  if (status === 413) return "The session payload is too large for Developer Dashboard.";
  if (status === 429) return "Developer Dashboard ingestion is temporarily rate limited.";
  if (status >= 500) return "Developer Dashboard ingestion is temporarily unavailable.";
  return `Developer Dashboard ingestion failed with HTTP status ${status}.`;
};

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const githubFullNamePattern = /^[^/\s]+\/[^/\s]+$/;

const normalizeGithubFullName = (value) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized || normalized.length > 256 || !githubFullNamePattern.test(normalized)) {
    throw new SafeCliError("GitHub full name must be exact OWNER/REPOSITORY syntax.");
  }
  return normalized;
};

const readIngestionResult = async (response, expectedExternalSessionId) => {
  try {
    const rawResponse = await response.text();
    if (Buffer.byteLength(rawResponse, "utf8") > 32_768) {
      throw new Error("Response exceeds the safe limit.");
    }
    const parsed = JSON.parse(rawResponse);
    const validStatus = parsed?.status === "created" || parsed?.status === "duplicate";
    const validIdentity = [
      parsed?.projectId,
      parsed?.externalSessionId,
      parsed?.sessionId,
      parsed?.promptId,
      parsed?.activityId,
    ].every(isNonEmptyString);
    const validIdeas = Array.isArray(parsed?.ideaIds) && parsed.ideaIds.every(isNonEmptyString);
    if (
      parsed?.ok !== true ||
      typeof parsed?.idempotent !== "boolean" ||
      !validStatus ||
      !validIdentity ||
      !validIdeas ||
      parsed.externalSessionId !== expectedExternalSessionId
    ) {
      throw new Error("Unexpected response contract.");
    }
    if ((parsed.status === "duplicate") !== parsed.idempotent) {
      throw new Error("Inconsistent idempotency response.");
    }
    return { idempotent: parsed.idempotent };
  } catch {
    throw new SafeCliError("Developer Dashboard returned an invalid ingestion response.");
  }
};

/**
 * @param {{
 *   endpoint: string;
 *   token: string;
 *   payloadText: string;
 *   expectedExternalSessionId: string;
 *   fetchImplementation?: typeof globalThis.fetch;
 *   timeoutMs?: number;
 * }} input
 */
export const submitCodexSession = async ({
  endpoint,
  token,
  payloadText,
  expectedExternalSessionId,
  fetchImplementation = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  let response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: payloadText,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SafeCliError(await safeHttpFailure(response));
    }

    return await readIngestionResult(response, expectedExternalSessionId);
  } catch (error) {
    if (error instanceof SafeCliError) throw error;
    throw new SafeCliError("Could not reach the Developer Dashboard ingestion endpoint.");
  } finally {
    clearTimeout(timeout);
  }
};

const readProjectVerificationResult = async (response) => {
  try {
    const rawResponse = await response.text();
    if (Buffer.byteLength(rawResponse, "utf8") > 32_768) {
      throw new Error("Response exceeds the safe limit.");
    }
    const parsed = JSON.parse(rawResponse);
    const keys = Object.keys(parsed ?? {}).sort();
    const expectedKeys = [
      "dashboardProjectId",
      "dashboardProjectTitle",
      "matched",
      "matchedBy",
      "ok",
      "status",
    ].sort();
    const exactSafeShape = keys.length === expectedKeys.length &&
      keys.every((key, index) => key === expectedKeys[index]);
    const validMatchKind = ["dashboardId", "githubRepositoryId", "githubFullName"]
      .includes(parsed?.matchedBy);
    if (
      !exactSafeShape ||
      parsed?.ok !== true ||
      parsed?.matched !== true ||
      parsed?.status !== "associated" ||
      !isNonEmptyString(parsed?.dashboardProjectId) ||
      typeof parsed?.dashboardProjectTitle !== "string" ||
      !validMatchKind
    ) {
      throw new Error("Unexpected response contract.");
    }
    return parsed;
  } catch {
    throw new SafeCliError("Developer Dashboard returned an invalid project verification response.");
  }
};

/**
 * @param {{
 *   endpoint: string;
 *   token: string;
 *   githubFullName: string;
 *   fetchImplementation?: typeof globalThis.fetch;
 *   timeoutMs?: number;
 * }} input
 */
export const verifyCodexProject = async ({
  endpoint,
  token,
  githubFullName,
  fetchImplementation = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  const payloadText = JSON.stringify({
    schemaVersion: 1,
    operation: "verify_project",
    project: { githubFullName },
    source: "codex",
  });

  try {
    const response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: payloadText,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SafeCliError(await safeHttpFailure(response));
    }
    return await readProjectVerificationResult(response);
  } catch (error) {
    if (error instanceof SafeCliError) throw error;
    throw new SafeCliError("Could not reach the Developer Dashboard ingestion endpoint.");
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * @param {{
 *   argv?: string[];
 *   environment?: Record<string, string | undefined>;
 *   fetchImplementation?: typeof globalThis.fetch;
 *   stdin?: { isTTY?: boolean; [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array> };
 *   stdout?: { write(chunk: string): unknown };
 *   stderr?: { write(chunk: string): unknown };
 *   readFileImplementation?: (path: string, encoding: "utf8") => Promise<string>;
 * }} [options]
 */
export const runCodexSessionCli = async ({
  argv = process.argv.slice(2),
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  readFileImplementation = readFile,
} = {}) => {
  try {
    const argumentsResult = parseArguments(argv);
    if (argumentsResult.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const { endpoint, token } = readConfiguration(environment);
    if (argumentsResult.command === "verify") {
      const githubFullName = normalizeGithubFullName(argumentsResult.githubFullName);
      const result = await verifyCodexProject({
        endpoint,
        token,
        githubFullName,
        fetchImplementation,
      });
      if (argumentsResult.json) {
        stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        stdout.write(
          `Developer Dashboard project association verified: ${result.dashboardProjectTitle} ` +
          `(${result.dashboardProjectId}; matched by ${result.matchedBy}).\n`,
        );
      }
      return 0;
    }

    const payloadText = await loadPayloadText({
      filePath: argumentsResult.filePath,
      stdin,
      readFileImplementation,
    });
    const parsedPayload = validateJsonPayload(payloadText);
    const externalSessionId = parsedPayload?.session?.externalSessionId;
    if (!isNonEmptyString(externalSessionId) || externalSessionId.trim().length === 0) {
      throw new SafeCliError("The session payload must include session.externalSessionId.");
    }

    const result = await submitCodexSession({
      endpoint,
      token,
      payloadText,
      expectedExternalSessionId: externalSessionId.trim(),
      fetchImplementation,
    });
    const suffix = result.idempotent ? " (already recorded; no duplicates created)" : "";
    stdout.write(`Codex session reported to Developer Dashboard${suffix}.\n`);
    return 0;
  } catch (error) {
    const message = error instanceof SafeCliError
      ? error.message
      : "Developer Dashboard session reporting failed safely.";
    stderr.write(`${message}\n`);
    return 1;
  }
};

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  process.exitCode = await runCodexSessionCli();
}
