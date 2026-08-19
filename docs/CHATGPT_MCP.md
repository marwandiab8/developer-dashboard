# ChatGPT remote MCP connection

Status: the OAuth-protected MCP resource server, bounded tools, validation, authorization, idempotency, audit persistence, rules, and local tests are implemented. ChatGPT is **not connected** until the server is deployed under explicit approval, an OAuth provider/client is configured, and a real authenticated tool call succeeds.

The implementation follows OpenAI's current remote MCP guidance: a remote server using Streamable HTTP, OAuth authorization for private data, protected-resource discovery, and authorization checks on each request. See the official [MCP server concept](https://developers.openai.com/plugins/concepts/mcp-server), [authentication guide](https://developers.openai.com/plugins/build/auth), and [server guide](https://developers.openai.com/plugins/build/mcp-server).

The production tool list advertises an OAuth `securitySchemes` entry on every tool (and mirrors it in `_meta` for compatible clients). Scope failures return `_meta["mcp/www_authenticate"]`; unauthenticated HTTP requests return `401` with `WWW-Authenticate`. Both challenges point to the protected-resource metadata document.

## Architecture

`dashboardMcp` is a Firebase HTTPS Function and OAuth 2.1 resource server. It does not issue tokens and is not an identity provider. Use an established OAuth/OIDC authorization server that supports authorization-code flow with PKCE, resource/audience-bound JWT access tokens, a public JWKS endpoint, and client registration suitable for ChatGPT.

For every MCP POST request the Function:

1. Reads its server-side OAuth and owner configuration.
2. Verifies the bearer JWT signature against the configured JWKS.
3. Verifies issuer, audience, expiry, algorithm, and the exact authorized owner subject.
4. Requires `dashboard:read` or `dashboard:write` for the selected tool.
5. Validates a strict bounded Zod input and rejects credential-shaped content.
6. Derives the Firestore UID from server configuration, never from caller input.
7. Verifies every project/task/idea/prompt/session relationship before access.
8. Returns a bounded structured result.

Write tools run in a Firestore transaction. The transaction performs the requested mutation, creates a backend-only `mcpAuditEvents` record, and creates a backend-only `mcpIdempotencyReceipts` record. Reusing a key with identical input returns the stored result; reusing it with changed input fails.

## Tool contracts

Read tools require `dashboard:read`:

- `list_projects({ limit })`
- `get_project({ projectId })`
- `list_project_ideas({ projectId, status?, limit })`
- `list_task_queue({ projectId?, priority?, status?, workedSince?, limit })`
- `get_task({ projectId, taskId })`
- `get_task_context({ projectId, taskId })`
- `get_project_timeline({ projectId, limit })`
- `get_task_timeline({ projectId, taskId, limit })`
- `get_project_resume({ projectId })`
- `get_ai_context({ projectId })`
- `get_task_time_summary({ projectId, taskId })`

Write tools require `dashboard:write` and an `idempotencyKey`:

- `create_idea`
- `update_idea`
- `convert_idea_to_task` (`confirmed: true`)
- `update_task_status` (confirmation required for closing states; blocker required for Blocked)
- `create_task_prompt_record`
- `start_task_work_session`
- `finish_task_work_session`
- `append_task_work_summary`
- `record_task_blocker` (`confirmed: true`)
- `mark_task_completed` (`confirmed: true`)

IDs are UUIDs. Exact project/task IDs are mandatory for task reads and writes; titles are never fuzzy-matched. Payload and list sizes are bounded in `functions/src/mcp/contract.ts`. There is no arbitrary Firestore query, repository-edit, command-execution, secret-read, or deployment tool.

## Required configuration names

Values must be configured only through approved server-side Firebase parameter/secret mechanisms. Do not put values in source, documentation, prompts, Firestore, browser storage, URLs, command arguments, or `NEXT_PUBLIC_*` variables.

- `DASHBOARD_OWNER_UID`
- `MCP_OWNER_SUBJECT`
- `MCP_OAUTH_ISSUER`
- `MCP_OAUTH_AUDIENCE`
- `MCP_OAUTH_JWKS_URI`
- `MCP_RESOURCE_URL`

`DASHBOARD_OWNER_UID` and `MCP_OWNER_SUBJECT` are Function secrets. The OAuth URLs/audience are non-secret Function parameters, but still must be reviewed and set deliberately.

## Connection procedure

These steps require explicit deployment/configuration approval:

1. Choose and configure an OAuth/OIDC authorization server. Restrict account enrollment and consent to Marwan's authorized identity.
2. Register the Dashboard MCP resource/audience and the `dashboard:read` and `dashboard:write` scopes.
3. Enable OAuth authorization-code flow with PKCE `S256`, `resource` audience binding, issuer identification, and CIMD or DCR. When issuer identification is enabled correctly, ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect`; otherwise use the callback-specific URL shown in the ChatGPT app-management page.
4. Configure the six names above without displaying their values.
5. Deploy only `dashboardMcp` and the reviewed Firestore rules after approval.
6. In ChatGPT, open **Settings → Security and login**, enable Developer mode, open **ChatGPT Plugins**, add the HTTPS MCP endpoint, review the discovered tools, and complete the OAuth flow.
7. First grant/read-test `list_projects`, then read one exact task with `get_task_context`.
8. With explicit confirmation, use a reversible write such as `create_idea` and verify the visible idea plus one audit/receipt pair.
9. Test the byte-identical retry, changed-input conflict, cross-project denial, insufficient-scope denial, and revoked-token denial.
10. Record the successful authenticated call as deployment evidence. Until step 10 succeeds, report the integration as implemented but not connected.

## Local tests

From `functions/` run `npm run build` and `npm test`. Tests use a fake persistence boundary or emulator-safe data. They cover owner-subject and scope checks, metadata/challenge behavior, strict inputs, confirmation, sensitive-content rejection, tool scope mapping, idempotent audited writes, and cross-project denial. They do not use a real access token, secret, Firebase Admin credential, or ChatGPT connection.

## Revocation and rollback

Revoke the OAuth client or owner grant at the authorization server, then remove/disable the MCP Function after explicit approval. Existing Dashboard workflow records remain valid. Browser rules deny both MCP backend collections, so disabling the Function does not expose them. Do not delete audit/receipt records merely to retry an operation.

## Known limitations

- This repository implements the resource server, not an OAuth authorization server or dynamic-client-registration service.
- The configured issuer must exactly match the token `iss` value, including its trailing slash. The authorization server must publish discovery metadata, advertise PKCE `S256`, echo the MCP `resource` parameter into the access-token audience, and support CIMD, DCR, or an explicitly registered ChatGPT client.
- A real OAuth flow cannot be proven by unit tests. It requires an approved deployed URL and a real authenticated ChatGPT tool call.
- Full prompts are optional. The plain-language prompt summary is mandatory and receives the same sensitive-content rejection as other tool input.
