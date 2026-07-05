export const AUDIO_FORMATS = ["m4a", "mp3"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export type AiSettings = {
  providerName: string;
  baseUrl: string;
  model: string;
  audioFormat: AudioFormat;
  apiKeyStoredInKeychain: true;
};

export type ToolStatus = {
  ytDlpAvailable: boolean;
  ffmpegAvailable: boolean;
  ytDlpPath?: string;
  ffmpegPath?: string;
};

export type BiliSearchResult = {
  id: string;
  title: string;
  url: string;
  coverUrl: string;
  author: string;
  durationSeconds: number;
  playCount: number;
};

export type CandidateStatus =
  | "idle"
  | "previewing"
  | "readyToConvert"
  | "converting"
  | "failed";

export type CandidateTrack = {
  sourceResult: BiliSearchResult;
  matchReason: string;
  confidence: number;
  status: CandidateStatus;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRole = "user" | "assistant";

export type ChatMessageStatus = "completed" | "pending" | "failed";

export type ChatMessageMetadata = {
  query?: string;
  candidates?: CandidateTrack[];
  visibleCandidateCount?: number;
  candidateStartIndex?: number;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  metadata: ChatMessageMetadata;
  createdAt: string;
};

export type LoadChatSessionResult = {
  session: ChatSession;
  messages: ChatMessage[];
};

export type AppendChatMessageInput = {
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  metadata: ChatMessageMetadata;
};

export type UpdateChatMessageInput = {
  id: string;
  content: string;
  status: ChatMessageStatus;
  metadata: ChatMessageMetadata;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceUrl: string;
  coverUrl: string;
  localPath: string;
  audioFormat: AudioFormat;
  durationSeconds: number;
  createdAt: string;
};

export const DELETE_ERROR_CODE = {
  DB_NOT_READY: "DB_NOT_READY",
  DB_ERROR: "DB_ERROR",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  FILE_DELETE_FAILED: "FILE_DELETE_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type DeleteErrorCode =
  (typeof DELETE_ERROR_CODE)[keyof typeof DELETE_ERROR_CODE];

export type DeleteResult = {
  songId: string;
  fileDeleted: boolean | null;
  dbRowDeleted: boolean;
};

export type DeleteErrorPayload = {
  code: DeleteErrorCode;
  message: string;
  path?: string;
  osError?: string;
};

export type DownloadTask = {
  id: string;
  candidate: CandidateTrack;
  progress: number;
  status: "queued" | "running" | "completed" | "failed";
  errorMessage?: string;
};
