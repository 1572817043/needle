import type { CandidateTrack, Song } from "../types";
import { cleanSongMetadata } from "./songMetadata";

export function getDefaultMusicDir(homeDir: string): string {
  return `${homeDir.replace(/\/+$/, "")}/Music/Needle`;
}

export function createSongFromCandidate(candidate: CandidateTrack, localPath: string): Song {
  const metadata = cleanSongMetadata(candidate.sourceResult.title, candidate.sourceResult.author);
  const extension = localPath.split(".").pop()?.toLowerCase() === "mp3" ? "mp3" : "m4a";

  return {
    id: candidate.sourceResult.id,
    title: metadata.title,
    artist: metadata.artist,
    sourceTitle: metadata.sourceTitle,
    sourceAuthor: metadata.sourceAuthor,
    sourceUrl: candidate.sourceResult.url,
    coverUrl: candidate.sourceResult.coverUrl,
    localPath,
    audioFormat: extension,
    durationSeconds: candidate.sourceResult.durationSeconds,
    createdAt: new Date().toISOString()
  };
}
