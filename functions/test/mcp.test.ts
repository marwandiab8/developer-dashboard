import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Firestore } from "firebase-admin/firestore";
import type { JWTPayload } from "jose";
import {
  McpAuthorizationError,
  authorizeVerifiedClaims,
  parseMcpOAuthConfig,
} from "../src/mcp/auth";
import { validateMcpToolInput } from "../src/mcp/contract";
import { createDashboardMcpHttpHandler } from "../src/mcp/http";
import {
  FirestoreDashboardMcpPersistence,
  McpToolError,
  type DashboardMcpPersistencePort,
} from "../src/mcp/persistence";
import {
  createDashboardMcpServer,
  DashboardMcpToolService,
  listDashboardMcpToolDefinitions,
} from "../src/mcp/tools";

const projectId = "33333333-3333-4333-8333-333333333333";
const otherProjectId = "44444444-4444-4444-8444-444444444444";
const ideaId = "55555555-5555-4555-8555-555555555555";

const claims = (changes: JWTPayload = {}): JWTPayload => ({
  sub: "owner-subject",
  scope: "dashboard:read dashboard:write",
  ...changes,
});

test("OAuth claim authorization restricts the configured owner and scopes", () => {
  const principal = authorizeVerifiedClaims(claims(), "owner-subject");
  assert.equal(principal.subject, "owner-subject");
  assert.equal(principal.scopes.has("dashboard:write"), true);
  assert.throws(
    () => authorizeVerifiedClaims(claims({ sub: "someone-else" }), "owner-subject"),
    (error) => error instanceof McpAuthorizationError && error.status === 403,
  );
  assert.throws(
    () => authorizeVerifiedClaims(claims({ scope: "profile" }), "owner-subject"),
    (error) => error instanceof McpAuthorizationError && error.status === 403,
  );
});

test("MCP input validation enforces exact IDs bounds confirmation and secret rejection", () => {
  assert.deepEqual(validateMcpToolInput("get_task", { projectId, taskId: otherProjectId }), {
    projectId,
    taskId: otherProjectId,
  });
  assert.throws(() => validateMcpToolInput("get_task", { projectId, taskId: "title lookup" }), /invalid_tool_input/);
  assert.throws(() => validateMcpToolInput("mark_task_completed", {
    projectId,
    taskId: otherProjectId,
    confirmed: false,
    idempotencyKey: "completion-123",
  }), /invalid_tool_input/);
  assert.throws(() => validateMcpToolInput("create_task_prompt_record", {
    projectId,
    taskId: otherProjectId,
    promptSummary: "Use github_pat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    requestedChange: "Change it",
    idempotencyKey: "prompt-12345",
  }));
  assert.throws(() => validateMcpToolInput("create_idea", {
    projectId,
    title: "Copy owner-uid-secret into the idea",
    description: "",
    priority: "medium",
    tags: [],
    source: "ChatGPT",
    idempotencyKey: "configured-secret-123",
  }, ["owner-uid-secret"]));
});

test("tool service enforces read and write scopes before persistence", async () => {
  const calls: string[] = [];
  const persistence: DashboardMcpPersistencePort = {
    async call(_uid, name) { calls.push(name); return { ok: true }; },
  };
  const readOnly = new DashboardMcpToolService(
    "owner-uid",
    { subject: "owner-subject", scopes: new Set(["dashboard:read"]), tokenId: null },
    persistence,
  );
  await readOnly.call("get_project", { projectId });
  await assert.rejects(
    () => readOnly.call("create_idea", {
      projectId,
      title: "Idea",
      description: "",
      priority: "medium",
      tags: [],
      source: "ChatGPT",
      idempotencyKey: "idea-create-123",
    }),
    (error) => error instanceof McpAuthorizationError && error.status === 403,
  );
  assert.deepEqual(calls, ["get_project"]);
});

test("tool discovery publishes current ChatGPT OAuth metadata per tool", () => {
  const definitions = listDashboardMcpToolDefinitions();
  const read = definitions.find((definition) => definition.name === "list_projects");
  const write = definitions.find((definition) => definition.name === "create_idea");
  assert.deepEqual(read?.securitySchemes, [{ type: "oauth2", scopes: ["dashboard:read"] }]);
  assert.deepEqual(write?.securitySchemes, [{ type: "oauth2", scopes: ["dashboard:write"] }]);
  assert.deepEqual(read?._meta?.securitySchemes, read?.securitySchemes);
  assert.equal(read?.annotations?.readOnlyHint, true);
  assert.equal(write?.annotations?.readOnlyHint, false);
});

test("insufficient tool scope returns the MCP reauthorization challenge", async () => {
  const persistence: DashboardMcpPersistencePort = {
    async call() { throw new Error("persistence must not run"); },
  };
  const service = new DashboardMcpToolService(
    "owner-uid",
    { subject: "owner-subject", scopes: new Set(["dashboard:read"]), tokenId: null },
    persistence,
  );
  const server = createDashboardMcpServer(service, "https://dashboard.example.com/mcp");
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "create_idea", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(
      String(result._meta?.["mcp/www_authenticate"]),
      /resource_metadata="https:\/\/dashboard\.example\.com\/mcp\/\.well-known\/oauth-protected-resource"/,
    );
    assert.match(String(result._meta?.["mcp/www_authenticate"]), /scope="dashboard:write"/);
  } finally {
    await client.close();
    await server.close();
  }
});

type Stored = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);

class FakeReference {
  readonly id: string;
  constructor(readonly path: string) { this.id = path.split("/").at(-1) ?? ""; }
  async get() { return fakeSnapshot(this, fakeDatabase.documents.get(this.path)); }
}

const fakeSnapshot = (ref: FakeReference, data: Stored | undefined) => ({
  id: ref.id,
  ref,
  exists: data !== undefined,
  data: () => data === undefined ? undefined : clone(data),
});

let fakeDatabase: FakeFirestore;
class FakeFirestore {
  documents = new Map<string, Stored>();
  doc(path: string) { return new FakeReference(path); }
  async runTransaction<T>(callback: (transaction: {
    get(reference: FakeReference): Promise<ReturnType<typeof fakeSnapshot>>;
    create(reference: FakeReference, data: Stored): void;
    update(reference: FakeReference, data: Stored): void;
  }) => Promise<T>): Promise<T> {
    const operations: Array<(documents: Map<string, Stored>) => void> = [];
    const result = await callback({
      get: async (reference) => fakeSnapshot(reference, this.documents.get(reference.path)),
      create: (reference, data) => operations.push((documents) => {
        if (documents.has(reference.path)) throw new Error("create conflict");
        documents.set(reference.path, clone(data));
      }),
      update: (reference, data) => operations.push((documents) => {
        const current = documents.get(reference.path);
        if (!current) throw new Error("missing update");
        documents.set(reference.path, { ...current, ...clone(data) });
      }),
    });
    const staged = new Map([...this.documents.entries()].map(([path, data]) => [path, clone(data)]));
    operations.forEach((operation) => operation(staged));
    this.documents = staged;
    return result;
  }
}

test("MCP writes stay owner-scoped, audit every change, and deduplicate retries", async () => {
  fakeDatabase = new FakeFirestore();
  fakeDatabase.documents.set(`users/other-uid/projects/${projectId}`, { title: "Private other project" });
  const persistence = new FirestoreDashboardMcpPersistence(
    fakeDatabase as unknown as Firestore,
    () => new Date("2026-08-19T12:00:00.000Z"),
  );
  const input = validateMcpToolInput("create_idea", {
    projectId,
    title: "Owner-scoped idea",
    description: "",
    priority: "medium",
    tags: [],
    source: "ChatGPT",
    idempotencyKey: "owner-idea-123",
  });
  await assert.rejects(
    () => persistence.call("owner-uid", "create_idea", input),
    (error) => error instanceof McpToolError && error.code === "not_found",
  );
  assert.equal([...fakeDatabase.documents.keys()].some((path) => path.includes("mcpAuditEvents")), false);

  fakeDatabase.documents.set(`users/owner-uid/projects/${projectId}`, { title: "Owner project" });
  const first = await persistence.call("owner-uid", "create_idea", input);
  const second = await persistence.call("owner-uid", "create_idea", input);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.ideaId, second.ideaId);
  assert.equal([...fakeDatabase.documents.keys()].filter((path) => path.includes("/ideas/")).length, 1);
  assert.equal([...fakeDatabase.documents.keys()].filter((path) => path.includes("/mcpAuditEvents/")).length, 1);
  assert.equal([...fakeDatabase.documents.keys()].filter((path) => path.includes("/mcpIdempotencyReceipts/")).length, 1);
});

test("MCP conversion rejects a cross-project idea before any audit or task write", async () => {
  fakeDatabase = new FakeFirestore();
  fakeDatabase.documents.set(`users/owner-uid/projects/${projectId}`, { title: "Owner project" });
  fakeDatabase.documents.set(`users/owner-uid/ideas/${ideaId}`, { projectId: otherProjectId, text: "Other project idea" });
  const before = clone([...fakeDatabase.documents.entries()]);
  const persistence = new FirestoreDashboardMcpPersistence(fakeDatabase as unknown as Firestore);
  const input = validateMcpToolInput("convert_idea_to_task", {
    projectId,
    ideaId,
    acceptanceCriteria: "Works",
    confirmed: true,
    idempotencyKey: "convert-idea-123",
  });
  await assert.rejects(
    () => persistence.call("owner-uid", "convert_idea_to_task", input),
    (error) => error instanceof McpToolError && error.code === "relationship_mismatch",
  );
  assert.deepEqual([...fakeDatabase.documents.entries()], before);
});

test("protected resource metadata is public but MCP requests require OAuth", async () => {
  const values = {
    issuer: { value: () => "https://auth.example.com" },
    audience: { value: () => "developer-dashboard" },
    jwksUri: { value: () => "https://auth.example.com/.well-known/jwks.json" },
    ownerSubject: { value: () => "owner-subject" },
    resourceUrl: { value: () => "https://dashboard.example.com/mcp" },
    ownerUid: { value: () => "owner-uid" },
  };
  const response = () => {
    const headers = new Map<string, string>();
    const state: { status: number; body: unknown } = { status: 0, body: null };
    return {
      headers,
      state,
      api: {
        setHeader(name: string, value: string) { headers.set(name, value); },
        status(code: number) { state.status = code; return this; },
        json(body: unknown) { state.body = body; },
      },
    };
  };
  const handler = createDashboardMcpHttpHandler({
    ...values,
    persistence: { async call() { return {}; } },
    verifyToken: async () => { throw new McpAuthorizationError("unauthenticated", 401); },
  });
  const metadata = response();
  await handler({ method: "GET", path: "/.well-known/oauth-protected-resource", headers: {} }, metadata.api);
  assert.equal(metadata.state.status, 200);
  assert.equal((metadata.state.body as Stored).resource, "https://dashboard.example.com/mcp");
  const denied = response();
  await handler({ method: "POST", path: "/", headers: {}, body: {} }, denied.api);
  assert.equal(denied.state.status, 401);
  assert.match(denied.headers.get("WWW-Authenticate") ?? "", /resource_metadata=/);
  const parsed = parseMcpOAuthConfig({ issuer: values.issuer.value(), audience: values.audience.value(), jwksUri: values.jwksUri.value(), ownerSubject: values.ownerSubject.value(), resourceUrl: values.resourceUrl.value() });
  assert.equal(parsed.issuer, "https://auth.example.com/");
  assert.equal(parsed.resourceUrl, "https://dashboard.example.com/mcp");
});
