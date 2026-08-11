import { describe, expect, it, vi } from "vitest";
import {
  INGEST_TOKEN_ENV,
  INGEST_URL_ENV,
  runCodexSessionCli,
} from "../tools/report-codex-session.mjs";

type OutputSink = {
  text: string;
  write: (chunk: string | Uint8Array) => boolean;
};

const sink = (): OutputSink => ({
  text: "",
  write(chunk) {
    this.text += String(chunk);
    return true;
  },
});

const input = (...chunks: Array<string | Buffer>) => ({
  isTTY: false,
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield chunk;
  },
});

const endpoint = "https://us-east4-example.cloudfunctions.net/ingestCodexSession";
const credential = "codex-ingest-test-credential-never-print";
const environment = {
  [INGEST_URL_ENV]: endpoint,
  [INGEST_TOKEN_ENV]: credential,
};
const successResponse = (externalSessionId: string, idempotent = false) => ({
  ok: true,
  idempotent,
  status: idempotent ? "duplicate" : "created",
  projectId: "33333333-3333-4333-8333-333333333333",
  externalSessionId,
  sessionId: "10000000-0000-5000-8000-000000000001",
  promptId: "10000000-0000-5000-8000-000000000002",
  activityId: "10000000-0000-5000-8000-000000000003",
  ideaIds: [],
});
const verificationResponse = {
  ok: true,
  matched: true,
  status: "associated",
  dashboardProjectId: "33333333-3333-4333-8333-333333333333",
  dashboardProjectTitle: "Developer Dashboard",
  matchedBy: "githubFullName",
};

describe("Codex session reporting helper", () => {
  it("verifies an exact GitHub full name without submitting a session or reading stdin", async () => {
    const stdout = sink();
    const stderr = sink();
    const readFileImplementation = vi.fn();
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe(endpoint);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential}`);
      expect(JSON.parse(String(init?.body))).toEqual({
        schemaVersion: 1,
        operation: "verify_project",
        project: { githubFullName: "marwandiab8/developer-dashboard" },
        source: "codex",
      });
      return new Response(JSON.stringify(verificationResponse), { status: 200 });
    });

    const exitCode = await runCodexSessionCli({
      argv: ["verify", "--github-full-name", " MarwanDiab8/Developer-Dashboard ", "--json"],
      environment,
      fetchImplementation,
      stdin: { isTTY: true } as typeof process.stdin,
      stdout,
      stderr,
      readFileImplementation,
    });

    expect(exitCode).toBe(0);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(readFileImplementation).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.text)).toEqual(verificationResponse);
    expect(stderr.text).toBe("");
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
  });

  it("prints a concise human-readable verified project result", async () => {
    const stdout = sink();
    const stderr = sink();
    const exitCode = await runCodexSessionCli({
      argv: ["verify", "--github-full-name", "marwandiab8/developer-dashboard"],
      environment,
      fetchImplementation: vi.fn(async () => new Response(
        JSON.stringify(verificationResponse),
        { status: 200 },
      )),
      stdin: input(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toBe(
      "Developer Dashboard project association verified: Developer Dashboard " +
      "(33333333-3333-4333-8333-333333333333; matched by githubFullName).\n",
    );
    expect(stderr.text).toBe("");
  });

  it("rejects invalid verification input before making a request", async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn();
    const exitCode = await runCodexSessionCli({
      argv: ["verify", "--github-full-name", "not-a-full-name"],
      environment,
      fetchImplementation,
      stdin: input(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe("GitHub full name must be exact OWNER/REPOSITORY syntax.\n");
  });

  it("sanitizes a missing project verification without printing the raw response", async () => {
    const stdout = sink();
    const stderr = sink();
    const rawSensitiveMessage = `missing project detail ${credential}`;
    const exitCode = await runCodexSessionCli({
      argv: ["verify", "--github-full-name", "owner/missing"],
      environment,
      fetchImplementation: vi.fn(async () => new Response(JSON.stringify({
        ok: false,
        error: { code: "project_not_associated", message: rawSensitiveMessage },
      }), { status: 404 })),
      stdin: input(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe(
      "Developer Dashboard could not safely associate the requested project.\n",
    );
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
    expect(`${stdout.text}${stderr.text}`).not.toContain(rawSensitiveMessage);
  });

  it("rejects a verification success response containing undeclared fields", async () => {
    const stdout = sink();
    const stderr = sink();
    const exitCode = await runCodexSessionCli({
      argv: ["verify", "--github-full-name", "owner/repo"],
      environment,
      fetchImplementation: vi.fn(async () => new Response(JSON.stringify({
        ...verificationResponse,
        ownerUid: "must-not-be-returned",
      }), { status: 200 })),
      stdin: input(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe(
      "Developer Dashboard returned an invalid project verification response.\n",
    );
    expect(`${stdout.text}${stderr.text}`).not.toContain("must-not-be-returned");
  });

  it("submits a file payload unchanged with bearer authentication from any working directory", async () => {
    const payload = `{
  "schemaVersion": 1,
  "source": "codex",
  "session": { "externalSessionId": "outside-repository", "summary": "Preserve whitespace ✓" }
}\n`;
    const stdout = sink();
    const stderr = sink();
    const readFileImplementation = vi.fn(async () => payload);
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe(endpoint);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential}`);
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(init?.body).toBe(payload);
      return new Response(JSON.stringify(successResponse("outside-repository")), { status: 200 });
    });

    const exitCode = await runCodexSessionCli({
      argv: ["complete", "--file", "/tmp/another-project/codex-session.json"],
      environment,
      fetchImplementation,
      stdin: input(),
      stdout,
      stderr,
      readFileImplementation,
    });

    expect(exitCode).toBe(0);
    expect(readFileImplementation).toHaveBeenCalledWith(
      "/tmp/another-project/codex-session.json",
      "utf8",
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(stdout.text).toBe("Codex session reported to Developer Dashboard.\n");
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
  });

  it("accepts piped JSON and reports a retry that was already ingested", async () => {
    const payload = '{"schemaVersion":1,"source":"codex","session":{"externalSessionId":" piped-session "}}\n';
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe(payload);
      return new Response(JSON.stringify(successResponse("piped-session", true)), { status: 200 });
    });

    const exitCode = await runCodexSessionCli({
      argv: ["complete"],
      environment,
      fetchImplementation,
      stdin: input(Buffer.from(payload.slice(0, 12)), Buffer.from(payload.slice(12))),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain("already recorded; no duplicates created");
    expect(stderr.text).toBe("");
  });

  it.each([
    {
      label: "URL",
      environment: { [INGEST_TOKEN_ENV]: credential },
      expected: INGEST_URL_ENV,
    },
    {
      label: "credential",
      environment: { [INGEST_URL_ENV]: endpoint },
      expected: INGEST_TOKEN_ENV,
    },
  ])("rejects a missing $label before reading or submitting", async ({ environment: missingEnvironment, expected }) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn();
    const readFileImplementation = vi.fn();

    const exitCode = await runCodexSessionCli({
      argv: ["complete", "--file", "/tmp/session.json"],
      environment: missingEnvironment,
      fetchImplementation,
      stdin: input(),
      stdout,
      stderr,
      readFileImplementation,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain(expected);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(readFileImplementation).not.toHaveBeenCalled();
    expect(stdout.text).toBe("");
  });

  it("sanitizes non-success responses without printing the credential or raw response", async () => {
    const rawSensitiveResponse = `Bearer ${credential} private_key=DO_NOT_PRINT upstream detail`;
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn(async () => new Response(rawSensitiveResponse, { status: 401 }));

    const exitCode = await runCodexSessionCli({
      argv: ["complete"],
      environment,
      fetchImplementation,
      stdin: input('{"schemaVersion":1,"session":{"externalSessionId":"auth-failure"}}'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toBe("Developer Dashboard ingestion authentication failed.\n");
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
    expect(`${stdout.text}${stderr.text}`).not.toContain(rawSensitiveResponse);
    expect(`${stdout.text}${stderr.text}`).not.toContain("private_key");
  });

  it("sanitizes network failures without printing thrown sensitive details", async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn(async () => {
      throw new Error(`Request with Bearer ${credential} failed`);
    });

    const exitCode = await runCodexSessionCli({
      argv: ["complete"],
      environment,
      fetchImplementation,
      stdin: input('{"schemaVersion":1,"session":{"externalSessionId":"network-failure"}}'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toBe("Could not reach the Developer Dashboard ingestion endpoint.\n");
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
    expect(`${stdout.text}${stderr.text}`).not.toContain("Bearer");
  });

  it("does not claim success for an invalid HTTP 200 response", async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, idempotent: false }),
      { status: 200 },
    ));

    const exitCode = await runCodexSessionCli({
      argv: ["complete"],
      environment,
      fetchImplementation,
      stdin: input('{"schemaVersion":1,"session":{"externalSessionId":"invalid-response"}}'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe("Developer Dashboard returned an invalid ingestion response.\n");
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
  });

  it("distinguishes an idempotency conflict without printing the response body", async () => {
    const stdout = sink();
    const stderr = sink();
    const rawSensitiveMessage = `conflict includes ${credential}`;
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: "idempotency_conflict", message: rawSensitiveMessage },
    }), { status: 409 }));

    const exitCode = await runCodexSessionCli({
      argv: ["complete"],
      environment,
      fetchImplementation,
      stdin: input('{"schemaVersion":1,"session":{"externalSessionId":"conflict"}}'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe(
      "Developer Dashboard rejected a conflicting retry for this external session ID.\n",
    );
    expect(`${stdout.text}${stderr.text}`).not.toContain(credential);
    expect(`${stdout.text}${stderr.text}`).not.toContain(rawSensitiveMessage);
  });

  it("rejects a success response for a different external session", async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn(async () => new Response(
      JSON.stringify(successResponse("different-session")),
      { status: 200 },
    ));

    const exitCode = await runCodexSessionCli({
      argv: ["complete"],
      environment,
      fetchImplementation,
      stdin: input('{"schemaVersion":1,"session":{"externalSessionId":"expected-session"}}'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe("Developer Dashboard returned an invalid ingestion response.\n");
  });

  it("never accepts or echoes a credential passed on the command line", async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImplementation = vi.fn();

    const exitCode = await runCodexSessionCli({
      argv: ["complete", "--token", credential],
      environment,
      fetchImplementation,
      stdin: input('{"schemaVersion":1}'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain(INGEST_TOKEN_ENV);
    expect(stderr.text).not.toContain(credential);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
