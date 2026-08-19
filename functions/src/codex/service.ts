import { parseCodexProjectVerificationV1, parseCodexSessionIngestV1 } from "./contract";
import { payloadFingerprint } from "./identity";
import {
  CodexIngestionError,
  type CodexIngestionResult,
  type CodexProjectSelectorV1,
  type CodexProjectVerificationResult,
  type CodexSessionIngestV1,
} from "./types";

export type CodexIngestionPersistenceInput = {
  uid: string;
  payload: CodexSessionIngestV1;
  fingerprint: string;
  receivedAt: string;
};

export interface CodexIngestionPersistencePort {
  ingest(input: CodexIngestionPersistenceInput): Promise<CodexIngestionResult>;
  verifyProject(uid: string, selector: CodexProjectSelectorV1): Promise<CodexProjectVerificationResult>;
}

export class CodexIngestionService {
  private readonly now: () => Date;

  constructor(
    private readonly persistence: CodexIngestionPersistencePort,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async ingest(uid: string, raw: unknown): Promise<CodexIngestionResult> {
    const payload = parseCodexSessionIngestV1(raw);
    const receivedAt = this.now();
    if (Date.parse(payload.session.endedAt) > receivedAt.getTime() + 10 * 60 * 1000) {
      throw new CodexIngestionError("invalid_request", 400);
    }
    return this.persistence.ingest({
      uid,
      payload,
      // Project identity is represented by the receipt path after resolution.
      // Excluding selector syntax makes a retry safe if it identifies the same
      // project by another exact supported selector.
      fingerprint: payloadFingerprint({
        schemaVersion: payload.schemaVersion,
        source: payload.source,
        session: payload.session,
        workflow: payload.workflow,
      }),
      receivedAt: receivedAt.toISOString(),
    });
  }

  async verifyProject(uid: string, raw: unknown): Promise<CodexProjectVerificationResult> {
    const request = parseCodexProjectVerificationV1(raw);
    return this.persistence.verifyProject(uid, request.project);
  }
}
