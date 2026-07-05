import { describe, expect, it } from "vitest";
import { getDefaultMusicDir, createSongFromCandidate } from "./musicLibrary";
import type { CandidateTrack } from "../types";

const candidate: CandidateTrack = {
  confidence: 0.92,
  matchReason: "标题匹配歌手和歌名",
  status: "readyToConvert",
  sourceResult: {
    id: "BV123",
    title: "林俊杰 江南 Live",
    url: "https://www.bilibili.com/video/BV123",
    coverUrl: "https://example.com/cover.jpg",
    author: "音乐现场",
    durationSeconds: 260,
    playCount: 12000
  }
};

describe("musicLibrary", () => {
  it("uses ~/Music/Needle as the default music directory", () => {
    expect(getDefaultMusicDir("/Users/a0000")).toBe("/Users/a0000/Music/Needle");
  });

  it("creates a local song record from a converted candidate", () => {
    const song = createSongFromCandidate(candidate, "/Users/a0000/Music/Needle/jiangnan.m4a");

    expect(song.title).toBe("江南");
    expect(song.artist).toBe("林俊杰");
    expect(song.sourceTitle).toBe("林俊杰 江南 Live");
    expect(song.sourceAuthor).toBe("音乐现场");
    expect(song.localPath.endsWith(".m4a")).toBe(true);
    expect(song.audioFormat).toBe("m4a");
    expect(song.sourceUrl).toBe(candidate.sourceResult.url);
  });
});
