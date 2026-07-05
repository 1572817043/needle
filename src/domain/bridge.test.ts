import { describe, expect, it, vi } from "vitest";
import { createNeedleApi } from "./bridge";
import type { CandidateTrack, ChatMessageMetadata } from "../types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn()
}));

vi.mock("../api", () => ({
  needleApi: {
    checkTools: vi.fn(),
    loadAiSettings: vi.fn(),
    listSongs: vi.fn(),
    loadCoverDataUrl: vi.fn(),
    resolvePreviewStream: vi.fn(),
    loadSongDataUrl: vi.fn(),
    clearChatMessages: vi.fn(),
    convertAudio: vi.fn(),
    deleteSong: vi.fn(),
    searchBilibili: vi.fn(),
    rankCandidatesWithAi: vi.fn(),
    saveAiSettings: vi.fn(),
    listModels: vi.fn(),
    showInFinder: vi.fn()
  },
  runtimeMode: "browser"
}));

describe("bridge", () => {
  it("forwards tool checks to the Tauri command layer", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ytDlpAvailable: true,
      ffmpegAvailable: false
    });
    const api = createNeedleApi(invoke);

    await expect(api.checkTools()).resolves.toEqual({
      ytDlpAvailable: true,
      ffmpegAvailable: false
    });
    expect(invoke).toHaveBeenCalledWith("check_tools");
  });

  it("passes search query to Bilibili search command", async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const api = createNeedleApi(invoke);

    await api.searchBilibili("江南 live");

    expect(invoke).toHaveBeenCalledWith("search_bilibili", { query: "江南 live" });
  });

  it("passes apiKey to save_ai_settings with the camelCase payload Tauri expects", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createNeedleApi(invoke);

    await api.saveAiSettings(
      {
        providerName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        audioFormat: "mp3",
        apiKeyStoredInKeychain: true
      },
      "sk-test"
    );

    expect(invoke).toHaveBeenCalledWith("save_ai_settings", {
      settings: {
        providerName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        audioFormat: "mp3",
        apiKeyStoredInKeychain: true
      },
      apiKey: "sk-test"
    });
  });

  it("loads local songs as playable data URLs", async () => {
    const invoke = vi.fn().mockResolvedValue("data:audio/mp4;base64,AAAA");
    const api = createNeedleApi(invoke);

    await expect(api.loadSongDataUrl("/Users/a0000/Music/Needle/demo.m4a")).resolves.toBe(
      "data:audio/mp4;base64,AAAA"
    );
    expect(invoke).toHaveBeenCalledWith("load_song_data_url", {
      path: "/Users/a0000/Music/Needle/demo.m4a"
    });
  });

  it("loads remote cover images through the Tauri command layer", async () => {
    const invoke = vi.fn().mockResolvedValue("data:image/jpeg;base64,AAAA");
    const api = createNeedleApi(invoke);

    await expect(api.loadCoverDataUrl("https://i1.hdslb.com/bfs/archive/demo.jpg")).resolves.toBe(
      "data:image/jpeg;base64,AAAA"
    );
    expect(invoke).toHaveBeenCalledWith("load_cover_data_url", {
      url: "https://i1.hdslb.com/bfs/archive/demo.jpg"
    });
  });

  it("passes deleteSong id with the explicit songId payload the backend command expects", async () => {
    const invoke = vi.fn().mockResolvedValue({
      songId: "local-sunny",
      fileDeleted: true,
      dbRowDeleted: true
    });
    const api = createNeedleApi(invoke);

    await expect(api.deleteSong("local-sunny")).resolves.toEqual({
      songId: "local-sunny",
      fileDeleted: true,
      dbRowDeleted: true
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("delete_song", { songId: "local-sunny" });
  });

  it("passes edited song metadata with the exact payload the backend command expects", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: "local-sunny",
      title: "晴天（Live）",
      artist: "周杰伦",
      sourceTitle: "晴天 官方完整版",
      sourceAuthor: "本地音频",
      sourceUrl: "https://www.bilibili.com",
      coverUrl: "https://example.com/cover.jpg",
      localPath: "/Users/a0000/Music/Needle/晴天.m4a",
      audioFormat: "m4a",
      durationSeconds: 269,
      createdAt: "2026-06-27T00:00:00Z"
    });
    const api = createNeedleApi(invoke);

    await api.updateSongMetadata("local-sunny", "晴天（Live）", "周杰伦");

    expect(invoke).toHaveBeenCalledWith("update_song_metadata", {
      songId: "local-sunny",
      title: "晴天（Live）",
      artist: "周杰伦"
    });
  });

  it("forwards audio conversion requests to the generic backend command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: "local-sunny",
      title: "晴天",
      artist: "周杰伦",
      sourceTitle: "晴天 官方完整版",
      sourceAuthor: "本地音频",
      sourceUrl: "https://www.bilibili.com",
      coverUrl: "https://example.com/cover.jpg",
      localPath: "/Users/a0000/Music/Needle/晴天.mp3",
      audioFormat: "mp3",
      durationSeconds: 269,
      createdAt: "2026-06-27T00:00:00Z"
    });
    const api = createNeedleApi(invoke);
    const candidate: CandidateTrack = {
      sourceResult: {
        id: "BV-convert",
        title: "晴天 官方完整版",
        url: "https://www.bilibili.com/video/BV-convert",
        coverUrl: "https://example.com/cover.jpg",
        author: "本地音频",
        durationSeconds: 269,
        playCount: 999
      },
      matchReason: "命中",
      confidence: 0.99,
      status: "readyToConvert"
    };

    await api.convertAudio(candidate);

    expect(invoke).toHaveBeenCalledWith("convert_audio", { candidate });
  });

  it("loads the default chat session from the Tauri command layer", async () => {
    const invoke = vi.fn().mockResolvedValue({
      session: {
        id: "default",
        title: "默认会话",
        createdAt: "2026-06-25T00:00:00Z",
        updatedAt: "2026-06-25T00:00:00Z"
      },
      messages: []
    });
    const api = createNeedleApi(invoke);

    await expect(api.loadChatSession()).resolves.toEqual({
      session: {
        id: "default",
        title: "默认会话",
        createdAt: "2026-06-25T00:00:00Z",
        updatedAt: "2026-06-25T00:00:00Z"
      },
      messages: []
    });
    expect(invoke).toHaveBeenCalledWith("load_chat_session");
  });

  it("clears the default chat history through the Tauri command layer", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createNeedleApi(invoke);

    await expect(api.clearChatMessages()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("clear_chat_messages");
  });

  it("opens the app data directory through the Tauri command layer", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createNeedleApi(invoke);

    await expect(api.showAppDataDir()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("show_app_data_dir");
  });

  it("passes chat message payload to append_chat_message", async () => {
    const metadata: ChatMessageMetadata = {
      query: "夜里写代码 粤语歌"
    };
    const invoke = vi.fn().mockResolvedValue({
      id: "msg-user-1",
      sessionId: "default",
      role: "user",
      content: "夜里写代码 粤语歌",
      status: "completed",
      metadata,
      createdAt: "2026-06-25T00:00:00Z"
    });
    const api = createNeedleApi(invoke);

    await api.appendChatMessage({
      sessionId: "default",
      role: "user",
      content: "夜里写代码 粤语歌",
      status: "completed",
      metadata
    });

    expect(invoke).toHaveBeenCalledWith("append_chat_message", {
      message: {
        sessionId: "default",
        role: "user",
        content: "夜里写代码 粤语歌",
        status: "completed",
        metadata
      }
    });
  });

  it("passes assistant message updates to update_chat_message", async () => {
    const metadata: ChatMessageMetadata = {
      query: "夜里写代码 粤语歌",
      candidates: []
    };
    const invoke = vi.fn().mockResolvedValue({
      id: "msg-assistant-1",
      sessionId: "default",
      role: "assistant",
      content: "已找到候选",
      status: "completed",
      metadata,
      createdAt: "2026-06-25T00:00:01Z"
    });
    const api = createNeedleApi(invoke);

    await api.updateChatMessage({
      id: "msg-assistant-1",
      content: "已找到候选",
      status: "completed",
      metadata
    });

    expect(invoke).toHaveBeenCalledWith("update_chat_message", {
      message: {
        id: "msg-assistant-1",
        content: "已找到候选",
        status: "completed",
        metadata
      }
    });
  });
});

describe("now playing metadata helpers", () => {
  it("builds preview metadata from the candidate instead of reusing the last local song", async () => {
    const candidate: CandidateTrack = {
      sourceResult: {
        id: "BV-preview",
        title: "江南 Live 现场版",
        url: "https://www.bilibili.com/video/BV-preview",
        coverUrl: "https://example.com/preview.jpg",
        author: "现场账号",
        durationSeconds: 231,
        playCount: 4200
      },
      matchReason: "标题接近",
      confidence: 0.94,
      status: "readyToConvert"
    };

    const appModule = await import("../App");
    const createNowPlayingInfoFromCandidate = (
      appModule as Record<string, unknown>
    ).createNowPlayingInfoFromCandidate;

    expect(createNowPlayingInfoFromCandidate).toBeTypeOf("function");
    if (typeof createNowPlayingInfoFromCandidate !== "function") {
      return;
    }

    expect(createNowPlayingInfoFromCandidate(candidate)).toEqual({
      title: "江南",
      subtitle: "现场账号 · 试听",
      coverUrl: "https://example.com/preview.jpg"
    });
  });
});
