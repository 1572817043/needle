import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errors";

describe("errors", () => {
  it("uses Error.message when available", () => {
    expect(getErrorMessage(new Error("yt-dlp not found"))).toBe("yt-dlp not found");
  });

  it("uses string errors returned by Tauri commands", () => {
    expect(getErrorMessage("未检测到 yt-dlp")).toBe("未检测到 yt-dlp");
  });

  it("falls back for unknown error values", () => {
    expect(getErrorMessage({ code: 1 })).toBe("未知错误");
  });
});
