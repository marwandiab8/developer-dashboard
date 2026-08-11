import { createHash, timingSafeEqual } from "node:crypto";
import { CodexIngestionError } from "./types";

export type SecretValue = { value: () => string };

const configuredSecret = (secret: SecretValue): string | null => {
  try {
    const value = secret.value().trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export const requireCodexIngestionCredential = (
  authorization: string | string[] | undefined,
  secret: SecretValue,
): string => {
  const expected = configuredSecret(secret);
  if (!expected) throw new CodexIngestionError("configuration_unavailable", 503);
  if (typeof authorization !== "string") throw new CodexIngestionError("unauthenticated", 401);
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match || !timingSafeEqual(digest(match[1]), digest(expected))) {
    throw new CodexIngestionError("unauthenticated", 401);
  }
  return expected;
};

export const requireCodexOwnerUid = (secret: SecretValue): string => {
  const uid = configuredSecret(secret);
  if (!uid) throw new CodexIngestionError("configuration_unavailable", 503);
  return uid;
};
