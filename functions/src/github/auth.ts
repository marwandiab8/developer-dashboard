import { HttpsError } from "firebase-functions/v2/https";
import { GithubApiError } from "./types";

export type SecretValue = { value: () => string };
export type RequestAuth = { uid?: string } | null | undefined;

const readSecret = (secret: SecretValue): string | null => {
  try {
    const value = secret.value().trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

export const requireDashboardOwner = (auth: RequestAuth, ownerUidSecret: SecretValue): string => {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const ownerUid = readSecret(ownerUidSecret);
  if (!ownerUid) {
    throw new HttpsError("failed-precondition", "Dashboard owner configuration is unavailable.");
  }

  if (auth.uid !== ownerUid) {
    throw new HttpsError("permission-denied", "This operation is restricted to the dashboard owner.");
  }

  return ownerUid;
};

export const readOptionalGithubCredential = (credential: SecretValue): string | null => readSecret(credential);

export const requireGithubCredential = (credential: SecretValue): string => {
  const value = readSecret(credential);
  if (!value) {
    throw new HttpsError("failed-precondition", "GitHub connection is not configured.");
  }
  return value;
};

export const redactSensitiveText = (value: unknown, secrets: string[] = []): string => {
  let text = value instanceof Error ? value.message : String(value ?? "Unknown error");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/\b(?:github_pat_|gh[pousr]_|Bearer\s+)[A-Za-z0-9_\-.]+/gi, "[REDACTED]")
    .replace(/([?&](?:access_?token|token)=)[^&\s]+/gi, "$1[REDACTED]");
};

export const safeErrorCode = (error: unknown): string => {
  if (error instanceof GithubApiError) return `github_${error.safeCode}`;
  if (error instanceof HttpsError) return error.code;
  return "internal";
};

export const toSafeHttpsError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (error instanceof GithubApiError) {
    if (error.safeCode === "rate_limited") {
      return new HttpsError("resource-exhausted", "GitHub rate limit reached.", {
        resetAt: error.rateLimit?.resetAt ?? null,
        rateLimit: error.rateLimit,
      });
    }
    if (error.safeCode === "authorization") {
      return new HttpsError("permission-denied", "GitHub authorization failed.");
    }
    if (error.safeCode === "unavailable") {
      return new HttpsError("unavailable", "GitHub is temporarily unavailable.");
    }
  }
  return new HttpsError("internal", "GitHub synchronization failed safely.");
};
