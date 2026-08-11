import { requireCodexIngestionCredential, requireCodexOwnerUid, type SecretValue } from "./auth";
import { assertPayloadExcludesConfiguredValues } from "./contract";
import type { CodexIngestionService } from "./service";
import { CODEX_INGESTION_MAX_BYTES, CodexIngestionError, type CodexIngestionErrorCode } from "./types";

export type CodexHttpRequest = {
  method?: string;
  headers: { authorization?: string | string[]; "content-type"?: string | string[] };
  body?: unknown;
  rawBody?: Buffer;
};

export type CodexHttpResponse = {
  setHeader(name: string, value: string): unknown;
  status(code: number): CodexHttpResponse;
  json(body: unknown): unknown;
};

type SafeLogger = {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
};

const silentLogger: SafeLogger = { info: () => undefined, warn: () => undefined };

const safeFailure = (error: unknown): { status: number; code: CodexIngestionErrorCode; message: string } => {
  if (error instanceof CodexIngestionError) {
    return { status: error.httpStatus, code: error.code, message: error.message };
  }
  const fallback = new CodexIngestionError("internal", 500);
  return { status: fallback.httpStatus, code: fallback.code, message: fallback.message };
};

export const createCodexIngestionHttpHandler = (options: {
  service: Pick<CodexIngestionService, "ingest">;
  ingestionSecret: SecretValue;
  ownerUidSecret: SecretValue;
  logger?: SafeLogger;
}) => {
  const logger = options.logger ?? silentLogger;
  return async (request: CodexHttpRequest, response: CodexHttpResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      const error = new CodexIngestionError("method_not_allowed", 405);
      response.status(error.httpStatus).json({ ok: false, error: { code: error.code, message: error.message } });
      return;
    }

    try {
      const ingestionCredential = requireCodexIngestionCredential(
        request.headers.authorization,
        options.ingestionSecret,
      );
      const uid = requireCodexOwnerUid(options.ownerUidSecret);
      const contentType = request.headers["content-type"];
      if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
        throw new CodexIngestionError("invalid_request", 400);
      }
      if (request.rawBody && request.rawBody.byteLength > CODEX_INGESTION_MAX_BYTES) {
        throw new CodexIngestionError("invalid_request", 400);
      }
      assertPayloadExcludesConfiguredValues(request.body, [ingestionCredential, uid]);
      const result = await options.service.ingest(uid, request.body);
      logger.info("Codex session ingestion completed.", {
        outcome: result.status,
        ideaCount: result.ideaIds.length,
      });
      response.status(200).json(result);
    } catch (error) {
      const safe = safeFailure(error);
      logger.warn("Codex session ingestion rejected.", { errorCode: safe.code });
      response.status(safe.status).json({
        ok: false,
        error: { code: safe.code, message: safe.message },
      });
    }
  };
};
