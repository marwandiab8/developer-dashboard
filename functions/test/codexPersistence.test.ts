import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { parseCodexSessionIngestV1 } from "../src/codex/contract";
import { payloadFingerprint } from "../src/codex/identity";
import { FirestoreCodexIngestionPersistence } from "../src/codex/persistence";
import type { CodexIngestionPersistenceInput } from "../src/codex/service";
import { CodexIngestionError, type CodexSessionIngestV1 } from "../src/codex/types";

type Stored = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const owner = "owner";
const projectOne = "33333333-3333-4333-8333-333333333333";
const projectTwo = "44444444-4444-4444-8444-444444444444";

const projectRecord = (githubId = "123", fullName = "owner/repo", changes: Stored = {}): Stored => ({
  title: "Project",
  purpose: "Manual purpose",
  status: "active",
  currentBranch: "manual-branch",
  currentObjective: "",
  currentBlocker: "",
  nextRecommendedTask: "",
  lastWorkedAt: "2026-08-10T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  externalSources: { github: { externalRepositoryId: githubId, repositoryFullName: fullName } },
  ...changes,
});

const rawPayload = (sessionChanges: Stored = {}, project: Stored = { dashboardProjectId: projectOne }) => ({
  schemaVersion: 1,
  project,
  session: {
    externalSessionId: "session-1",
    startedAt: "2026-08-11T10:00:00.000Z",
    endedAt: "2026-08-11T11:00:00.000Z",
    prompt: "  exact prompt\n\n",
    objective: "Codex objective",
    summary: "Summary",
    completed: ["Completed backend"],
    unfinished: ["Add helper"],
    problemsDiscovered: ["Problem"],
    decisionsMade: ["Decision"],
    filesModified: ["functions/src/codex/persistence.ts"],
    commits: ["abc123"],
    branch: "main",
    currentBlocker: "Waiting for deploy",
    nextRecommendedTask: "Deploy safely",
    ideas: [{ text: "Idea one", description: "Description", priority: "high" }, { text: "Idea two" }],
    ...sessionChanges,
  },
  source: "codex",
});

const asInput = (
  payload: CodexSessionIngestV1,
  receivedAt = "2026-08-11T11:01:00.000Z",
): CodexIngestionPersistenceInput => ({
  uid: owner,
  payload,
  fingerprint: payloadFingerprint({
    schemaVersion: payload.schemaVersion,
    source: payload.source,
    session: payload.session,
  }),
  receivedAt,
});

const valueAt = (value: Stored, path: string): unknown => {
  let cursor: unknown = value;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Stored)[part];
  }
  return cursor;
};

const setAt = (value: Stored, path: string, nested: unknown): void => {
  const parts = path.split(".");
  let cursor = value;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Stored;
  }
  cursor[parts.at(-1) as string] = clone(nested);
};

class FakeDocumentReference {
  readonly id: string;
  constructor(readonly path: string) { this.id = path.split("/").at(-1) ?? ""; }
}

class FakeQuery {
  constructor(
    readonly path: string,
    readonly constraints: Array<{ field: string; value: unknown }> = [],
    readonly maximum: number | null = null,
  ) {}
  where(field: string, operator: string, value: unknown) {
    assert.equal(operator, "==");
    return new FakeQuery(this.path, [...this.constraints, { field, value }], this.maximum);
  }
  limit(maximum: number) { return new FakeQuery(this.path, this.constraints, maximum); }
}

class FakeDocumentSnapshot {
  readonly id: string;
  constructor(readonly reference: FakeDocumentReference, private readonly stored: Stored | undefined) {
    this.id = reference.id;
  }
  get exists() { return this.stored !== undefined; }
  data() { return this.stored === undefined ? undefined : clone(this.stored); }
}

type PendingOperation = (documents: Map<string, Stored>) => void;

class FakeFirestore {
  documents = new Map<string, Stored>();
  failCommit = false;
  lastTransactionOptions: { readOnly?: boolean } | undefined;

  doc(path: string) { return new FakeDocumentReference(path); }
  collection(path: string) { return new FakeQuery(path); }

  private query(query: FakeQuery) {
    const prefix = `${query.path}/`;
    const docs = [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter(([, data]) => query.constraints.every(({ field, value }) => valueAt(data, field) === value))
      .slice(0, query.maximum ?? Number.POSITIVE_INFINITY)
      .map(([path, data]) => new FakeDocumentSnapshot(new FakeDocumentReference(path), data));
    return { docs };
  }

  async runTransaction<T>(callback: (transaction: {
    get(reference: FakeDocumentReference | FakeQuery): Promise<FakeDocumentSnapshot | { docs: FakeDocumentSnapshot[] }>;
    create(reference: FakeDocumentReference, data: Stored): void;
    set(reference: FakeDocumentReference, data: Stored, options?: { merge?: boolean }): void;
    update(reference: FakeDocumentReference, data: Stored): void;
  }) => Promise<T>, options?: { readOnly?: boolean }): Promise<T> {
    this.lastTransactionOptions = options;
    const operations: PendingOperation[] = [];
    const result = await callback({
      get: async (reference) => reference instanceof FakeQuery
        ? this.query(reference)
        : new FakeDocumentSnapshot(reference, this.documents.get(reference.path)),
      create: (reference, data) => operations.push((documents) => {
        if (documents.has(reference.path)) throw new Error("create precondition failed");
        documents.set(reference.path, clone(data));
      }),
      set: (reference, data, options) => operations.push((documents) => {
        if (!options?.merge) {
          documents.set(reference.path, clone(data));
          return;
        }
        const current = clone(documents.get(reference.path) ?? {});
        Object.entries(data).forEach(([key, nested]) => setAt(current, key, nested));
        documents.set(reference.path, current);
      }),
      update: (reference, data) => operations.push((documents) => {
        const current = documents.get(reference.path);
        if (!current) throw new Error("update precondition failed");
        Object.entries(data).forEach(([key, nested]) => setAt(current, key, nested));
      }),
    });
    if (this.failCommit) throw new Error("simulated atomic commit failure");
    const staged = new Map([...this.documents.entries()].map(([path, data]) => [path, clone(data)]));
    operations.forEach((operation) => operation(staged));
    this.documents = staged;
    return result;
  }
}

const persistenceFor = (database: FakeFirestore) =>
  new FirestoreCodexIngestionPersistence(database as unknown as Firestore);

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (error) => error instanceof CodexIngestionError && error.code === code);
};

test("read-only project verification reuses exact matching and performs zero writes", async () => {
  const database = new FakeFirestore();
  const projectPath = `users/${owner}/projects/${projectOne}`;
  database.documents.set(projectPath, projectRecord("123", "Owner/Repo", {
    title: "Developer Dashboard",
    purpose: "Must never appear in verification output",
    currentBlocker: "Private continuity must not appear",
  }));
  const before = clone([...database.documents.entries()]);
  const persistence = persistenceFor(database);

  const byFullName = await persistence.verifyProject(owner, { githubFullName: "owner/repo" });
  assert.deepEqual(byFullName, {
    ok: true,
    matched: true,
    status: "associated",
    dashboardProjectId: projectOne,
    dashboardProjectTitle: "Developer Dashboard",
    matchedBy: "githubFullName",
  });
  assert.deepEqual([...database.documents.entries()], before);
  assert.deepEqual(database.lastTransactionOptions, { readOnly: true });
  assert.equal(JSON.stringify(byFullName).includes("Private continuity"), false);
  assert.equal(JSON.stringify(byFullName).includes("Must never appear"), false);

  const byNumericId = await persistence.verifyProject(owner, { githubRepositoryId: 123 });
  assert.equal(byNumericId.matchedBy, "githubRepositoryId");
  const byStrongestId = await persistence.verifyProject(owner, {
    dashboardProjectId: projectOne,
    githubRepositoryId: 123,
    githubFullName: "OWNER/REPO",
  });
  assert.equal(byStrongestId.matchedBy, "dashboardId");
  assert.deepEqual([...database.documents.entries()], before);

  await expectCode(
    persistence.verifyProject(owner, { githubFullName: "owner/missing" }),
    "project_not_associated",
  );
  assert.deepEqual([...database.documents.entries()], before);

  await expectCode(
    persistence.verifyProject(owner, {
      dashboardProjectId: projectOne,
      githubRepositoryId: 999,
    }),
    "selector_mismatch",
  );
  await expectCode(
    persistence.verifyProject(owner, {
      githubRepositoryId: 123,
      githubFullName: "owner/missing",
    }),
    "selector_mismatch",
  );
  assert.deepEqual([...database.documents.entries()], before);

  database.documents.set(
    `users/${owner}/projects/${projectTwo}`,
    projectRecord("456", "OWNER/REPO", { title: "Duplicate identity" }),
  );
  const beforeAmbiguous = clone([...database.documents.entries()]);
  await expectCode(
    persistence.verifyProject(owner, { githubFullName: "owner/repo" }),
    "project_ambiguous",
  );
  assert.deepEqual([...database.documents.entries()], beforeAmbiguous);
});

test("atomically creates one complete Codex projection and recognizes an ambiguous-response retry", async () => {
  const database = new FakeFirestore();
  database.documents.set(`users/${owner}/projects/${projectOne}`, projectRecord());
  const persistence = persistenceFor(database);
  const parsed = parseCodexSessionIngestV1(rawPayload());
  const first = await persistence.ingest(asInput(parsed));
  assert.equal(first.idempotent, false);
  assert.equal(first.status, "created");
  assert.equal(first.ideaIds.length, 2);
  assert.equal(database.documents.get(`users/${owner}/sessions/${first.sessionId}`)?.source, "codex");
  assert.equal(database.documents.get(`users/${owner}/sessions/${first.sessionId}`)?.currentBlocker, "Waiting for deploy");
  assert.equal(database.documents.get(`users/${owner}/codexPrompts/${first.promptId}`)?.prompt, "  exact prompt\n\n");
  assert.equal(database.documents.get(`users/${owner}/activity/${first.activityId}`)?.type, "session_completed");
  assert.equal(database.documents.get(`users/${owner}/ideas/${first.ideaIds[0]}`)?.source, "Codex");
  const countAfterFirst = database.documents.size;
  const retry = await persistence.ingest(asInput(parsed));
  assert.equal(retry.idempotent, true);
  assert.equal(retry.status, "duplicate");
  assert.deepEqual({ ...retry, idempotent: false, status: "created" }, first);
  assert.equal(database.documents.size, countAfterFirst);
  assert.equal(database.documents.get(`users/${owner}/codexIngestion/minute-2026-08-11T11-01`)?.count, 1);

  const alternateSelector = parseCodexSessionIngestV1(rawPayload({}, { githubFullName: "OWNER/REPO" }));
  assert.equal((await persistence.ingest(asInput(alternateSelector))).idempotent, true);

  const changed = parseCodexSessionIngestV1(rawPayload({ summary: "Changed after retry" }));
  await expectCode(persistence.ingest(asInput(changed)), "idempotency_conflict");
  assert.equal(database.documents.size, countAfterFirst);
});

test("matches strongest identities, normalizes full names, and rejects unsafe association", async () => {
  const database = new FakeFirestore();
  database.documents.set(`users/${owner}/projects/${projectOne}`, projectRecord("123", "Owner/Repo"));
  database.documents.set(`users/${owner}/projects/${projectTwo}`, projectRecord("456", "owner/second"));
  const persistence = persistenceFor(database);

  const numeric = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "numeric" }, { githubRepositoryId: 123 }));
  assert.equal((await persistence.ingest(asInput(numeric))).projectId, projectOne);
  const fullName = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "full-name" }, { githubFullName: "OWNER/SECOND" }));
  assert.equal((await persistence.ingest(asInput(fullName))).projectId, projectTwo);

  const missing = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "missing" }, { dashboardProjectId: "55555555-5555-4555-8555-555555555555" }));
  await expectCode(persistence.ingest(asInput(missing)), "project_not_associated");
  const localOnly = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "local" }, { localPath: "/workspace/repo" }));
  await expectCode(persistence.ingest(asInput(localOnly)), "project_not_associated");
  const mismatch = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "mismatch" }, {
    dashboardProjectId: projectOne,
    githubRepositoryId: 456,
  }));
  await expectCode(persistence.ingest(asInput(mismatch)), "selector_mismatch");

  database.documents.set(
    `users/${owner}/projects/66666666-6666-4666-8666-666666666666`,
    projectRecord("123", "another/repo"),
  );
  const ambiguous = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "ambiguous" }, { githubRepositoryId: 123 }));
  await expectCode(persistence.ingest(asInput(ambiguous)), "project_ambiguous");
});

test("Codex continuity never overwrites manual values and omitted values never blank them", async () => {
  const database = new FakeFirestore();
  const path = `users/${owner}/projects/${projectOne}`;
  database.documents.set(path, projectRecord("123", "owner/repo", {
    currentObjective: "Manual objective",
    currentBlocker: "Manual blocker",
    nextRecommendedTask: "Manual next",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }));
  const persistence = persistenceFor(database);
  const first = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "manual-protection" }));
  await persistence.ingest(asInput(first));
  const after = database.documents.get(path);
  assert.equal(after?.currentObjective, "Manual objective");
  assert.equal(after?.currentBlocker, "Manual blocker");
  assert.equal(after?.nextRecommendedTask, "Manual next");
  assert.equal(after?.currentBranch, "manual-branch");
  assert.equal(after?.purpose, "Manual purpose");
  assert.equal(after?.updatedAt, "2026-08-12T00:00:00.000Z");
  assert.equal(after?.lastWorkedAt, "2026-08-11T11:00:00.000Z");

  const omitted = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "omitted-continuity",
    objective: undefined,
    currentBlocker: undefined,
    nextRecommendedTask: undefined,
  }));
  await persistence.ingest(asInput(omitted, "2026-08-11T11:02:00.000Z"));
  assert.equal(database.documents.get(path)?.currentBlocker, "Manual blocker");
});

test("Codex can advance and explicitly clear only its own unchanged continuity", async () => {
  const database = new FakeFirestore();
  const path = `users/${owner}/projects/${projectOne}`;
  database.documents.set(path, projectRecord());
  const persistence = persistenceFor(database);
  const first = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "continuity-one" }));
  await persistence.ingest(asInput(first));
  assert.equal(database.documents.get(path)?.currentObjective, "Codex objective");
  assert.equal(database.documents.get(path)?.currentBlocker, "Waiting for deploy");

  const second = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "continuity-two",
    endedAt: "2026-08-11T12:00:00.000Z",
    objective: "Next Codex objective",
    currentBlocker: null,
    nextRecommendedTask: "Next Codex task",
  }));
  await persistence.ingest(asInput(second, "2026-08-11T12:01:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "Next Codex objective");
  assert.equal(database.documents.get(path)?.currentBlocker, "");
  assert.equal(database.documents.get(path)?.nextRecommendedTask, "Next Codex task");

  const manuallyEdited = database.documents.get(path);
  assert.ok(manuallyEdited);
  manuallyEdited.currentObjective = "Manual edit after Codex";
  const third = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "continuity-three",
    endedAt: "2026-08-11T13:00:00.000Z",
    objective: "Must not overwrite",
  }));
  await persistence.ingest(asInput(third, "2026-08-11T13:01:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "Manual edit after Codex");
});

test("a manual clear or deletion breaks prior Codex continuity ownership", async () => {
  const database = new FakeFirestore();
  const path = `users/${owner}/projects/${projectOne}`;
  database.documents.set(path, projectRecord());
  const persistence = persistenceFor(database);
  const initial = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "before-manual-clear",
  }));
  await persistence.ingest(asInput(initial));

  const manuallyEdited = database.documents.get(path);
  assert.ok(manuallyEdited);
  manuallyEdited.currentObjective = "";
  manuallyEdited.currentBlocker = "";
  delete manuallyEdited.nextRecommendedTask;

  const afterClear = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "after-manual-clear",
    endedAt: "2026-08-11T12:00:00.000Z",
    objective: "Must not refill a manually cleared objective",
    currentBlocker: null,
    nextRecommendedTask: "Must not refill a manually deleted next step",
  }));
  await persistence.ingest(asInput(afterClear, "2026-08-11T12:01:00.000Z"));

  assert.equal(database.documents.get(path)?.currentObjective, "");
  assert.equal(database.documents.get(path)?.currentBlocker, "");
  assert.equal(database.documents.get(path)?.nextRecommendedTask, undefined);

  const later = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "after-manual-clear-later",
    endedAt: "2026-08-11T13:00:00.000Z",
    objective: "Still must not refill objective",
    currentBlocker: "Still must not refill blocker",
    nextRecommendedTask: "Still must not refill next step",
  }));
  await persistence.ingest(asInput(later, "2026-08-11T13:01:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "");
  assert.equal(database.documents.get(path)?.currentBlocker, "");
  assert.equal(database.documents.get(path)?.nextRecommendedTask, undefined);
});

test("an observed manual divergence cannot be reclaimed if its value later matches an old Codex hash", async () => {
  const database = new FakeFirestore();
  const path = `users/${owner}/projects/${projectOne}`;
  database.documents.set(path, projectRecord());
  const persistence = persistenceFor(database);
  const initial = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "codex-owned-a",
    endedAt: "2026-08-11T13:00:00.000Z",
    objective: "Codex value A",
  }));
  await persistence.ingest(asInput(initial, "2026-08-11T13:01:00.000Z"));

  const project = database.documents.get(path);
  assert.ok(project);
  project.currentObjective = "Manual value B";
  const observesManual = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "observe-manual-b",
    endedAt: "2026-08-11T12:00:00.000Z",
    objective: "Codex value C",
  }));
  await persistence.ingest(asInput(observesManual, "2026-08-11T12:01:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "Manual value B");

  const continuityPath = `users/${owner}/codexContinuity/${projectOne}`;
  assert.equal(
    valueAt(database.documents.get(continuityPath) ?? {}, "fields.currentObjective.source"),
    "manual",
  );

  const manuallyReverted = database.documents.get(path);
  assert.ok(manuallyReverted);
  manuallyReverted.currentObjective = "Codex value A";
  const later = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "after-manual-revert",
    endedAt: "2026-08-11T14:00:00.000Z",
    objective: "Must not reclaim manual value",
  }));
  await persistence.ingest(asInput(later, "2026-08-11T14:01:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "Codex value A");
});

test("an out-of-order older session cannot revert newer Codex continuity", async () => {
  const database = new FakeFirestore();
  const path = `users/${owner}/projects/${projectOne}`;
  database.documents.set(path, projectRecord());
  const persistence = persistenceFor(database);
  const newer = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "newer-continuity",
    endedAt: "2026-08-11T13:00:00.000Z",
    objective: "Newer objective",
    currentBlocker: "Newer blocker",
    nextRecommendedTask: "Newer next task",
  }));
  await persistence.ingest(asInput(newer, "2026-08-11T13:01:00.000Z"));

  const older = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "older-continuity",
    endedAt: "2026-08-11T12:00:00.000Z",
    objective: "Stale objective",
    currentBlocker: null,
    nextRecommendedTask: "Stale next task",
  }));
  await persistence.ingest(asInput(older, "2026-08-11T13:02:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "Newer objective");
  assert.equal(database.documents.get(path)?.currentBlocker, "Newer blocker");
  assert.equal(database.documents.get(path)?.nextRecommendedTask, "Newer next task");
  assert.equal(database.documents.get(path)?.lastWorkedAt, "2026-08-11T13:00:00.000Z");
});

test("a newer unchanged Codex value advances ownership time against delayed reports", async () => {
  const database = new FakeFirestore();
  const path = `users/${owner}/projects/${projectOne}`;
  database.documents.set(path, projectRecord());
  const persistence = persistenceFor(database);
  const initial = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "stable-initial",
    endedAt: "2026-08-11T10:00:00.000Z",
    objective: "Stable objective",
    currentBlocker: null,
  }));
  await persistence.ingest(asInput(initial, "2026-08-11T10:01:00.000Z"));
  const newerSame = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "stable-newer",
    endedAt: "2026-08-11T13:00:00.000Z",
    objective: "Stable objective",
    currentBlocker: null,
  }));
  await persistence.ingest(asInput(newerSame, "2026-08-11T13:01:00.000Z"));
  const delayed = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "stable-delayed",
    endedAt: "2026-08-11T12:00:00.000Z",
    objective: "Stale objective",
    currentBlocker: "Stale blocker",
  }));
  await persistence.ingest(asInput(delayed, "2026-08-11T13:02:00.000Z"));
  assert.equal(database.documents.get(path)?.currentObjective, "Stable objective");
  assert.equal(database.documents.get(path)?.currentBlocker, "");
});

test("a failed transaction leaves no partial logical state", async () => {
  const database = new FakeFirestore();
  const projectPath = `users/${owner}/projects/${projectOne}`;
  database.documents.set(projectPath, projectRecord());
  const before = clone([...database.documents.entries()]);
  database.failCommit = true;
  const persistence = persistenceFor(database);
  const parsed = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "atomic-failure" }));
  await assert.rejects(() => persistence.ingest(asInput(parsed)), /simulated atomic commit failure/);
  assert.deepEqual([...database.documents.entries()], before);
});

test("limits new sessions per minute while allowing a receipt-backed retry", async () => {
  const database = new FakeFirestore();
  database.documents.set(`users/${owner}/projects/${projectOne}`, projectRecord());
  const persistence = persistenceFor(database);
  let firstPayload: CodexSessionIngestV1 | null = null;
  for (let index = 0; index < 30; index += 1) {
    const parsed = parseCodexSessionIngestV1(rawPayload({
      externalSessionId: `rate-${index}`,
      ideas: [],
    }));
    if (index === 0) firstPayload = parsed;
    await persistence.ingest(asInput(parsed));
  }
  assert.ok(firstPayload);
  assert.equal((await persistence.ingest(asInput(firstPayload))).idempotent, true);
  const blocked = parseCodexSessionIngestV1(rawPayload({ externalSessionId: "rate-blocked", ideas: [] }));
  await expectCode(persistence.ingest(asInput(blocked)), "rate_limited");
  assert.equal(database.documents.get(`users/${owner}/codexIngestion/minute-2026-08-11T11-01`)?.count, 30);
});

test("out-of-order requests cannot roll back a newer minute's throttle bucket", async () => {
  const database = new FakeFirestore();
  database.documents.set(`users/${owner}/projects/${projectOne}`, projectRecord());
  const persistence = persistenceFor(database);

  const nextMinute = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "next-minute-first",
    ideas: [],
  }));
  await persistence.ingest(asInput(nextMinute, "2026-08-11T11:02:00.000Z"));

  const priorMinute = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "prior-minute-late",
    ideas: [],
  }));
  await persistence.ingest(asInput(priorMinute, "2026-08-11T11:01:59.999Z"));

  const nextPath = `users/${owner}/codexIngestion/minute-2026-08-11T11-02`;
  const priorPath = `users/${owner}/codexIngestion/minute-2026-08-11T11-01`;
  assert.equal(database.documents.get(nextPath)?.count, 1);
  assert.equal(database.documents.get(priorPath)?.count, 1);

  for (let index = 0; index < 29; index += 1) {
    const payload = parseCodexSessionIngestV1(rawPayload({
      externalSessionId: `next-minute-${index}`,
      ideas: [],
    }));
    await persistence.ingest(asInput(payload, "2026-08-11T11:02:30.000Z"));
  }
  const blocked = parseCodexSessionIngestV1(rawPayload({
    externalSessionId: "next-minute-blocked",
    ideas: [],
  }));
  await expectCode(
    persistence.ingest(asInput(blocked, "2026-08-11T11:02:59.000Z")),
    "rate_limited",
  );
  assert.equal(database.documents.get(nextPath)?.count, 30);
  assert.equal(database.documents.get(priorPath)?.count, 1);
});
