import type { ToolStatus } from "../types";

export function buildToolMessage(status: ToolStatus): string {
  const parts = [
    status.ytDlpAvailable ? "yt-dlp 可用" : "yt-dlp 未检测到",
    status.ffmpegAvailable ? "ffmpeg 可用" : "ffmpeg 未检测到"
  ];

  return parts.join("，");
}

export function toolsReady(status: ToolStatus): boolean {
  return status.ytDlpAvailable && status.ffmpegAvailable;
}
