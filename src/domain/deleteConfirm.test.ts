import { describe, expect, it } from "vitest";
import { createPendingDeleteSong, getDeleteConfirmMessage } from "./deleteConfirm";
import type { Song } from "../types";

const song: Song = {
  id: "BV1demo",
  title: "小众又好听的粤语",
  artist: "测试账号",
  sourceTitle: "【高音质】小众又好听的粤语",
  sourceAuthor: "测试账号",
  sourceUrl: "https://www.bilibili.com/video/BV1demo",
  coverUrl: "https://example.com/cover.jpg",
  localPath: "/Users/a0000/Music/Needle/demo.m4a",
  audioFormat: "m4a",
  durationSeconds: 210,
  createdAt: "2026-06-25T00:00:00.000Z"
};

describe("deleteConfirm", () => {
  it("creates a pending delete state with current playback information", () => {
    expect(createPendingDeleteSong(song, "BV1demo")).toEqual({
      id: "BV1demo",
      title: "小众又好听的粤语",
      localPath: "/Users/a0000/Music/Needle/demo.m4a",
      isCurrentPlaying: true
    });
  });

  it("builds the in-app delete confirmation message", () => {
    expect(getDeleteConfirmMessage("晴天")).toBe("删除《晴天》？默认会同时删除本地文件。");
  });
});
