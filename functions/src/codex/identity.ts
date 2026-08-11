import { createHash } from "node:crypto";

export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export const deterministicUuid = (material: string): string => {
  const hash = sha256(material).slice(0, 32);
  const versioned = `${hash.slice(0, 12)}5${hash.slice(13, 16)}`;
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const canonical = `${versioned}${variant}${hash.slice(17)}`;
  return `${canonical.slice(0, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}-${canonical.slice(16, 20)}-${canonical.slice(20)}`;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

export const payloadFingerprint = (value: unknown): string => sha256(JSON.stringify(canonicalize(value)));

export const identityMaterial = (projectId: string, externalSessionId: string): string =>
  `codex:v1:${projectId}:${externalSessionId}`;

export const entityId = (identity: string, kind: string): string => deterministicUuid(`${identity}:${kind}`);
