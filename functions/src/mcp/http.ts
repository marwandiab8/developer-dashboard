import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DashboardMcpPersistencePort } from "./persistence";
import {
  McpAuthorizationError,
  parseMcpOAuthConfig,
  protectedResourceMetadata,
  verifyMcpAccessToken,
  type McpOAuthConfig,
  type McpTokenVerifier,
} from "./auth";
import { DashboardMcpToolService, createDashboardMcpServer } from "./tools";

export type ConfigValue = { value: () => string };

type McpHttpRequest = {
  method?: string;
  path?: string;
  originalUrl?: string;
  url?: string;
  headers: { authorization?: string | string[] };
  body?: unknown;
};

type McpHttpResponse = {
  headersSent?: boolean;
  setHeader(name: string, value: string): unknown;
  status(code: number): McpHttpResponse;
  json(body: unknown): unknown;
  send?(body: unknown): unknown;
  end?(body?: unknown): unknown;
};

const readConfig = (values: {
  issuer: ConfigValue;
  audience: ConfigValue;
  jwksUri: ConfigValue;
  ownerSubject: ConfigValue;
  resourceUrl: ConfigValue;
}): McpOAuthConfig => parseMcpOAuthConfig({
  issuer: values.issuer.value(),
  audience: values.audience.value(),
  jwksUri: values.jwksUri.value(),
  ownerSubject: values.ownerSubject.value(),
  resourceUrl: values.resourceUrl.value(),
});

const requestPath = (request: McpHttpRequest) => {
  const value = request.path ?? request.originalUrl ?? request.url ?? "/";
  try { return new URL(value, "https://dashboard.invalid").pathname.replace(/\/$/, "") || "/"; }
  catch { return "/"; }
};

export const createDashboardMcpHttpHandler = (options: {
  persistence: DashboardMcpPersistencePort;
  ownerUid: ConfigValue;
  issuer: ConfigValue;
  audience: ConfigValue;
  jwksUri: ConfigValue;
  ownerSubject: ConfigValue;
  resourceUrl: ConfigValue;
  verifyToken?: McpTokenVerifier;
}) => async (request: McpHttpRequest, response: McpHttpResponse): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  let config: McpOAuthConfig;
  try {
    config = readConfig(options);
  } catch (error) {
    const status = error instanceof McpAuthorizationError ? error.status : 503;
    response.status(status).json({ error: "configuration_unavailable" });
    return;
  }
  const path = requestPath(request);
  if (request.method === "GET" && path.endsWith("/.well-known/oauth-protected-resource")) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.status(200).json(protectedResourceMetadata(config));
    return;
  }
  if (request.method === "GET" && path.endsWith("/docs")) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.status(200).json({ name: "Developer Dashboard MCP", authorization: "OAuth 2.1", scopes: ["dashboard:read", "dashboard:write"] });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    return;
  }
  try {
    const principal = await (options.verifyToken ?? verifyMcpAccessToken)(request.headers.authorization, config);
    const uid = options.ownerUid.value().trim();
    if (!uid) throw new McpAuthorizationError("configuration_unavailable", 503);
    const server = createDashboardMcpServer(new DashboardMcpToolService(
      uid,
      principal,
      options.persistence,
      [uid, config.ownerSubject],
    ), config.resourceUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(request as never, response as never, request.body);
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (error) {
    if (response.headersSent) return;
    if (error instanceof McpAuthorizationError) {
      const metadataUrl = `${config.resourceUrl}/.well-known/oauth-protected-resource`;
      response.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}", scope="dashboard:read dashboard:write"`);
      response.status(error.status).json({ jsonrpc: "2.0", error: { code: -32001, message: error.message }, id: null });
      return;
    }
    response.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal MCP error." }, id: null });
  }
};
