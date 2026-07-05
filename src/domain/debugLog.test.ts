import { describe, expect, it } from "vitest";
import {
  appendDebugLogEntry,
  formatDebugLogEntry,
  serializeDebugLogs
} from "./debugLog";

describe("debugLog", () => {
  it("keeps only the latest 100 log entries", () => {
    const logs = Array.from({ length: 100 }, (_, index) => ({
      id: `id-${index}`,
      time: `2026-06-27 10:00:${String(index).padStart(2, "0")}`,
      level: "info" as const,
      source: "frontend" as const,
      message: `log-${index}`
    }));

    const next = appendDebugLogEntry(logs, {
      id: "id-100",
      time: "2026-06-27 10:01:40",
      level: "warn",
      source: "ai",
      message: "new log"
    });

    expect(next).toHaveLength(100);
    expect(next[0]?.id).toBe("id-1");
    expect(next.at(-1)?.id).toBe("id-100");
  });

  it("formats logs for copy with readable details", () => {
    const entry = {
      id: "id-1",
      time: "2026-06-27 10:01:40",
      level: "error" as const,
      source: "convert" as const,
      message: "转换失败",
      details: {
        songId: "BV123",
        reason: "ffmpeg 不可用"
      }
    };

    expect(formatDebugLogEntry(entry)).toContain("[error][convert] 转换失败");
    expect(formatDebugLogEntry(entry)).toContain('"songId": "BV123"');
    expect(serializeDebugLogs([entry])).toBe(formatDebugLogEntry(entry));
  });
});
