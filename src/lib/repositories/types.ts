import {
  ArchitectureDecision,
  BrainDump,
  CodexPrompt,
  DashboardData,
  DecisionStatus,
  DevelopmentSession,
  Idea,
  ImportantLink,
  Note,
  Project,
  Task,
} from "../models";

export type DashboardAction =
  | { type: "seed"; payload: DashboardData }
  | { type: "project_upsert"; payload: Project }
  | { type: "project_update"; payload: { id: string; updates: Partial<Project> } }
  | { type: "idea_add"; payload: Idea }
  | { type: "idea_update"; payload: { id: string; updates: Partial<Idea> } }
  | { type: "idea_archive"; payload: { id: string } }
  | { type: "idea_to_task"; payload: { ideaId: string; taskId: string; task: Task } }
  | { type: "task_add"; payload: Task }
  | { type: "task_update"; payload: { id: string; updates: Partial<Task> } }
  | { type: "task_start"; payload: { id: string } }
  | { type: "task_block"; payload: { id: string; reason: string } }
  | { type: "task_complete"; payload: { id: string } }
  | { type: "brain_dump_add"; payload: BrainDump }
  | { type: "brain_dump_update"; payload: { id: string; updates: Partial<BrainDump> } }
  | { type: "brain_dump_delete"; payload: { id: string } }
  | { type: "scratchpad_update"; payload: { projectId: string; markdown: string } }
  | { type: "architecture_decision_upsert"; payload: ArchitectureDecision }
  | { type: "architecture_decision_update_status"; payload: { id: string; status: DecisionStatus } }
  | { type: "prompt_upsert"; payload: CodexPrompt }
  | { type: "prompt_mark_used"; payload: { id: string; usedSummary: string } }
  | { type: "note_add"; payload: Note }
  | { type: "note_update"; payload: { id: string; updates: Partial<Note> } }
  | { type: "link_add"; payload: ImportantLink }
  | { type: "link_update"; payload: { id: string; updates: Partial<ImportantLink> } }
  | { type: "session_start"; payload: DevelopmentSession }
  | { type: "session_end"; payload: { id: string; updates: Partial<DevelopmentSession> } }
  | { type: "session_note_append"; payload: { id: string; note: string } }
  | { type: "activity_add"; payload: {
      id: string;
      projectId: string;
      type:
        | "project_created"
        | "idea_captured"
        | "idea_converted"
        | "task_started"
        | "task_completed"
        | "decision_accepted"
        | "prompt_used"
        | "session_started"
        | "session_completed"
        | "resume_generated"
        | "ai_context_generated";
      summary: string;
      entityType: string;
      entityId: string;
      metadata: string;
      createdAt: string;
    } };

export type SearchResult = {
  projectId: string;
  projectName: string;
  entityType:
    | "project"
    | "idea"
    | "task"
    | "note"
    | "architecture_decision"
    | "codex_prompt"
    | "brain_dump"
    | "session"
    | "link";
  entityId: string;
  text: string;
  meta?: string;
};
