import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ExternalLink, Folder, Music2, Pause, Pencil, Play, Search, Settings, Trash2 } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { buildToolMessage } from "./domain/tools";
import {
  createAssistantMessageInput,
  createAssistantMessageUpdate,
  createStoppedAssistantMessageUpdate,
  createUserMessageInput
} from "./domain/chat";
import {
  buildContinuationCandidateMessage,
  findLatestCandidateMessage,
  isContinuationCandidateRequest,
  resolveVisibleCandidateCount,
  resolveVisibleCandidates
} from "./domain/candidateDisplay";
import {
  buildModelOptionItems,
  CUSTOM_MODEL_OPTION_VALUE,
  DEFAULT_AUDIO_FORMAT,
  maskApiKey,
  normalizeAudioFormat,
  resolveModelSelectionState,
  resolveSelectedModelValue
} from "./domain/aiSettings";
import { createFallbackCandidates } from "./domain/candidates";
import { buildHybridCandidates } from "./domain/ranking";
import {
  createPendingDeleteSong,
  getDeleteConfirmMessage
} from "./domain/deleteConfirm";
import { getDeleteErrorMessage, parseDeleteError } from "./domain/delete";
import { getErrorMessage } from "./domain/errors";
import {
  formatSearchStageAssistantContent,
  formatSearchStageStatus
} from "./domain/searchStatus";
import {
  calculateProgressPercent,
  calculateSeekTime,
  createAudioPlayerKey,
  formatPlaybackTime
} from "./domain/playback";
import {
  appendDebugLogEntry,
  formatDebugLogDetails,
  formatDebugLogTime,
  serializeDebugLogs
} from "./domain/debugLog";
import { isChatNearBottom } from "./domain/chatScroll";
import { cleanSongMetadata } from "./domain/songMetadata";
import { normalizeSongMetadataDraft, validateSongMetadataDraft } from "./domain/songEditor";
import { needleApi, runtimeMode } from "./api";
import type { AudioFormat, CandidateTrack, ChatMessage, Song, ToolStatus } from "./types";
import type { PendingDeleteSong } from "./domain/deleteConfirm";
import type { DebugLogEntry, DebugLogLevel, DebugLogSource } from "./domain/debugLog";

function openExternalUrl(url: string) {
  if (window.__TAURI_INTERNALS__) {
    shellOpen(url).catch(() => window.open(url, "_blank"));
    return;
  }

  window.open(url, "_blank");
}

type View = "find" | "library" | "settings";

type NowPlayingInfo = {
  title: string;
  subtitle: string;
  coverUrl: string;
};

const DEFAULT_NOW_PLAYING_INFO: NowPlayingInfo = {
  title: "还没有播放歌曲",
  subtitle: "AI 找到的视频源 · 本地转音频",
  coverUrl: ""
};

const coverDataUrlCache = new Map<string, string>();
const SONG_SOURCE_LABEL = "B站";
const SONG_LOCAL_LABEL = "本地已保存";

function formatAudioFormatLabel(audioFormat: AudioFormat): string {
  return audioFormat.toUpperCase();
}

export function createNowPlayingInfoFromSong(song: Song): NowPlayingInfo {
  return {
    title: song.title,
    subtitle: song.artist,
    coverUrl: song.coverUrl
  };
}

export function createNowPlayingInfoFromCandidate(candidate: CandidateTrack): NowPlayingInfo {
  const metadata = cleanSongMetadata(candidate.sourceResult.title, candidate.sourceResult.author);

  return {
    title: metadata.title,
    subtitle: `${metadata.artist} · 试听`,
    coverUrl: candidate.sourceResult.coverUrl
  };
}

function CoverArt({ className, coverUrl }: { className: string; coverUrl: string }) {
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (!coverUrl) {
      setResolvedCoverUrl("");
      return () => {
        cancelled = true;
      };
    }

    if (runtimeMode !== "tauri") {
      setResolvedCoverUrl(coverUrl);
      return () => {
        cancelled = true;
      };
    }

    const cachedCoverUrl = coverDataUrlCache.get(coverUrl);
    if (cachedCoverUrl) {
      setResolvedCoverUrl(cachedCoverUrl);
      return () => {
        cancelled = true;
      };
    }

    setResolvedCoverUrl("");
    void needleApi.loadCoverDataUrl(coverUrl)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }

        coverDataUrlCache.set(coverUrl, dataUrl);
        setResolvedCoverUrl(dataUrl);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setResolvedCoverUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return (
    <div
      className={className}
      style={{ backgroundImage: resolvedCoverUrl ? `url(${resolvedCoverUrl})` : "" }}
    />
  );
}

export function App() {
  const [view, setView] = useState<View>("find");
  const [queryInput, setQueryInput] = useState("");
  const [chatSessionId, setChatSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingClearChat, setPendingClearChat] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [convertingIds, setConvertingIds] = useState<Set<string>>(() => new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteSong, setPendingDeleteSong] = useState<PendingDeleteSong | null>(null);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingArtist, setEditingArtist] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [toolStatus, setToolStatus] = useState<ToolStatus>({
    ytDlpAvailable: false,
    ffmpegAvailable: false
  });
  const [status, setStatus] = useState("准备就绪");
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [nowPlayingInfo, setNowPlayingInfo] = useState<NowPlayingInfo>(DEFAULT_NOW_PLAYING_INFO);
  const [playerSrc, setPlayerSrc] = useState("");
  const [playerInstanceId, setPlayerInstanceId] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerInstanceCounterRef = useRef(0);
  const debugLogIdRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const wasPlayingBeforeSeekRef = useRef(false);
  const chatAreaRef = useRef<HTMLDivElement | null>(null);
  const forceChatScrollRef = useRef(false);
  const isChatNearBottomRef = useRef(false);
  const chatScrollFrameRef = useRef<number | null>(null);
  const chatScrollFrame2Ref = useRef<number | null>(null);
  const searchRunIdRef = useRef(0);
  const activeSearchRef = useRef<{
    runId: number;
    query: string;
    pendingAssistantMessage: ChatMessage | null;
  } | null>(null);
  const [settingsState, setSettingsState] = useState({
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "",
    audioFormat: DEFAULT_AUDIO_FORMAT as AudioFormat,
    selectedModelOption: "",
    customModel: "",
    models: [] as string[]
  });
  const audioKey = createAudioPlayerKey(playerInstanceId);

  useEffect(() => {
    void initializeApp().catch((error) => {
      setStatus(`初始化失败：${getErrorMessage(error)}`);
    });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onDurationChange = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onSeeked = () => {
      setCurrentTime(audio.currentTime);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [audioKey]);

  useEffect(() => {
    if (!playerSrc && !activeSong) {
      setNowPlayingInfo(DEFAULT_NOW_PLAYING_INFO);
    }
  }, [activeSong, playerSrc]);

  const updateChatBottomState = useCallback(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) {
      return;
    }

    isChatNearBottomRef.current = isChatNearBottom(
      chatArea.scrollHeight,
      chatArea.scrollTop,
      chatArea.clientHeight
    );
  }, []);

  const scrollChatToBottom = useCallback(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) {
      return;
    }

    if (chatScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatScrollFrameRef.current);
      chatScrollFrameRef.current = null;
    }
    if (chatScrollFrame2Ref.current !== null) {
      window.cancelAnimationFrame(chatScrollFrame2Ref.current);
      chatScrollFrame2Ref.current = null;
    }

    chatScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollFrameRef.current = null;
      chatScrollFrame2Ref.current = window.requestAnimationFrame(() => {
        chatScrollFrame2Ref.current = null;
        const shouldScroll = forceChatScrollRef.current || isChatNearBottomRef.current;
        forceChatScrollRef.current = false;

        if (!shouldScroll) {
          return;
        }

        const latestChatArea = chatAreaRef.current;
        if (!latestChatArea) {
          return;
        }

        const nextTop = Math.max(0, latestChatArea.scrollHeight - latestChatArea.clientHeight);
        latestChatArea.scrollTo({
          top: nextTop,
          behavior: "auto"
        });
        isChatNearBottomRef.current = true;
      });
    });
  }, []);

  useEffect(() => {
    if (view === "find") {
      return;
    }

    forceChatScrollRef.current = false;
    isChatNearBottomRef.current = false;

    if (chatScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatScrollFrameRef.current);
      chatScrollFrameRef.current = null;
    }
    if (chatScrollFrame2Ref.current !== null) {
      window.cancelAnimationFrame(chatScrollFrame2Ref.current);
      chatScrollFrame2Ref.current = null;
    }
  }, [view]);

  useEffect(() => {
    if (view !== "find") {
      return;
    }

    if (!forceChatScrollRef.current && !isChatNearBottomRef.current) {
      return;
    }

    scrollChatToBottom();

    return () => {
      if (chatScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(chatScrollFrameRef.current);
        chatScrollFrameRef.current = null;
      }
      if (chatScrollFrame2Ref.current !== null) {
        window.cancelAnimationFrame(chatScrollFrame2Ref.current);
        chatScrollFrame2Ref.current = null;
      }
    };
  }, [messages, scrollChatToBottom, view]);

  function pushDebugLog(
    level: DebugLogLevel,
    source: DebugLogSource,
    message: string,
    details?: unknown
  ) {
    const nextId = debugLogIdRef.current + 1;
    debugLogIdRef.current = nextId;

    const entry: DebugLogEntry = {
      id: `debug-log-${nextId}`,
      time: formatDebugLogTime(),
      level,
      source,
      message,
      details
    };

    setDebugLogs((current) => appendDebugLogEntry(current, entry));
  }

  async function refreshRuntimeState(selectFirstSong = false) {
    pushDebugLog("info", "tauri", "工具检测开始");
    pushDebugLog("info", "library", "歌曲库加载开始");

    try {
      const [tools, library] = await Promise.all([needleApi.checkTools(), needleApi.listSongs()]);
      setToolStatus(tools);
      setSongs(library);
      setActiveSong((current) => {
        if (selectFirstSong) {
          return library[0] ?? null;
        }

        if (!current) {
          return current;
        }

        return library.find((item) => item.id === current.id) ?? null;
      });
      pushDebugLog("info", "tauri", "工具检测成功", tools);
      pushDebugLog("info", "library", "歌曲库加载成功", { count: library.length });
      return library;
    } catch (error) {
      pushDebugLog("error", "tauri", "工具检测或歌曲库加载失败", {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async function initializeApp() {
    pushDebugLog("info", "frontend", "App 初始化开始");

    try {
      const [library] = await Promise.all([
        refreshRuntimeState(true),
        (async () => {
          pushDebugLog("info", "settings", "读取设置开始");
          try {
            const savedSettings = await needleApi.loadAiSettings();
            setSettingsState((current) => ({
              ...current,
              ...resolveModelSelectionState(current.models, savedSettings.model),
              providerName: savedSettings.providerName,
              baseUrl: savedSettings.baseUrl,
              model: savedSettings.model,
              audioFormat: normalizeAudioFormat(savedSettings.audioFormat)
            }));
            pushDebugLog("info", "settings", "读取设置成功", {
              providerName: savedSettings.providerName,
              audioFormat: savedSettings.audioFormat
            });
          } catch (error) {
            pushDebugLog("info", "settings", "读取设置跳过", {
              error: getErrorMessage(error)
            });
          }
        })(),
        (async () => {
          pushDebugLog("info", "tauri", "聊天会话加载开始");
          try {
            const chatState = await needleApi.loadChatSession();
            setChatSessionId(chatState.session.id);
            setMessages(chatState.messages);
            pushDebugLog("info", "tauri", "聊天会话加载成功", {
              sessionId: chatState.session.id,
              messageCount: chatState.messages.length
            });
          } catch (error) {
            pushDebugLog("error", "tauri", "聊天会话加载失败", {
              error: getErrorMessage(error)
            });
            throw error;
          }
        })()
      ]);

      pushDebugLog("info", "frontend", "App 初始化完成", {
        libraryCount: library.length
      });
      return library;
    } catch (error) {
      pushDebugLog("error", "frontend", "App 初始化失败", {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  function appendLocalMessage(message: ChatMessage) {
    setMessages((current) => [...current, message]);
  }

  function replaceLocalMessage(message: ChatMessage) {
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? message : item))
    );
  }

  function upsertLocalMessage(message: ChatMessage) {
    setMessages((current) => {
      const exists = current.some((item) => item.id === message.id);
      if (!exists) {
        return [...current, message];
      }

      return current.map((item) => (item.id === message.id ? message : item));
    });
  }

  function isSearchRunActive(runId: number) {
    return activeSearchRef.current?.runId === runId;
  }

  async function stopActiveSearch() {
    const activeSearch = activeSearchRef.current;
    if (!activeSearch) {
      return;
    }

    searchRunIdRef.current += 1;
    activeSearchRef.current = null;
    setIsSearching(false);
    setStatus("已停止本次查找");
    pushDebugLog("info", "frontend", "用户停止本次查找", {
      query: activeSearch.query
    });

    if (!activeSearch.pendingAssistantMessage) {
      return;
    }

    upsertLocalMessage({
      ...activeSearch.pendingAssistantMessage,
      ...createStoppedAssistantMessageUpdate(activeSearch.query)
    });

    try {
      const assistantMessage = await needleApi.updateChatMessage({
        id: activeSearch.pendingAssistantMessage.id,
        ...createStoppedAssistantMessageUpdate(activeSearch.query)
      });
      replaceLocalMessage(assistantMessage);
    } catch (error) {
      pushDebugLog("error", "frontend", "停止消息更新失败", {
        error: getErrorMessage(error)
      });
    }
  }

  function handleSearchButtonClick() {
    if (isSearching) {
      void stopActiveSearch();
      return;
    }

    void handleSearch();
  }

  async function handleSearch() {
    const searchQuery = queryInput.trim();
    if (!searchQuery) {
      setStatus("先输入你想听什么");
      return;
    }

    if (!chatSessionId) {
      setStatus("聊天初始化中，请稍后再试");
      return;
    }

    const isContinuation = isContinuationCandidateRequest(searchQuery);
    let runId = 0;

    if (!isContinuation) {
      runId = searchRunIdRef.current + 1;
      searchRunIdRef.current = runId;
      activeSearchRef.current = {
        runId,
        query: searchQuery,
        pendingAssistantMessage: null
      };

      setIsSearching(true);
      setStatus("正在搜索 B 站公开视频");
      pushDebugLog("info", "frontend", "开始搜索", { query: searchQuery });
    }

    forceChatScrollRef.current = true;
    setQueryInput("");
    try {
      const userMessage = await needleApi.appendChatMessage(
        createUserMessageInput(chatSessionId, searchQuery)
      );
      appendLocalMessage(userMessage);

      if (isContinuation) {
        try {
          const continuationMessage = buildContinuationCandidateMessage({
            query: searchQuery,
            previousMessage: findLatestCandidateMessage(messages)
          });
          const assistantMessage = await needleApi.appendChatMessage(
            createAssistantMessageInput(
              chatSessionId,
              continuationMessage.content,
              "completed",
              continuationMessage.metadata
            )
          );
          appendLocalMessage(assistantMessage);
          setStatus(continuationMessage.content);
          pushDebugLog("info", "frontend", "继续展示候选", {
            query: searchQuery,
            kind: continuationMessage.kind
          });
        } catch (error) {
          pushDebugLog("error", "frontend", "继续展示候选失败", {
            query: searchQuery,
            error: getErrorMessage(error)
          });
          setStatus("继续展示候选失败");
        }
        return;
      }

      const pendingAssistantMessage = await needleApi.appendChatMessage(
        createAssistantMessageInput(
          chatSessionId,
          "我先去找 B 站候选，再帮你整理试听和转换入口。",
          "pending",
          { query: searchQuery }
        )
      );
      activeSearchRef.current = {
        runId,
        query: searchQuery,
        pendingAssistantMessage
      };
      if (!isSearchRunActive(runId)) {
        activeSearchRef.current = null;
        await needleApi.updateChatMessage({
          id: pendingAssistantMessage.id,
          ...createStoppedAssistantMessageUpdate(searchQuery)
        });
        upsertLocalMessage({
          ...pendingAssistantMessage,
          ...createStoppedAssistantMessageUpdate(searchQuery)
        });
        return;
      }
      appendLocalMessage(pendingAssistantMessage);

      const results = await needleApi.searchBilibili(searchQuery);
      if (!isSearchRunActive(runId)) {
        activeSearchRef.current = null;
        return;
      }
      pushDebugLog("info", "bilibili", "B 站搜索成功", {
        query: searchQuery,
        count: results.length
      });

      // 更新 pending message：找到结果，正在筛选
      const filteringContent = formatSearchStageAssistantContent("filtering", { resultCount: results.length });
      void needleApi.updateChatMessage({
        id: pendingAssistantMessage.id,
        ...createAssistantMessageUpdate(filteringContent, "pending", { query: searchQuery })
      }).then((updated) => replaceLocalMessage(updated)).catch(() => {});
      setStatus(formatSearchStageStatus("filtering", { resultCount: results.length }));

      const fallback = createFallbackCandidates(searchQuery, results);
      try {
        pushDebugLog("info", "ai", "AI 筛选开始", {
          query: searchQuery,
          count: results.length
        });

        // 更新 pending message：AI 排序中
        const rankingContent = formatSearchStageAssistantContent("ranking");
        void needleApi.updateChatMessage({
          id: pendingAssistantMessage.id,
          ...createAssistantMessageUpdate(rankingContent, "pending", { query: searchQuery })
        }).then((updated) => replaceLocalMessage(updated)).catch(() => {});
        setStatus(formatSearchStageStatus("ranking"));
        const aiRanked = await needleApi.rankCandidatesWithAi(searchQuery, results);
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        const ranked = buildHybridCandidates(searchQuery, results, aiRanked);
        pushDebugLog("info", "ai", "AI 筛选成功", {
          query: searchQuery,
          count: ranked.length
        });
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        const visibleCandidateCount = resolveVisibleCandidateCount(searchQuery, ranked.length);
        const assistantMessage = await needleApi.updateChatMessage({
          id: pendingAssistantMessage.id,
          ...createAssistantMessageUpdate(
            `找到 ${ranked.length} 个候选，先给你最相关的 ${visibleCandidateCount} 首。`,
            "completed",
            {
              query: searchQuery,
              candidates: ranked,
              visibleCandidateCount,
              candidateStartIndex: 0
            }
          )
        });
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        replaceLocalMessage(assistantMessage);
        setStatus(`找到 ${ranked.length} 个候选，先给你最相关的 ${visibleCandidateCount} 首。`);
      } catch {
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        pushDebugLog("warn", "ai", "AI 筛选失败，已启用本地规则兜底", {
          query: searchQuery,
          count: fallback.length
        });
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        const visibleCandidateCount = resolveVisibleCandidateCount(searchQuery, fallback.length);
        const assistantMessage = await needleApi.updateChatMessage({
          id: pendingAssistantMessage.id,
          ...createAssistantMessageUpdate(
            `AI 筛选失败，已用本地规则排序候选。先给你最相关的 ${visibleCandidateCount} 首。`,
            "completed",
            {
              query: searchQuery,
              candidates: fallback,
              visibleCandidateCount,
              candidateStartIndex: 0
            }
          )
        });
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        replaceLocalMessage(assistantMessage);
        setStatus(`AI 筛选失败，已用本地规则排序候选。先给你最相关的 ${visibleCandidateCount} 首。`);
      }
    } catch (error) {
      if (!isSearchRunActive(runId)) {
        activeSearchRef.current = null;
        return;
      }
      const rawErrorMessage = getErrorMessage(error);
      pushDebugLog("error", "bilibili", "B 站搜索失败", {
        query: searchQuery,
        error: rawErrorMessage
      });
      const message = formatSearchStageAssistantContent("error", { errorMessage: rawErrorMessage });
      setStatus(formatSearchStageStatus("error", { errorMessage: rawErrorMessage }));
      const pendingAssistantMessage = activeSearchRef.current?.pendingAssistantMessage;
      if (pendingAssistantMessage) {
        if (!isSearchRunActive(runId)) {
          activeSearchRef.current = null;
          return;
        }
        try {
          const assistantMessage = await needleApi.updateChatMessage({
            id: pendingAssistantMessage.id,
            ...createAssistantMessageUpdate(message, "failed", {
              query: searchQuery
            })
          });
          if (!isSearchRunActive(runId)) {
            activeSearchRef.current = null;
            return;
          }
          replaceLocalMessage(assistantMessage);
        } catch (updateError) {
          pushDebugLog("error", "frontend", "失败消息更新失败", {
            error: getErrorMessage(updateError)
          });
        }
      } else if (chatSessionId) {
        try {
          if (!isSearchRunActive(runId)) {
            activeSearchRef.current = null;
            return;
          }
          const assistantMessage = await needleApi.appendChatMessage(
            createAssistantMessageInput(chatSessionId, message, "failed", {
              query: searchQuery
            })
          );
          if (!isSearchRunActive(runId)) {
            activeSearchRef.current = null;
            return;
          }
          appendLocalMessage(assistantMessage);
        } catch (appendError) {
          pushDebugLog("error", "frontend", "失败消息追加失败", {
            error: getErrorMessage(appendError)
          });
        }
      }
      setStatus(message);
    } finally {
      if (isSearchRunActive(runId)) {
        activeSearchRef.current = null;
        setIsSearching(false);
      }
    }
  }

  function handleQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    if (isSearching) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    void handleSearch();
  }

  async function handlePreview(candidate: CandidateTrack) {
    pushDebugLog("info", "preview", "开始试听", {
      title: candidate.sourceResult.title,
      author: candidate.sourceResult.author
    });
    setStatus("正在准备试听");
    try {
      const url = await needleApi.resolvePreviewStream(candidate.sourceResult.url);
      if (!url) {
        pushDebugLog("error", "preview", "试听失败", {
          title: candidate.sourceResult.title,
          reason: "未返回可播放地址"
        });
        setStatus("App 内试听失败，可以打开 B 站原视频确认");
        return;
      }

      const nextPlayerInstanceId = playerInstanceCounterRef.current + 1;
      playerInstanceCounterRef.current = nextPlayerInstanceId;
      setPlayerInstanceId(nextPlayerInstanceId);
      setActiveSong(null);
      setNowPlayingInfo(createNowPlayingInfoFromCandidate(candidate));
      setPlayerSrc(url);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      pushDebugLog("info", "preview", "试听成功", {
        title: candidate.sourceResult.title
      });
      setStatus("正在试听");
    } catch (error) {
      pushDebugLog("error", "preview", "试听失败", {
        title: candidate.sourceResult.title,
        error: getErrorMessage(error)
      });
      setStatus(`试听失败：${getErrorMessage(error)}。可以打开 B 站原视频确认`);
    }
  }

  async function handleConvert(candidate: CandidateTrack) {
    const candidateId = candidate.sourceResult.id;
    if (convertingIds.has(candidateId)) {
      return;
    }

    const existingSong = songs.find((song) => song.id === candidateId);
    if (existingSong) {
      pushDebugLog("info", "convert", "已存在直接播放", {
        songId: existingSong.id,
        title: existingSong.title
      });
      await playSong(existingSong);
      setStatus("这首已经在我的歌曲里，已直接播放");
      return;
    }

    setConvertingIds((current) => new Set(current).add(candidateId));
    pushDebugLog("info", "convert", "开始转换", {
      title: candidate.sourceResult.title,
      sourceId: candidateId,
      audioFormat: settingsState.audioFormat
    });
    setStatus(`正在转为 ${formatAudioFormatLabel(settingsState.audioFormat)}`);
    try {
      const song = await needleApi.convertAudio(candidate);
      setSongs((current) => [song, ...current.filter((item) => item.id !== song.id)]);
      pushDebugLog("info", "convert", "转换成功", {
        songId: song.id,
        title: song.title,
        autoPlay: false
      });
      setStatus("已加入我的歌曲，当前播放不会被打断");
    } catch (error) {
      pushDebugLog("error", "convert", "转换失败", {
        title: candidate.sourceResult.title,
        error: getErrorMessage(error)
      });
      setStatus(`转换失败：${getErrorMessage(error)}`);
    } finally {
      setConvertingIds((current) => {
        const next = new Set(current);
        next.delete(candidateId);
        return next;
      });
    }
  }

  function handleDeleteRequest(song: Song) {
    if (deletingIds.has(song.id)) {
      return;
    }

    const currentActiveSongId = activeSong?.id ?? null;
    const pendingSong = createPendingDeleteSong(song, currentActiveSongId);
    pushDebugLog("info", "library", "请求删除", {
      songId: pendingSong.id,
      title: pendingSong.title,
      isCurrentPlaying: pendingSong.isCurrentPlaying
    });
    setPendingDeleteSong(pendingSong);
  }

  function handleEditRequest(song: Song) {
    const draft = normalizeSongMetadataDraft(song.title, song.artist);
    setEditingSong(song);
    setEditingTitle(draft.title);
    setEditingArtist(draft.artist);
    pushDebugLog("info", "library", "打开歌曲编辑", {
      songId: song.id,
      title: song.title,
      artist: song.artist
    });
  }

  function handleEditCancel() {
    if (!editingSong) {
      return;
    }

    pushDebugLog("info", "library", "取消歌曲编辑", {
      songId: editingSong.id,
      title: editingSong.title
    });
    setEditingSong(null);
    setEditingTitle("");
    setEditingArtist("");
  }

  async function handleEditSave() {
    if (!editingSong) {
      return;
    }

    const validationError = validateSongMetadataDraft(editingTitle, editingArtist);
    if (validationError) {
      setStatus(validationError);
      return;
    }

    const draft = normalizeSongMetadataDraft(editingTitle, editingArtist);
    pushDebugLog("info", "library", "保存歌曲编辑开始", {
      songId: editingSong.id,
      title: draft.title,
      artist: draft.artist
    });

    try {
      const updatedSong = await needleApi.updateSongMetadata(
        editingSong.id,
        draft.title,
        draft.artist
      );
      setSongs((current) =>
        current.map((song) => (song.id === updatedSong.id ? updatedSong : song))
      );

      if (activeSong?.id === updatedSong.id) {
        setActiveSong(updatedSong);
        setNowPlayingInfo(createNowPlayingInfoFromSong(updatedSong));
      }

      setEditingSong(null);
      setEditingTitle("");
      setEditingArtist("");
      setStatus("歌曲信息已更新");
      pushDebugLog("info", "library", "保存歌曲编辑成功", {
        songId: updatedSong.id,
        title: updatedSong.title,
        artist: updatedSong.artist
      });
    } catch (error) {
      pushDebugLog("error", "library", "保存歌曲编辑失败", {
        songId: editingSong.id,
        error: getErrorMessage(error)
      });
      setStatus(`保存失败：${getErrorMessage(error)}`);
    }
  }

  function handleDeleteCancel() {
    if (!pendingDeleteSong) {
      return;
    }

    pushDebugLog("info", "library", "取消删除", {
      songId: pendingDeleteSong.id,
      title: pendingDeleteSong.title
    });
    setPendingDeleteSong(null);
  }

  async function handleDeleteConfirm() {
    const song = pendingDeleteSong;
    if (!song || deletingIds.has(song.id)) {
      return;
    }

    setPendingDeleteSong(null);
    const shouldClearPlayer = song.isCurrentPlaying;
    setDeletingIds((current) => new Set(current).add(song.id));
    setStatus(`正在删除：${song.title}`);
    pushDebugLog("info", "library", "删除开始", {
      songId: song.id,
      title: song.title,
      isCurrentPlaying: shouldClearPlayer
    });

    try {
      const result = await needleApi.deleteSong(song.id);
      pushDebugLog("info", "library", "删除成功", {
        songId: song.id,
        title: song.title,
        isCurrentPlaying: shouldClearPlayer,
        result
      });
      setSongs((current) => current.filter((item) => item.id !== song.id));

      if (shouldClearPlayer) {
        audioRef.current?.pause();
        setPlayerSrc("");
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        setIsSeeking(false);
        setActiveSong(null);
        setNowPlayingInfo(DEFAULT_NOW_PLAYING_INFO);
      }

      setStatus(`已删除：${song.title}`);
      void refreshRuntimeState(false)
        .then((refreshedSongs) => {
          pushDebugLog("info", "library", "歌曲库刷新成功", {
            songId: song.id,
            count: refreshedSongs.length
          });
        })
        .catch((error) => {
          pushDebugLog("error", "library", "歌曲库刷新失败", {
            songId: song.id,
            error: getErrorMessage(error)
          });
        });
    } catch (error) {
      const deleteError = parseDeleteError(error);
      pushDebugLog("error", "library", "删除失败", {
        songId: song.id,
        title: song.title,
        isCurrentPlaying: shouldClearPlayer,
        error: getErrorMessage(error),
        deleteError
      });
      setStatus(deleteError ? getDeleteErrorMessage(deleteError) : `删除失败：${getErrorMessage(error)}`);
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(song.id);
        return next;
      });
    }
  }

  async function handleFetchModels() {
    pushDebugLog("info", "settings", "获取模型开始", {
      providerName: settingsState.providerName,
      baseUrl: settingsState.baseUrl
    });
    setStatus("正在获取模型列表");
    try {
      pushDebugLog("info", "settings", "保存设置开始", {
        providerName: settingsState.providerName,
        baseUrl: settingsState.baseUrl
      });
      await needleApi.saveAiSettings(
        {
          providerName: settingsState.providerName,
          baseUrl: settingsState.baseUrl,
          model: settingsState.model,
          audioFormat: settingsState.audioFormat,
          apiKeyStoredInKeychain: true
        },
        settingsState.apiKey
      );
      pushDebugLog("info", "settings", "保存设置成功", {
        providerName: settingsState.providerName,
        baseUrl: settingsState.baseUrl
      });
      const models = await needleApi.listModels();
      setSettingsState((current) => ({
        ...current,
        models,
        ...resolveModelSelectionState(models, current.model)
      }));
      pushDebugLog("info", "settings", "获取模型成功", {
        count: models.length
      });
      setStatus(models.length > 0 ? "模型列表已更新" : "没有获取到模型，可切到自定义模型手动填写");
    } catch (error) {
      pushDebugLog("error", "settings", "获取模型失败", {
        error: getErrorMessage(error)
      });
      setStatus(`获取模型失败：${getErrorMessage(error)}。可切到自定义模型手动填写`);
    }
  }

  async function handleSaveSettings() {
    pushDebugLog("info", "settings", "保存设置开始", {
      providerName: settingsState.providerName,
      baseUrl: settingsState.baseUrl
    });
    try {
      await needleApi.saveAiSettings(
        {
          providerName: settingsState.providerName,
          baseUrl: settingsState.baseUrl,
          model: resolveSelectedModelValue(
            settingsState.selectedModelOption,
            settingsState.customModel
          ),
          audioFormat: settingsState.audioFormat,
          apiKeyStoredInKeychain: true
        },
        settingsState.apiKey
      );
      pushDebugLog("info", "settings", "保存设置成功", {
        providerName: settingsState.providerName,
        baseUrl: settingsState.baseUrl
      });
      setStatus("AI 设置已保存");
    } catch (error) {
      pushDebugLog("error", "settings", "保存设置失败", {
        error: getErrorMessage(error)
      });
      setStatus(`AI 设置保存失败：${getErrorMessage(error)}`);
    }
  }

  async function playSong(song: Song) {
    setActiveSong(song);
    setNowPlayingInfo(createNowPlayingInfoFromSong(song));
    setStatus(`正在加载：${song.title}`);
    try {
      const src = await needleApi.loadSongDataUrl(song.localPath);
      const nextPlayerInstanceId = playerInstanceCounterRef.current + 1;
      playerInstanceCounterRef.current = nextPlayerInstanceId;
      setPlayerInstanceId(nextPlayerInstanceId);
      setPlayerSrc(src);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      setStatus(`正在播放：${song.title}`);
    } catch (error) {
      setStatus(`播放失败：${getErrorMessage(error)}`);
    }
  }

  function handlePlayerButton() {
    if (!playerSrc) {
      if (activeSong) {
        void playSong(activeSong);
        return;
      }

      setStatus("还没有可播放音频");
      return;
    }

    if (audioRef.current?.paused) {
      audioRef.current?.play().catch((error: unknown) => {
        setStatus(`播放失败：${getErrorMessage(error)}`);
      });
      return;
    }

    audioRef.current?.pause();
  }

  function handleProgressPointerDown() {
    if (!audioRef.current || !playerSrc || duration <= 0) {
      return;
    }

    wasPlayingBeforeSeekRef.current = !audioRef.current.paused;
    setIsSeeking(true);
  }

  function handleProgressPointerUp() {
    if (!audioRef.current || !playerSrc || duration <= 0) {
      setIsSeeking(false);
      return;
    }

    setIsSeeking(false);
    if (wasPlayingBeforeSeekRef.current) {
      audioRef.current.play().catch((error: unknown) => {
        setStatus(`播放失败：${getErrorMessage(error)}`);
      });
    }
  }

  function handleProgressChange(event: ChangeEvent<HTMLInputElement>) {
    if (!audioRef.current || !playerSrc || duration <= 0) {
      return;
    }

    const percent = Number(event.target.value);
    const nextTime = calculateSeekTime(percent, duration);
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  async function handleCopyDebugLogs() {
    if (debugLogs.length === 0) {
      setStatus("没有可复制的调试日志");
      return;
    }

    const text = serializeDebugLogs(debugLogs);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境不支持剪贴板");
      }

      await navigator.clipboard.writeText(text);
      setStatus("调试日志已复制");
    } catch (error) {
      setStatus(`复制日志失败：${getErrorMessage(error)}`);
    }
  }

  function handleClearDebugLogs() {
    setDebugLogs([]);
    setStatus("调试日志已清空");
  }

  function handleClearChatRequest() {
    setPendingClearChat(true);
  }

  function handleClearChatCancel() {
    setPendingClearChat(false);
  }

  async function handleClearChatConfirm() {
    if (!chatSessionId) {
      setPendingClearChat(false);
      return;
    }

    setPendingClearChat(false);
    pushDebugLog("info", "frontend", "清空聊天开始", {
      sessionId: chatSessionId,
      messageCount: messages.length
    });

    try {
      await needleApi.clearChatMessages();
      setMessages([]);
      setStatus("聊天已清空");
      pushDebugLog("info", "frontend", "聊天已清空", {
        sessionId: chatSessionId
      });
    } catch (error) {
      pushDebugLog("error", "frontend", "清空聊天失败", {
        error: getErrorMessage(error)
      });
      setStatus(`清空聊天失败：${getErrorMessage(error)}`);
    }
  }

  const toolMessage = useMemo(() => buildToolMessage(toolStatus), [toolStatus]);
  const visibleDebugLogs = useMemo(() => [...debugLogs].reverse(), [debugLogs]);
  const playbackPercent = calculateProgressPercent(currentTime, duration);
  const playbackTimeLabel = `${formatPlaybackTime(currentTime)} / ${duration > 0 ? formatPlaybackTime(duration) : "0:00"}`;
  const librarySubtitle =
    songs.length > 0 ? `已收纳 ${songs.length} 首歌曲` : "先从 AI 找歌并保存到本地";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>Needle</h1>
          <p className="subtitle">AI 本地音乐助手</p>
        </div>
        <nav>
          <button className={view === "find" ? "active" : ""} onClick={() => setView("find")}>
            <Search size={18} />
            AI 找歌
          </button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            <Music2 size={18} />
            我的歌曲
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings size={18} />
            设置
          </button>
        </nav>
        <div className="tool-card">
          <strong>本机状态</strong>
          <span>{toolMessage}</span>
        </div>
      </aside>

      <main className="workspace">
        <section className="panel main-panel">
          <header className="panel-header">
            <div>
              <h2>{view === "find" ? "AI 音乐助手" : view === "library" ? "我的歌曲" : "设置"}</h2>
              <p>{view === "library" ? librarySubtitle : status}</p>
            </div>
            <span className="status-pill">
              {runtimeMode === "tauri" ? "Tauri 桌面模式" : "浏览器预览模式"}
            </span>
          </header>

          {view === "find" && (
            <div className="chat-area" ref={chatAreaRef} onScroll={updateChatBottomState}>
              {messages.length === 0 && (
                <div className="empty-state">还没有聊天记录，发一句想听的歌试试。</div>
              )}
              {messages.map((message) => (
                <ChatMessageBubble
                  key={message.id}
                  message={message}
                  convertingIds={convertingIds}
                  songs={songs}
                  onPreview={handlePreview}
                  onConvert={handleConvert}
                />
              ))}
            </div>
          )}

          {view === "library" && (
            <SongList
              songs={songs}
              activeSongId={activeSong?.id ?? null}
              deletingIds={deletingIds}
              onPlay={(song) => void playSong(song)}
              onEdit={handleEditRequest}
              onDelete={handleDeleteRequest}
            />
          )}

          {view === "settings" && (
            <div className="settings-stack">
              <section className="settings-grid">
                <label>
                  服务商
                  <select
                    value={settingsState.providerName}
                    onChange={(event) =>
                      setSettingsState((current) => ({ ...current, providerName: event.target.value }))
                    }
                  >
                    <option>DeepSeek</option>
                    <option>OpenAI 兼容</option>
                    <option>自定义</option>
                  </select>
                </label>
                <label>
                  Base URL
                  <input
                    value={settingsState.baseUrl}
                    onChange={(event) =>
                      setSettingsState((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                  />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    placeholder={settingsState.apiKey ? maskApiKey(settingsState.apiKey) : "sk-..."}
                    value={settingsState.apiKey}
                    onChange={(event) =>
                      setSettingsState((current) => ({ ...current, apiKey: event.target.value }))
                    }
                  />
                </label>
                <label>
                  转换格式
                  <select
                    value={settingsState.audioFormat}
                    onChange={(event) =>
                      setSettingsState((current) => ({
                        ...current,
                        audioFormat: normalizeAudioFormat(event.target.value)
                      }))
                    }
                  >
                    <option value="m4a">m4a</option>
                    <option value="mp3">mp3</option>
                  </select>
                </label>
                <label>
                  模型
                  <select
                    value={settingsState.selectedModelOption}
                    onChange={(event) =>
                      setSettingsState((current) => ({
                        ...current,
                        selectedModelOption: event.target.value,
                        model: resolveSelectedModelValue(event.target.value, current.customModel)
                      }))
                    }
                  >
                    <option value="" disabled>先获取模型或选择自定义模型</option>
                    {buildModelOptionItems(settingsState.models).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {settingsState.selectedModelOption === CUSTOM_MODEL_OPTION_VALUE && (
                    <input
                      value={settingsState.customModel}
                      onChange={(event) =>
                        setSettingsState((current) => ({
                          ...current,
                          customModel: event.target.value,
                          model: event.target.value
                        }))
                      }
                      placeholder="输入自定义模型名"
                    />
                  )}
                </label>
                <div className="settings-actions">
                  <button className="secondary" onClick={handleFetchModels}>获取模型</button>
                  <button onClick={handleSaveSettings}>保存并测试</button>
                </div>
              </section>

              <section className="debug-log-panel">
                <div className="debug-log-panel-header">
                  <div>
                    <h3>调试日志</h3>
                    <p>最近 {debugLogs.length} 条，最多保留 100 条</p>
                  </div>
                  <div className="debug-log-actions">
                    <button className="secondary" onClick={() => void handleCopyDebugLogs()}>
                      复制日志
                    </button>
                    <button className="secondary" onClick={handleClearDebugLogs}>
                      清空日志
                    </button>
                  </div>
                </div>

                <div className="debug-log-list">
                  {visibleDebugLogs.length === 0 ? (
                    <div className="empty-state">还没有调试日志。</div>
                  ) : (
                    visibleDebugLogs.map((entry) => (
                      <article className="debug-log-row" key={entry.id}>
                        <div className="debug-log-row-main">
                          <span className="debug-log-time">{entry.time}</span>
                          <span className={`debug-log-level level-${entry.level}`}>{entry.level}</span>
                          <span className="debug-log-source">{entry.source}</span>
                          <span className="debug-log-message">{entry.message}</span>
                        </div>
                        {entry.details !== undefined && (
                          <details className="debug-log-details">
                            <summary>详情</summary>
                            <pre>{formatDebugLogDetails(entry.details)}</pre>
                          </details>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}

          {view === "find" && (
            <footer className="prompt-bar">
              <input
                value={queryInput}
                placeholder="找一首适合夜里写代码听的粤语歌"
                onChange={(event) => setQueryInput(event.target.value)}
                onKeyDown={handleQueryKeyDown}
              />
              <button type="button" className="secondary" onClick={handleClearChatRequest}>
                清空聊天
              </button>
              <button onClick={handleSearchButtonClick}>
                {isSearching ? "停止" : "发送"}
              </button>
            </footer>
          )}
        </section>

        <aside className="panel library-panel">
          <div className="library-panel-header">
            <div>
              <h3>最近</h3>
              <span>仅保留最近 5 首</span>
            </div>
            <strong>{songs.length} 首</strong>
          </div>
          <SongList
            songs={songs.slice(0, 5)}
            totalCount={songs.length}
            activeSongId={activeSong?.id ?? null}
            deletingIds={deletingIds}
            onPlay={(song) => void playSong(song)}
            onDelete={handleDeleteRequest}
            compact
          />
        </aside>
      </main>

      {pendingDeleteSong && (
        <div className="confirm-overlay" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
            <h3 id="delete-confirm-title">确认删除</h3>
            <p>{getDeleteConfirmMessage(pendingDeleteSong.title)}</p>
            <div className="confirm-actions">
              <button type="button" className="secondary" onClick={handleDeleteCancel}>
                取消
              </button>
              <button type="button" onClick={() => void handleDeleteConfirm()}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingClearChat && (
        <div className="confirm-overlay" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-chat-title">
            <h3 id="clear-chat-title">清空聊天</h3>
            <p>清空后会删除当前聊天记录和候选历史，但不会删除已保存歌曲或本地音频文件。</p>
            <div className="confirm-actions">
              <button type="button" className="secondary" onClick={handleClearChatCancel}>
                取消
              </button>
              <button type="button" onClick={() => void handleClearChatConfirm()}>
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {editingSong && (
        <div className="confirm-overlay" role="presentation">
          <div className="confirm-dialog song-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="song-edit-title">
            <h3 id="song-edit-title">编辑歌曲信息</h3>
            <div className="song-edit-form">
              <label>
                歌名
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                />
              </label>
              <label>
                歌手
                <input
                  value={editingArtist}
                  onChange={(event) => setEditingArtist(event.target.value)}
                />
              </label>
            </div>
            <div className="song-readonly-grid">
              <div className="song-readonly-row">
                <span>来源标题</span>
                <strong>{editingSong.sourceTitle}</strong>
              </div>
              <div className="song-readonly-row">
                <span>来源 UP</span>
                <strong>{editingSong.sourceAuthor}</strong>
              </div>
            </div>
            <div className="confirm-actions">
              <button type="button" className="secondary" onClick={handleEditCancel}>
                取消
              </button>
              <button type="button" onClick={() => void handleEditSave()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className={`player ${isSeeking ? "is-seeking" : ""}`}>
        <div className="now-playing">
          <CoverArt className="cover small" coverUrl={nowPlayingInfo.coverUrl} />
          <div>
            <strong>{nowPlayingInfo.title}</strong>
            <span>{nowPlayingInfo.subtitle}</span>
          </div>
        </div>
        <div className="player-progress">
          <span className="time-label">{playbackTimeLabel}</span>
          <div className="progress-shell">
            <input
              className="progress-range"
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={duration > 0 ? playbackPercent : 0}
              disabled={!playerSrc || duration <= 0}
              onPointerDown={handleProgressPointerDown}
              onPointerUp={handleProgressPointerUp}
              onPointerCancel={handleProgressPointerUp}
              onChange={handleProgressChange}
              aria-label="播放进度"
            />
            <div className="progress-track" aria-hidden="true">
              <span className="progress-fill" style={{ width: `${playbackPercent}%` }} />
            </div>
          </div>
        </div>
        <button className="icon-button" onClick={handlePlayerButton}>
          {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        {playerSrc && (
          <audio
            key={audioKey}
            ref={audioRef}
            src={playerSrc}
            autoPlay
            onError={() => setStatus("播放失败：当前音频地址无法在播放器中打开")}
          />
        )}
      </footer>
    </div>
  );
}

function ChatMessageBubble({
  message,
  convertingIds,
  songs,
  onPreview,
  onConvert
}: {
  message: ChatMessage;
  convertingIds: Set<string>;
  songs: Song[];
  onPreview: (candidate: CandidateTrack) => void;
  onConvert: (candidate: CandidateTrack) => void;
}) {
  const candidates = resolveVisibleCandidates(message.metadata);

  return (
    <div className={`message ${message.role === "user" ? "user-message" : "ai-message"}`}>
      <div>{message.content}</div>
      {message.role === "assistant" && candidates.length > 0 && (
        <div className="candidate-list">
          {candidates.map((candidate) => (
            <CandidateCard
              key={`${message.id}-${candidate.sourceResult.id}`}
              candidate={candidate}
              isConverting={convertingIds.has(candidate.sourceResult.id)}
              isInLibrary={songs.some((song) => song.id === candidate.sourceResult.id)}
              onPreview={onPreview}
              onConvert={onConvert}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  isConverting,
  isInLibrary,
  onPreview,
  onConvert
}: {
  candidate: CandidateTrack;
  isConverting: boolean;
  isInLibrary: boolean;
  onPreview: (candidate: CandidateTrack) => void;
  onConvert: (candidate: CandidateTrack) => void;
}) {
  const metadata = cleanSongMetadata(candidate.sourceResult.title, candidate.sourceResult.author);

  return (
    <article className="candidate-card">
      <CoverArt className="cover" coverUrl={candidate.sourceResult.coverUrl} />
      <div className="candidate-info">
        <h3>{metadata.title}</h3>
        <p>{metadata.artist} · {formatDuration(candidate.sourceResult.durationSeconds)}</p>
        <span>来源：{candidate.sourceResult.author}</span>
        <span>{candidate.sourceResult.title}</span>
        <span>{candidate.matchReason} · 置信度 {Math.round(candidate.confidence * 100)}%</span>
      </div>
      <div className="candidate-actions">
        <button className="secondary" onClick={() => onPreview(candidate)}>试听</button>
        <button className="secondary" onClick={() => openExternalUrl(candidate.sourceResult.url)}>
          <ExternalLink size={15} />
          原视频
        </button>
        <button onClick={() => onConvert(candidate)} disabled={isConverting}>
          {isConverting ? "转换中" : isInLibrary ? "播放" : "转音频"}
        </button>
      </div>
    </article>
  );
}

function SongList({
  songs,
  totalCount,
  activeSongId,
  deletingIds,
  onPlay,
  onEdit,
  onDelete,
  compact = false
}: {
  songs: Song[];
  totalCount?: number;
  activeSongId?: string | null;
  deletingIds: Set<string>;
  onPlay: (song: Song) => void;
  onEdit?: (song: Song) => void;
  onDelete: (song: Song) => void;
  compact?: boolean;
}) {
  if (songs.length === 0) {
    return (
      <div className={compact ? "empty-state" : "empty-state library-empty"}>
        {compact ? "还没有歌曲，先从 AI 找歌开始。" : "还没有歌曲，先去 AI 找歌并加入这里。"}
      </div>
    );
  }

  return (
    <div className={compact ? "song-list compact" : "song-list"}>
      {!compact && (
        <div className="song-list-summary">
          <div>
            <strong>歌曲库</strong>
            <span>共 {totalCount ?? songs.length} 首</span>
          </div>
          <span className="song-list-hint">点击播放后会高亮当前歌曲</span>
        </div>
      )}
      {songs.map((song) => {
        const isDeleting = deletingIds.has(song.id);
        const isActive = activeSongId === song.id;

        return (
          <article
            className={compact ? `song-row compact${isActive ? " is-active" : ""}` : `song-row${isActive ? " is-active" : ""}`}
            key={song.id}
          >
            <CoverArt className={compact ? "cover tiny" : "cover small"} coverUrl={song.coverUrl} />
            <div className="song-main">
              <div className="song-title-row">
                <strong>{song.title}</strong>
                {!compact && isActive && <span className="song-playing-badge">正在播放</span>}
              </div>
              <span>{song.artist}</span>
              {!compact && <span className="song-source-text">来源：{song.sourceAuthor}</span>}
              {!compact && (
                <div className="song-meta-grid">
                  <div className="song-detail-row">
                    <span className="song-detail-label">时长</span>
                    <strong>{formatDuration(song.durationSeconds)}</strong>
                  </div>
                  <div className="song-detail-row">
                    <span className="song-detail-label">来源 / 状态</span>
                    <div className="song-status-pills">
                      <span className="song-chip">{SONG_SOURCE_LABEL}</span>
                      <span className="song-chip song-chip-muted">{SONG_LOCAL_LABEL}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="song-actions">
              <button
                type="button"
                className={compact ? "icon-button" : "secondary song-action-button"}
                onClick={() => onPlay(song)}
              >
                <Play size={16} />
                {!compact && "播放"}
              </button>
              {!compact && onEdit && (
                <button
                  type="button"
                  className="secondary song-action-button"
                  onClick={() => onEdit(song)}
                >
                  <Pencil size={16} />
                  编辑
                </button>
              )}
              {!compact && (
                <button
                  type="button"
                  className="secondary song-action-button"
                  onClick={() => needleApi.showInFinder(song.localPath)}
                >
                  <Folder size={16} />
                  Finder
                </button>
              )}
              <button
                type="button"
                className={compact ? "icon-button danger" : "song-action-button danger"}
                onClick={() => onDelete(song)}
                disabled={isDeleting}
                title={isDeleting ? "正在删除" : "删除"}
              >
                <Trash2 size={16} />
                {!compact && "删除"}
              </button>
            </div>
          </article>
        );
      })}
      {compact && typeof totalCount === "number" && (
        <div className="song-list-meta">共 {totalCount} 首</div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}
