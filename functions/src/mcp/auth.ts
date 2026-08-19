import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type McpScope = "dashboard:read" | "dashboard:write";

export type McpPrincipal = {
  subject: string;
  scopes: Set<string>;
  tokenId: string | null;
};

export type McpOAuthConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
  ownerSubject: string;
  resourceUrl: string;
};

export class McpAuthorizationError extends Error {
  constructor(
    readonly code: "unauthenticated" | "permission_denied" | "configuration_unavailable",
    readonly status: 401 | 403 | 503,
  ) {
    super(code === "permission_denied" ? "MCP authorization was denied." : code === "configuration_unavailable" ? "MCP authorization is not configured." : "MCP authentication failed.");
    this.name = "McpAuthorizationError";
  }
}

const configuredUrl = (value: string, preserveTrailingSlash = false): string => {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") throw new Error("not https");
    const canonical = url.toString();
    return preserveTrailingSlash ? canonical : canonical.replace(/\/$/, "");
  } catch {
    throw new McpAuthorizationError("configuration_unavailable", 503);
  }
};

export const parseMcpOAuthConfig = (raw: Record<keyof McpOAuthConfig, string>): McpOAuthConfig => {
  const audience = raw.audience.trim();
  const ownerSubject = raw.ownerSubject.trim();
  if (!audience || !ownerSubject) {
    throw new McpAuthorizationError("configuration_unavailable", 503);
  }
  return {
    issuer: configuredUrl(raw.issuer, true),
    audience,
    jwksUri: configuredUrl(raw.jwksUri),
    ownerSubject,
    resourceUrl: configuredUrl(raw.resourceUrl),
  };
};

const scopesFromPayload = (payload: JWTPayload): Set<string> => {
  const raw = typeof payload.scope === "string"
    ? payload.scope.split(/\s+/)
    : Array.isArray(payload.scp)
      ? payload.scp.filter((value): value is string => typeof value === "string")
      : [];
  return new Set(raw.filter(Boolean));
};

export const authorizeVerifiedClaims = (
  payload: JWTPayload,
  ownerSubject: string,
): McpPrincipal => {
  if (!payload.sub || payload.sub !== ownerSubject) {
    throw new McpAuthorizationError("permission_denied", 403);
  }
  const scopes = scopesFromPayload(payload);
  if (!scopes.has("dashboard:read") && !scopes.has("dashboard:write")) {
    throw new McpAuthorizationError("permission_denied", 403);
  }
  return {
    subject: payload.sub,
    scopes,
    tokenId: typeof payload.jti === "string" ? payload.jti : null,
  };
};

export const requireMcpScope = (principal: McpPrincipal, scope: McpScope): void => {
  if (!principal.scopes.has(scope)) {
    throw new McpAuthorizationError("permission_denied", 403);
  }
};

export type McpTokenVerifier = (
  authorization: string | string[] | undefined,
  config: McpOAuthConfig,
) => Promise<McpPrincipal>;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const verifyMcpAccessToken: McpTokenVerifier = async (authorization, config) => {
  if (typeof authorization !== "string") {
    throw new McpAuthorizationError("unauthenticated", 401);
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match) throw new McpAuthorizationError("unauthenticated", 401);
  let jwks = jwksCache.get(config.jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(config.jwksUri));
    jwksCache.set(config.jwksUri, jwks);
  }
  try {
    const verified = await jwtVerify(match[1], jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256", "ES256"],
    });
    return authorizeVerifiedClaims(verified.payload, config.ownerSubject);
  } catch (error) {
    if (error instanceof McpAuthorizationError) throw error;
    throw new McpAuthorizationError("unauthenticated", 401);
  }
};

export const protectedResourceMetadata = (config: McpOAuthConfig) => ({
  resource: config.resourceUrl,
  authorization_servers: [config.issuer],
  scopes_supported: ["dashboard:read", "dashboard:write"],
  bearer_methods_supported: ["header"],
  resource_documentation: `${config.resourceUrl}/docs`,
});
