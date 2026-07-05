export type RuntimeMode = "tauri" | "browser";

export function toPlayableLocalSrc(
  localPath: string,
  runtimeMode: RuntimeMode,
  convertFileSrc: (path: string) => string
): string {
  if (runtimeMode === "tauri") {
    return convertFileSrc(localPath);
  }

  return `file://${localPath}`;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function calculateProgressPercent(current: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (current / total) * 100));
}

export function calculateSeekTime(percent: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const normalizedPercent = Math.min(100, Math.max(0, percent));
  return (normalizedPercent / 100) * total;
}

export function createAudioPlayerKey(playerInstanceId: number): string {
  return `audio-${playerInstanceId}`;
}
