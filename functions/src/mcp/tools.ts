import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpPrincipal, McpScope } from "./auth";
import { McpAuthorizationError, requireMcpScope } from "./auth";
import {
  mcpToolSchemas,
  READ_MCP_TOOLS,
  validateMcpToolInput,
  type McpToolName,
} from "./contract";
import type { DashboardMcpPersistencePort } from "./persistence";

const descriptions: Record<McpToolName, string> = {
  list_projects: "List the owner's Dashboard projects with bounded current-focus fields.",
  get_project: "Get one project by exact stable project ID.",
  list_project_ideas: "List ideas for one exact project, optionally filtered by lifecycle status.",
  list_task_queue: "List the prioritized task queue, ordered In progress, Blocked, Ready, then Open.",
  get_task: "Get one task by exact project ID and task ID.",
  get_task_context: "Get bounded project, idea, prompt, session, and decision context for one exact task.",
  get_project_timeline: "Get meaningful project history without routine repository-sync noise.",
  get_task_timeline: "Get chronological history for one exact task.",
  get_project_resume: "Get a bounded project-resume projection.",
  get_ai_context: "Get bounded AI context for a project; this never grants repository access.",
  get_task_time_summary: "Get active-duration totals derived from valid task work sessions.",
  create_idea: "Create an idea in a project's Idea Inbox.",
  update_idea: "Update a non-converted idea by exact IDs.",
  convert_idea_to_task: "Convert an idea transactionally and preserve a bidirectional link.",
  update_task_status: "Change a task lifecycle status; closing states require confirmation.",
  create_task_prompt_record: "Store the mandatory ChatGPT prompt summary and optional safe full prompt before Codex work.",
  start_task_work_session: "Start or explicitly resume active-time tracking for one task.",
  finish_task_work_session: "Finish, pause, or abandon one exact work session and update its active-time total.",
  append_task_work_summary: "Append a work summary to an exact task session and related prompt.",
  record_task_blocker: "Record a confirmed blocker on an exact task and optional work session.",
  mark_task_completed: "Mark an exact task completed only after explicit confirmation.",
};

export class DashboardMcpToolService {
  constructor(
    private readonly uid: string,
    private readonly principal: McpPrincipal,
    private readonly persistence: DashboardMcpPersistencePort,
    private readonly configuredValues: string[] = [],
  ) {}

  async call(name: McpToolName, raw: unknown): Promise<Record<string, unknown>> {
    const requiredScope: McpScope = READ_MCP_TOOLS.has(name) ? "dashboard:read" : "dashboard:write";
    requireMcpScope(this.principal, requiredScope);
    const input = validateMcpToolInput(name, raw, this.configuredValues);
    return this.persistence.call(this.uid, name, input);
  }
}

const toolNames = Object.keys(mcpToolSchemas) as McpToolName[];

type OAuthSecurityScheme = { type: "oauth2"; scopes: string[] };

export type DashboardMcpToolDefinition = Tool & {
  securitySchemes: OAuthSecurityScheme[];
};

export const listDashboardMcpToolDefinitions = (): DashboardMcpToolDefinition[] =>
  toolNames.map((name) => {
    const readOnly = READ_MCP_TOOLS.has(name);
    const securitySchemes: OAuthSecurityScheme[] = [{
      type: "oauth2",
      scopes: [readOnly ? "dashboard:read" : "dashboard:write"],
    }];
    return {
      name,
      title: name.replaceAll("_", " "),
      description: descriptions[name],
      inputSchema: toJsonSchemaCompat(mcpToolSchemas[name]) as Tool["inputSchema"],
      securitySchemes,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: ["mark_task_completed", "update_task_status"].includes(name),
        idempotentHint: !readOnly,
        openWorldHint: false,
      },
      _meta: {
        securitySchemes,
      },
    };
  });

const authorizationChallenge = (resourceUrl: string, scope: McpScope) =>
  `Bearer resource_metadata="${resourceUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Authorize the required Developer Dashboard scope.", scope="${scope}"`;

export const createDashboardMcpServer = (
  service: DashboardMcpToolService,
  resourceUrl: string,
) => {
  const server = new Server(
    { name: "developer-dashboard", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: "Use exact project and task IDs. Read context before any write. Task completion always requires explicit confirmation.",
    },
  );
  const definitions = listDashboardMcpToolDefinitions();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name as McpToolName;
    if (!toolNames.includes(name)) {
      return {
        content: [{ type: "text" as const, text: "Unknown Developer Dashboard tool." }],
        isError: true,
      };
    }
    try {
      const result = await service.call(name, request.params.arguments ?? {});
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      if (error instanceof McpAuthorizationError) {
        const scope: McpScope = READ_MCP_TOOLS.has(name) ? "dashboard:read" : "dashboard:write";
        return {
          content: [{ type: "text" as const, text: "Developer Dashboard authorization is required." }],
          isError: true,
          _meta: { "mcp/www_authenticate": [authorizationChallenge(resourceUrl, scope)] },
        };
      }
      throw error;
    }
  });
  return server;
};
