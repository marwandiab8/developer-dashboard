import assert from "node:assert/strict";
import test from "node:test";
import { requireCodexIngestionCredential, requireCodexOwnerUid } from "../src/codex/auth";
import { parseCodexSessionIngestV1 } from "../src/codex/contract";
import { createCodexIngestionHttpHandler, type CodexHttpResponse } from "../src/codex/http";
import { CodexIngestionService, type CodexIngestionPersistencePort } from "../src/codex/service";
import { CodexIngestionError, type CodexIngestionResult } from "../src/codex/types";

const projectId = "33333333-3333-4333-8333-333333333333";
const payload = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1,
  project: { dashboardProjectId: projectId },
  session: {
    externalSessionId: "codex-session-1",
    startedAt: "2026-08-11T10:00:00.000Z",
    endedAt: "2026-08-11T11:00:00.000Z",
    prompt: "  preserve this prompt\n\n",
    objective: "Implement ingestion",
    summary: "  completed safely\n",
    completed: ["backend"],
    unfinished: [],
    problemsDiscovered: [],
    decisionsMade: [],
    filesModified: ["functions/src/codex/contract.ts"],
    commits: [],
    ...changes,
  },
  source: "codex",
});

const expectIngestionCode = (action: () => unknown, code: string) => {
  assert.throws(action, (error) => error instanceof CodexIngestionError && error.code === code);
};

test("validates V1 while preserving authored whitespace and normalizing machine identity", () => {
  const parsed = parseCodexSessionIngestV1({
    ...payload(),
    project: { githubFullName: " Owner/Repo ", localPath: " /workspace/repo " },
    session: { ...(payload().session as object), externalSessionId: " session:one " },
  });
  assert.equal(parsed.project.githubFullName, "owner/repo");
  assert.equal(parsed.project.localPath, "/workspace/repo");
  assert.equal(parsed.session.externalSessionId, "session:one");
  assert.equal(parsed.session.prompt, "  preserve this prompt\n\n");
  assert.equal(parsed.session.summary, "  completed safely\n");
});

test("rejects unsupported versions, malformed payloads, unsafe bounds, and reverse timestamps", () => {
  expectIngestionCode(() => parseCodexSessionIngestV1({ ...payload(), schemaVersion: 2 }), "unsupported_schema");
  expectIngestionCode(() => parseCodexSessionIngestV1({ ...payload(), source: "other" }), "invalid_request");
  expectIngestionCode(() => parseCodexSessionIngestV1({ ...payload(), project: {} }), "invalid_request");
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({ completed: Array(101).fill("item") })), "invalid_request");
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({ filesModified: Array(251).fill("file") })), "invalid_request");
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({ ideas: Array(26).fill({ text: "idea" }) })), "invalid_request");
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({ prompt: "x".repeat(128 * 1024 + 1) })), "invalid_request");
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({
    startedAt: "2026-08-11T12:00:00.000Z",
    endedAt: "2026-08-11T11:00:00.000Z",
  })), "invalid_request");
});

test("rejects oversized serialized payloads and obvious credentials without echoing them", () => {
  const credential = `github_pat_${"A".repeat(30)}`;
  let caught: unknown;
  try {
    parseCodexSessionIngestV1(payload({ prompt: `use ${credential}` }));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof CodexIngestionError);
  assert.equal(caught.code, "sensitive_content");
  assert.equal(caught.message.includes(credential), false);
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({
    prompt: `client_secret=${"z".repeat(24)}`,
  })), "sensitive_content");
  expectIngestionCode(() => parseCodexSessionIngestV1(payload({
    completed: Array(100).fill("x".repeat(3000)),
  })), "invalid_request");
});

test("requires the configured bearer credential and owner without exposing either", () => {
  const secret = (value: string) => ({ value: () => value });
  assert.doesNotThrow(() => requireCodexIngestionCredential("Bearer correct-token", secret("correct-token")));
  expectIngestionCode(() => requireCodexIngestionCredential(undefined, secret("correct-token")), "unauthenticated");
  expectIngestionCode(() => requireCodexIngestionCredential("Bearer wrong-token", secret("correct-token")), "unauthenticated");
  expectIngestionCode(() => requireCodexIngestionCredential("Bearer anything", secret("")), "configuration_unavailable");
  assert.equal(requireCodexOwnerUid(secret(" owner ")), "owner");
  expectIngestionCode(() => requireCodexOwnerUid(secret("")), "configuration_unavailable");
});

class RecordingPersistence implements CodexIngestionPersistencePort {
  input: Parameters<CodexIngestionPersistencePort["ingest"]>[0] | null = null;
  async ingest(input: Parameters<CodexIngestionPersistencePort["ingest"]>[0]): Promise<CodexIngestionResult> {
    this.input = input;
    return {
      ok: true, idempotent: false, status: "created", projectId,
      externalSessionId: input.payload.session.externalSessionId,
      sessionId: "10000000-0000-5000-8000-000000000001",
      promptId: "10000000-0000-5000-8000-000000000002",
      activityId: "10000000-0000-5000-8000-000000000003",
      ideaIds: [],
    };
  }
}

test("service validates before persistence and supplies a stable fingerprint and receive time", async () => {
  const persistence = new RecordingPersistence();
  const service = new CodexIngestionService(persistence, { now: () => new Date("2026-08-11T11:01:00.000Z") });
  await service.ingest("owner", payload());
  assert.equal(persistence.input?.uid, "owner");
  assert.match(persistence.input?.fingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.equal(persistence.input?.receivedAt, "2026-08-11T11:01:00.000Z");
  await assert.rejects(() => service.ingest("owner", { ...payload(), schemaVersion: 9 }));
  await assert.rejects(
    () => service.ingest("owner", payload({ endedAt: "2026-08-11T11:12:00.000Z" })),
    (error) => error instanceof CodexIngestionError && error.code === "invalid_request",
  );
});

class FakeResponse implements CodexHttpResponse {
  statusCode = 0;
  body: unknown;
  headers = new Map<string, string>();
  setHeader(name: string, value: string) { this.headers.set(name, value); return this; }
  status(code: number) { this.statusCode = code; return this; }
  json(body: unknown) { this.body = body; return this; }
}

test("HTTP handler accepts valid auth and returns observable idempotency", async () => {
  const response = new FakeResponse();
  const service = {
    ingest: async () => ({
      ok: true as const, idempotent: true, status: "duplicate" as const, projectId,
      externalSessionId: "session", sessionId: "session-id", promptId: "prompt-id",
      activityId: "activity-id", ideaIds: [],
    }),
  };
  const handler = createCodexIngestionHttpHandler({
    service,
    ingestionSecret: { value: () => "token" },
    ownerUidSecret: { value: () => "owner" },
  });
  await handler({ method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: payload() }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, await service.ingest());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("HTTP handler sanitizes auth and internal failures and rejects non-POST methods", async () => {
  const secretValue = "do-not-print-token";
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const handler = createCodexIngestionHttpHandler({
    service: { ingest: async () => { throw new Error(`failed with ${secretValue}`); } },
    ingestionSecret: { value: () => secretValue },
    ownerUidSecret: { value: () => "owner" },
    logger: { info: () => undefined, warn: (_message, details) => warnings.push(details) },
  });
  const missing = new FakeResponse();
  await handler({ method: "POST", headers: { "content-type": "application/json" }, body: payload() }, missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(JSON.stringify(missing.body).includes(secretValue), false);

  const internal = new FakeResponse();
  await handler({ method: "POST", headers: { authorization: `Bearer ${secretValue}`, "content-type": "application/json" }, body: payload() }, internal);
  assert.equal(internal.statusCode, 500);
  assert.equal(JSON.stringify(internal.body).includes(secretValue), false);
  assert.equal(JSON.stringify(warnings).includes(secretValue), false);

  const method = new FakeResponse();
  await handler({ method: "GET", headers: {} }, method);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.get("Allow"), "POST");
});

test("HTTP handler requires JSON and enforces the raw request byte ceiling", async () => {
  let calls = 0;
  const handler = createCodexIngestionHttpHandler({
    service: { ingest: async () => { calls += 1; throw new Error("must not run"); } },
    ingestionSecret: { value: () => "token" },
    ownerUidSecret: { value: () => "owner" },
  });
  const wrongType = new FakeResponse();
  await handler({
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "text/plain" },
    body: payload(),
  }, wrongType);
  assert.equal(wrongType.statusCode, 400);

  const oversized = new FakeResponse();
  await handler({
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json; charset=utf-8" },
    body: payload(),
    rawBody: Buffer.alloc(256 * 1024 + 1, 0x20),
  }, oversized);
  assert.equal(oversized.statusCode, 400);
  assert.equal(calls, 0);
});

test("HTTP handler rejects configured ingestion and owner secrets embedded in payload content", async () => {
  const ingestionCredential = "configured-ingestion-credential-value";
  const ownerUid = "configured-owner-uid-value";
  let calls = 0;
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const handler = createCodexIngestionHttpHandler({
    service: { ingest: async () => { calls += 1; throw new Error("must not run"); } },
    ingestionSecret: { value: () => ingestionCredential },
    ownerUidSecret: { value: () => ownerUid },
    logger: { info: () => undefined, warn: (_message, details) => warnings.push(details) },
  });

  for (const sensitiveValue of [ingestionCredential, ownerUid]) {
    const response = new FakeResponse();
    await handler({
      method: "POST",
      headers: {
        authorization: `Bearer ${ingestionCredential}`,
        "content-type": "application/json",
      },
      body: payload({ summary: `must reject ${sensitiveValue} without echoing it` }),
    }, response);
    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { error?: { code?: string } }).error?.code, "sensitive_content");
    assert.equal(JSON.stringify(response.body).includes(sensitiveValue), false);
  }

  assert.equal(calls, 0);
  assert.equal(JSON.stringify(warnings).includes(ingestionCredential), false);
  assert.equal(JSON.stringify(warnings).includes(ownerUid), false);
});
