import type {
  AiSettings,
  AppendChatMessageInput,
  BiliSearchResult,
  CandidateTrack,
  ChatMessage,
  DeleteResult,
  LoadChatSessionResult,
  Song,
  ToolStatus,
  UpdateChatMessageInput
} from "../types";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type DeleteSongArgs = {
  songId: string;
};
type UpdateSongMetadataArgs = {
  songId: string;
  title: string;
  artist: string;
};

export function createNeedleApi(invoke: Invoke) {
  return {
    checkTools: () => invoke<ToolStatus>("check_tools"),
    saveAiSettings: (settings: AiSettings, apiKey: string) =>
      invoke<void>("save_ai_settings", { settings, apiKey }),
    listModels: () => invoke<string[]>("list_models"),
    searchBilibili: (query: string) => invoke<BiliSearchResult[]>("search_bilibili", { query }),
    rankCandidatesWithAi: (query: string, results: BiliSearchResult[]) =>
      invoke<CandidateTrack[]>("rank_candidates_with_ai", { query, results }),
    loadCoverDataUrl: (url: string) => invoke<string>("load_cover_data_url", { url }),
    resolvePreviewStream: (url: string) => invoke<string>("resolve_preview_stream", { url }),
    loadSongDataUrl: (path: string) => invoke<string>("load_song_data_url", { path }),
    loadAiSettings: () => invoke<AiSettings>("load_ai_settings"),
    convertAudio: (candidate: CandidateTrack) =>
      invoke<Song>("convert_audio", { candidate }),
    loadChatSession: () => invoke<LoadChatSessionResult>("load_chat_session"),
    clearChatMessages: () => invoke<void>("clear_chat_messages"),
    appendChatMessage: (message: AppendChatMessageInput) =>
      invoke<ChatMessage>("append_chat_message", { message }),
    updateChatMessage: (message: UpdateChatMessageInput) =>
      invoke<ChatMessage>("update_chat_message", { message }),
    listSongs: () => invoke<Song[]>("list_songs"),
    updateSongMetadata: (songId: string, title: string, artist: string) =>
      invoke<Song>(
        "update_song_metadata",
        { songId, title, artist } satisfies UpdateSongMetadataArgs
      ),
    deleteSong: (songId: string) =>
      invoke<DeleteResult>("delete_song", { songId } satisfies DeleteSongArgs),
    showInFinder: (path: string) => invoke<void>("show_in_finder", { path })
  };
}
