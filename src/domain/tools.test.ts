import { describe, expect, it } from "vitest";
import { buildToolMessage } from "./tools";

describe("tools", () => {
  it("reports ready when yt-dlp and ffmpeg are available", () => {
    expect(
      buildToolMessage({
        ytDlpAvailable: true,
        ffmpegAvailable: true,
        ytDlpPath: "/opt/homebrew/bin/yt-dlp",
        ffmpegPath: "/opt/homebrew/bin/ffmpeg"
      })
    ).toBe("yt-dlp 可用，ffmpeg 可用");
  });

  it("explains missing tools without blocking the app", () => {
    expect(
      buildToolMessage({
        ytDlpAvailable: false,
        ffmpegAvailable: true
      })
    ).toContain("yt-dlp 未检测到");
  });
});
