export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "developer-dashboard:data:v1";
export const QUICK_CAPTURE_PREFERENCES_KEY = "developer-dashboard:quick-capture:v1";
export const QUICK_CAPTURE_RECENT_LIMIT = 5;
export const KEYBOARD_CHORD_TIMEOUT_MS = 700;

export const PRIMARY_NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/ideas", label: "Ideas Inbox" },
  { href: "/tasks", label: "Tasks" },
  { href: "/sessions", label: "Sessions" },
  { href: "/search", label: "Search" },
] as const;

export const PROJECT_SECTIONS = [
  "workbench",
  "ideas",
  "tasks",
  "brain-dump",
  "scratchpad",
  "sessions",
  "architecture",
  "codex-prompts",
  "notes",
  "links",
  "resume",
  "ai-context",
  "activity",
] as const;
