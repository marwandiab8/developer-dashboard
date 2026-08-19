import { z } from "zod";
import {
  assertPayloadExcludesConfiguredValues,
  assertPayloadExcludesSensitiveContent,
} from "../codex/contract";

const id = z.string().uuid();
const text = (maximum: number) => z.string().max(maximum);
const nonBlank = (maximum: number) => text(maximum).refine((value) => value.trim().length > 0, "Must not be blank.");
const idempotencyKey = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const priority = z.enum(["low", "medium", "high", "critical"]);
const taskStatus = z.enum(["open", "ready", "in_progress", "blocked", "completed", "cancelled"]);
const ideaStatus = z.enum(["inbox", "ready_for_review", "archived"]);

export const mcpToolSchemas = {
  list_projects: z.object({ limit: z.number().int().min(1).max(100).default(50) }).strict(),
  get_project: z.object({ projectId: id }).strict(),
  list_project_ideas: z.object({ projectId: id, status: z.enum(["inbox", "ready_for_review", "converted", "archived"]).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  list_task_queue: z.object({ projectId: id.optional(), priority: priority.optional(), status: taskStatus.optional(), workedSince: z.string().datetime().optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  get_task: z.object({ projectId: id, taskId: id }).strict(),
  get_task_context: z.object({ projectId: id, taskId: id }).strict(),
  get_project_timeline: z.object({ projectId: id, limit: z.number().int().min(1).max(200).default(100) }).strict(),
  get_task_timeline: z.object({ projectId: id, taskId: id, limit: z.number().int().min(1).max(200).default(100) }).strict(),
  get_project_resume: z.object({ projectId: id }).strict(),
  get_ai_context: z.object({ projectId: id }).strict(),
  get_task_time_summary: z.object({ projectId: id, taskId: id }).strict(),
  create_idea: z.object({ projectId: id, title: nonBlank(4096), description: text(16 * 1024).default(""), priority: priority.default("medium"), tags: z.array(nonBlank(64)).max(25).default([]), source: z.enum(["ChatGPT", "manual"]).default("ChatGPT"), idempotencyKey }).strict(),
  update_idea: z.object({ projectId: id, ideaId: id, title: nonBlank(4096).optional(), description: text(16 * 1024).optional(), priority: priority.optional(), tags: z.array(nonBlank(64)).max(25).optional(), status: ideaStatus.optional(), idempotencyKey }).strict().refine((value) => Object.keys(value).some((key) => !["projectId", "ideaId", "idempotencyKey"].includes(key)), "At least one update is required."),
  convert_idea_to_task: z.object({ projectId: id, ideaId: id, acceptanceCriteria: text(32 * 1024).default(""), priority: priority.optional(), confirmed: z.literal(true), idempotencyKey }).strict(),
  update_task_status: z.object({ projectId: id, taskId: id, status: taskStatus, blocker: text(16 * 1024).optional(), confirmed: z.boolean().default(false), idempotencyKey }).strict().superRefine((value, context) => {
    if (value.status === "blocked" && !value.blocker?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "A blocked task requires a blocker." });
    if (["completed", "cancelled"].includes(value.status) && !value.confirmed) context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmed"], message: "Closing a task requires confirmation." });
  }),
  create_task_prompt_record: z.object({ projectId: id, taskId: id, workSessionId: id.nullable().optional(), promptSummary: nonBlank(16 * 1024), requestedChange: nonBlank(128 * 1024), fullPrompt: text(128 * 1024).optional(), idempotencyKey }).strict(),
  start_task_work_session: z.object({ projectId: id, taskId: id, promptRecordId: id.nullable().optional(), resumeSessionId: id.optional(), resumeFromNote: text(16 * 1024).default(""), idempotencyKey }).strict(),
  finish_task_work_session: z.object({ projectId: id, taskId: id, workSessionId: id, promptRecordId: id.nullable().optional(), outcome: z.enum(["completed", "paused", "abandoned"]), summary: nonBlank(32 * 1024), completedWork: z.array(nonBlank(4096)).max(100).default([]), unfinishedWork: z.array(nonBlank(4096)).max(100).default([]), problemsDiscovered: z.array(nonBlank(4096)).max(100).default([]), decisionsMade: z.array(nonBlank(4096)).max(100).default([]), blocker: text(16 * 1024).default(""), nextStep: text(16 * 1024).default(""), activeDurationMs: z.number().int().min(0).max(365 * 24 * 60 * 60 * 1000).optional(), idempotencyKey }).strict(),
  append_task_work_summary: z.object({ projectId: id, taskId: id, workSessionId: id, promptRecordId: id.nullable().optional(), summary: nonBlank(32 * 1024), idempotencyKey }).strict(),
  record_task_blocker: z.object({ projectId: id, taskId: id, workSessionId: id.nullable().optional(), blocker: nonBlank(16 * 1024), confirmed: z.literal(true), idempotencyKey }).strict(),
  mark_task_completed: z.object({ projectId: id, taskId: id, confirmed: z.literal(true), idempotencyKey }).strict(),
} as const;

export type McpToolName = keyof typeof mcpToolSchemas;
export type McpToolInput = { [Name in McpToolName]: z.infer<(typeof mcpToolSchemas)[Name]> };

export const READ_MCP_TOOLS = new Set<McpToolName>([
  "list_projects", "get_project", "list_project_ideas", "list_task_queue", "get_task",
  "get_task_context", "get_project_timeline", "get_task_timeline", "get_project_resume",
  "get_ai_context", "get_task_time_summary",
]);

export const validateMcpToolInput = <Name extends McpToolName>(
  name: Name,
  input: unknown,
  configuredValues: string[] = [],
): McpToolInput[Name] => {
  const parsed = mcpToolSchemas[name].safeParse(input);
  if (!parsed.success) throw new Error("invalid_tool_input");
  assertPayloadExcludesConfiguredValues(parsed.data, configuredValues);
  assertPayloadExcludesSensitiveContent(parsed.data);
  return parsed.data as McpToolInput[Name];
};
