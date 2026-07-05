import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { createNeedleApi } from "./domain/bridge";
import { createFallbackCandidates } from "./domain/candidates";
import { cleanSongMetadata } from "./domain/songMetadata";
import { DEFAULT_AUDIO_FORMAT } from "./domain/aiSettings";
import type {
  AppendChatMessageInput,
  AiSettings,
  BiliSearchResult,
  CandidateTrack,
  ChatMessage,
  DeleteResult,
  Song,
  ToolStatus,
  UpdateChatMessageInput
} from "./types";

const sampleResults: BiliSearchResult[] = [
  {
    id: "BV1NeedleDemo",
    title: "林俊杰 江南 Live 现场版",
    url: "https://www.bilibili.com/video/BV1NeedleDemo",
    coverUrl: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=320&q=80",
    author: "音乐现场",
    durationSeconds: 261,
    playCount: 12000
  },
  {
    id: "BV2NeedleDemo",
    title: "江南 翻唱 纯享版",
    url: "https://www.bilibili.com/video/BV2NeedleDemo",
    coverUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=320&q=80",
    author: "深夜电台",
    durationSeconds: 248,
    playCount: 4200
  }
];

const sampleSongs: Song[] = [
  {
    id: "local-sunny",
    title: "晴天",
    artist: "本地音频",
    sourceTitle: "晴天 官方完整版",
    sourceAuthor: "本地音频",
    sourceUrl: "https://www.bilibili.com",
    coverUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=320&q=80",
    localPath: "/Users/a0000/Music/Needle/晴天.m4a",
    audioFormat: "m4a",
    durationSeconds: 269,
    createdAt: new Date().toISOString()
  }
];

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export const runtimeMode = isTauriRuntime() ? "tauri" : "browser";

console.log(`[api] runtimeMode=${runtimeMode} isTauriRuntime=${isTauriRuntime()} __TAURI_INTERNALS__=${typeof window !== "undefined" && window.__TAURI_INTERNALS__ ? "present" : "missing"}`);

function createMockApi() {
  let songs = [...sampleSongs];
  let savedSettings: AiSettings = {
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "",
    audioFormat: DEFAULT_AUDIO_FORMAT,
    apiKeyStoredInKeychain: true
  };
  const session = {
    id: "default",
    title: "默认会话",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  let messages: ChatMessage[] = [];

  function buildChatMessage(
    id: string,
    input: AppendChatMessageInput | (UpdateChatMessageInput & { sessionId: string; role: ChatMessage["role"]; createdAt: string })
  ): ChatMessage {
    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      status: input.status,
      metadata: input.metadata,
      createdAt: "createdAt" in input ? input.createdAt : new Date().toISOString()
    };
  }

  return {
    checkTools: async (): Promise<ToolStatus> => ({
      ytDlpAvailable: false,
      ffmpegAvailable: false
    }),
    saveAiSettings: async (settings: AiSettings) => {
      savedSettings = settings;
    },
    loadAiSettings: async () => savedSettings,
    listModels: async () => ["deepseek-chat", "gpt-4.1-mini", "自定义模型"],
    searchBilibili: async () => sampleResults,
    rankCandidatesWithAi: async (query: string, results: BiliSearchResult[]) =>
      createFallbackCandidates(query, results),
    loadCoverDataUrl: async (url: string) => url,
    resolvePreviewStream: async () => "",
    loadSongDataUrl: async () => "",
    loadChatSession: async () => ({
      session,
      messages
    }),
    clearChatMessages: async () => {
      messages = [];
    },
    appendChatMessage: async (message: AppendChatMessageInput) => {
      const appended = buildChatMessage(`msg-${Date.now()}-${messages.length + 1}`, message);
      messages = [...messages, appended];
      session.updatedAt = appended.createdAt;
      return appended;
    },
    updateChatMessage: async (message: UpdateChatMessageInput) => {
      const existing = messages.find((item) => item.id === message.id);
      if (!existing) {
        throw new Error("消息不存在");
      }

      const updated = buildChatMessage(existing.id, {
        ...message,
        sessionId: existing.sessionId,
        role: existing.role,
        createdAt: existing.createdAt
      });
      messages = messages.map((item) => (item.id === existing.id ? updated : item));
      session.updatedAt = new Date().toISOString();
      return updated;
    },
    convertAudio: async (candidate: CandidateTrack) => {
      const existingSong = songs.find((song) => song.id === candidate.sourceResult.id);
      if (existingSong) {
        return existingSong;
      }

      const metadata = cleanSongMetadata(candidate.sourceResult.title, candidate.sourceResult.author);
      const audioFormat = savedSettings.audioFormat;
      const song: Song = {
        id: candidate.sourceResult.id,
        title: metadata.title,
        artist: metadata.artist,
        sourceTitle: metadata.sourceTitle,
        sourceAuthor: metadata.sourceAuthor,
        sourceUrl: candidate.sourceResult.url,
        coverUrl: candidate.sourceResult.coverUrl,
        localPath: `/Users/a0000/Music/Needle/${candidate.sourceResult.title}.${audioFormat}`,
        audioFormat,
        durationSeconds: candidate.sourceResult.durationSeconds,
        createdAt: new Date().toISOString()
      };
      songs = [song, ...songs];
      return song;
    },
    listSongs: async () => songs,
    updateSongMetadata: async (songId: string, title: string, artist: string) => {
      const existingSong = songs.find((song) => song.id === songId);
      if (!existingSong) {
        throw new Error("歌曲不存在");
      }

      const updatedSong: Song = {
        ...existingSong,
        title,
        artist
      };
      songs = songs.map((song) => (song.id === songId ? updatedSong : song));
      return updatedSong;
    },
    deleteSong: async (songId: string): Promise<DeleteResult> => {
      const hadSong = songs.some((song) => song.id === songId);
      songs = songs.filter((song) => song.id !== songId);
      return {
        songId,
        fileDeleted: hadSong ? true : null,
        dbRowDeleted: hadSong
      };
    },
    showInFinder: async () => undefined
  };
}

export const needleApi = runtimeMode === "tauri"
  ? createNeedleApi(tauriInvoke)
  : createMockApi();
