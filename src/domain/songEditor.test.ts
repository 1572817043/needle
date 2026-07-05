import { describe, expect, it } from "vitest";
import type { Song } from "../types";
import {
  applySongMetadataUpdate,
  validateSongMetadataDraft
} from "./songEditor";

const song: Song = {
  id: "song-1",
  title: "原标题",
  artist: "原歌手",
  sourceTitle: "B站原标题",
  sourceAuthor: "来源UP",
  sourceUrl: "https://www.bilibili.com/video/BV1demo",
  coverUrl: "https://example.com/cover.jpg",
  localPath: "/Users/a0000/Music/Needle/demo.m4a",
  audioFormat: "m4a",
  durationSeconds: 180,
  createdAt: "2026-06-27T00:00:00Z"
};

describe("songEditor", () => {
  it("rejects blank title or artist after trimming", () => {
    expect(validateSongMetadataDraft("  ", "周杰伦")).toBe("歌名不能为空");
    expect(validateSongMetadataDraft("晴天", "   ")).toBe("歌手不能为空");
  });

  it("accepts non-empty title and artist after trimming", () => {
    expect(validateSongMetadataDraft(" 晴天 ", " 周杰伦 ")).toBeNull();
  });

  it("updates only editable metadata and preserves source fields", () => {
    expect(
      applySongMetadataUpdate(song, {
        title: "晴天",
        artist: "周杰伦"
      })
    ).toEqual({
      ...song,
      title: "晴天",
      artist: "周杰伦"
    });
  });
});
