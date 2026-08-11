import type { FirebaseAssociationDetection, FirebaseAssociationEvidence, SafeConfigFile } from "./types";

export const SAFE_FIREBASE_CONFIG_PATHS = [
  ".firebaserc",
  "firebase.json",
  "apphosting.yaml",
  "apphosting.yml",
  ".env.example",
  ".env.sample",
] as const;

const SAFE_FIREBASE_CONFIG_PATH_SET = new Set<string>(SAFE_FIREBASE_CONFIG_PATHS);
const FIREBASE_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ENV_PROJECT_KEYS = new Set([
  "FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
]);

const basename = (path: string): string => path.split("/").at(-1) ?? "";

export const isSafeFirebaseConfigPath = (path: string): boolean => SAFE_FIREBASE_CONFIG_PATH_SET.has(path);

const addEvidence = (
  output: FirebaseAssociationEvidence[],
  projectId: unknown,
  filePath: string,
  configKey: string,
): void => {
  if (typeof projectId !== "string") return;
  const candidate = projectId.trim();
  if (!FIREBASE_PROJECT_ID.test(candidate)) return;
  output.push({ projectId: candidate, filePath, configKey, status: "detected" });
};

const parseTextScalar = (rawValue: string): string | null => {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let end = rawValue.length;

  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue[index];
    if (quote === '"' && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if ((character === "'" || character === '"') && !escaped) {
      if (quote === null) quote = character;
      else if (quote === character) quote = null;
    }
    if (character === "#" && quote === null) {
      end = index;
      break;
    }
    escaped = false;
  }

  if (quote !== null) return null;
  const candidate = rawValue.slice(0, end).trim();
  if (!candidate) return null;
  if (candidate.startsWith('"')) {
    if (!candidate.endsWith('"')) return null;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return typeof parsed === "string" ? parsed.trim() : null;
    } catch {
      return null;
    }
  }
  if (candidate.startsWith("'")) {
    if (!candidate.endsWith("'")) return null;
    return candidate.slice(1, -1).replace(/''/g, "'").trim();
  }
  if (candidate.endsWith("'") || candidate.endsWith('"')) return null;
  if (/^[\[{&*!>|]/.test(candidate)) return null;
  return candidate;
};

const inspectJson = (file: SafeConfigFile, evidence: FirebaseAssociationEvidence[]): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const record = parsed as Record<string, unknown>;
  if (basename(file.path) === ".firebaserc") {
    const projects = record.projects;
    if (projects && typeof projects === "object") {
      for (const [alias, projectId] of Object.entries(projects as Record<string, unknown>)) {
        addEvidence(evidence, projectId, file.path, `projects.${alias}`);
      }
    }
    return;
  }
  for (const key of ["projectId", "project_id", "project"]) {
    addEvidence(evidence, record[key], file.path, key);
  }
};

const inspectEnvTemplate = (file: SafeConfigFile, evidence: FirebaseAssociationEvidence[]): void => {
  for (const line of file.content.split(/\r?\n/)) {
    const envMatch = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (envMatch && ENV_PROJECT_KEYS.has(envMatch[1])) {
      addEvidence(evidence, parseTextScalar(envMatch[2]), file.path, envMatch[1]);
    }
  }
};

type AppHostingEnvEntry = { variable?: string; value?: string };

const splitFlowFields = (value: string): string[] | null => {
  const output: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if ((character === "'" || character === '"') && !escaped) {
      if (quote === null) quote = character;
      else if (quote === character) quote = null;
    } else if (character === "," && quote === null) {
      output.push(value.slice(start, index));
      start = index + 1;
    }
    escaped = false;
  }
  if (quote !== null) return null;
  output.push(value.slice(start));
  return output;
};

const parseFlowEntry = (value: string): AppHostingEnvEntry | null => {
  const candidate = value.trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  const fields = splitFlowFields(candidate.slice(1, -1));
  if (!fields) return null;
  const entry: AppHostingEnvEntry = {};
  for (const field of fields) {
    const match = field.match(/^\s*(variable|value)\s*:\s*(.*)$/);
    if (!match) continue;
    const scalar = parseTextScalar(match[2]);
    if (scalar !== null) entry[match[1] as keyof AppHostingEnvEntry] = scalar;
  }
  return entry;
};

const addAppHostingEntry = (
  file: SafeConfigFile,
  evidence: FirebaseAssociationEvidence[],
  entry: AppHostingEnvEntry | null,
): void => {
  if (!entry?.variable || !ENV_PROJECT_KEYS.has(entry.variable)) return;
  addEvidence(evidence, entry.value, file.path, `env.${entry.variable}`);
};

const inspectAppHosting = (file: SafeConfigFile, evidence: FirebaseAssociationEvidence[]): void => {
  const lines = file.content.split(/\r?\n/);
  let envIndent: number | null = null;
  let current: (AppHostingEnvEntry & { indent: number }) | null = null;

  const flush = () => {
    addAppHostingEntry(file, evidence, current);
    current = null;
  };

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const leadingWhitespace = rawLine.match(/^[ \t]*/)?.[0] ?? "";
    if (leadingWhitespace.includes("\t")) continue;
    const indentation = leadingWhitespace.length;
    const line = rawLine.trim();

    if (envIndent === null) {
      const envMatch = line.match(/^env\s*:\s*(.*)$/);
      if (!envMatch) continue;
      envIndent = indentation;
      const inline = envMatch[1].trim();
      for (const match of inline.matchAll(/\{[^{}]*\}/g)) {
        addAppHostingEntry(file, evidence, parseFlowEntry(match[0]));
      }
      continue;
    }

    if (indentation <= envIndent) {
      flush();
      envIndent = null;
      continue;
    }

    const listItem = line.match(/^-\s*(.*)$/);
    if (listItem && (current === null || indentation <= current.indent)) {
      flush();
      current = { indent: indentation };
      const inline = listItem[1].trim();
      if (inline.startsWith("{")) {
        const parsed = parseFlowEntry(inline);
        if (parsed) current = { ...parsed, indent: indentation };
      } else {
        const field = inline.match(/^(variable|value)\s*:\s*(.*)$/);
        const scalar = field ? parseTextScalar(field[2]) : null;
        if (field && scalar !== null) current[field[1] as keyof AppHostingEnvEntry] = scalar;
      }
      continue;
    }

    if (current && indentation > current.indent) {
      const field = line.match(/^(variable|value)\s*:\s*(.*)$/);
      const scalar = field ? parseTextScalar(field[2]) : null;
      if (field && scalar !== null) current[field[1] as keyof AppHostingEnvEntry] = scalar;
    }
  }
  flush();
};

export const detectFirebaseAssociations = (
  files: SafeConfigFile[],
  discoveryStatus: FirebaseAssociationDetection["discoveryStatus"] = "complete",
): FirebaseAssociationDetection => {
  const evidence: FirebaseAssociationEvidence[] = [];
  for (const file of files) {
    if (!isSafeFirebaseConfigPath(file.path)) continue;
    if (file.content.length > 128 * 1024) continue;
    const fileName = basename(file.path).toLowerCase();
    if (fileName.endsWith(".json") || fileName === ".firebaserc") inspectJson(file, evidence);
    else if (fileName === "apphosting.yaml" || fileName === "apphosting.yml") inspectAppHosting(file, evidence);
    else inspectEnvTemplate(file, evidence);
  }

  const unique = new Map<string, FirebaseAssociationEvidence>();
  for (const item of evidence) unique.set(`${item.projectId}\u0000${item.filePath}\u0000${item.configKey}`, item);
  const deduplicated = [...unique.values()].sort((a, b) =>
    `${a.projectId}:${a.filePath}:${a.configKey}`.localeCompare(`${b.projectId}:${b.filePath}:${b.configKey}`),
  );
  return {
    projectIds: [...new Set(deduplicated.map((item) => item.projectId))].sort(),
    evidence: deduplicated,
    discoveryStatus,
  };
};
