export const DEBUG_LOG_LIMIT = 100;

export type DebugLogLevel = "info" | "warn" | "error";

export type DebugLogSource =
  | "frontend"
  | "tauri"
  | "bilibili"
  | "ai"
  | "preview"
  | "convert"
  | "library"
  | "settings";

export type DebugLogEntry = {
  id: string;
  time: string;
  level: DebugLogLevel;
  source: DebugLogSource;
  message: string;
  details?: unknown;
};

export function appendDebugLogEntry(
  entries: DebugLogEntry[],
  entry: DebugLogEntry
): DebugLogEntry[] {
  const nextEntries = [...entries, entry];

  if (nextEntries.length <= DEBUG_LOG_LIMIT) {
    return nextEntries;
  }

  return nextEntries.slice(nextEntries.length - DEBUG_LOG_LIMIT);
}

export function formatDebugLogTime(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatDebugLogDetails(details: unknown): string {
  if (details === undefined) {
    return "";
  }

  if (typeof details === "string") {
    return details.trim();
  }

  if (details instanceof Error) {
    return details.stack?.trim() || details.message.trim();
  }

  if (
    details !== null &&
    (typeof details === "object" || typeof details === "number" || typeof details === "boolean" || typeof details === "bigint")
  ) {
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }

  return String(details).trim();
}

export function formatDebugLogEntry(entry: DebugLogEntry): string {
  const head = `${entry.time} [${entry.level}][${entry.source}] ${entry.message}`;
  const details = formatDebugLogDetails(entry.details);

  if (!details) {
    return head;
  }

  return `${head}\n${details}`;
}

export function serializeDebugLogs(entries: DebugLogEntry[]): string {
  return entries.map(formatDebugLogEntry).join("\n");
}
