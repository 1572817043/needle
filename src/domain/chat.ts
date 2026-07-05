import type {
  AppendChatMessageInput,
  ChatMessageMetadata,
  ChatMessageStatus,
  UpdateChatMessageInput
} from "../types";

export function parseChatMessageMetadata(raw: string): ChatMessageMetadata {
  try {
    const parsed = JSON.parse(raw) as ChatMessageMetadata | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function serializeChatMessageMetadata(metadata: ChatMessageMetadata): string {
  return JSON.stringify(metadata);
}

export function createUserMessageInput(
  sessionId: string,
  query: string
): AppendChatMessageInput {
  return {
    sessionId,
    role: "user",
    content: query,
    status: "completed",
    metadata: {
      query
    }
  };
}

export function createAssistantMessageInput(
  sessionId: string,
  content: string,
  status: ChatMessageStatus,
  metadata: ChatMessageMetadata
): AppendChatMessageInput {
  return {
    sessionId,
    role: "assistant",
    content,
    status,
    metadata
  };
}

export function createAssistantMessageUpdate(
  content: string,
  status: ChatMessageStatus,
  metadata: ChatMessageMetadata
): Omit<UpdateChatMessageInput, "id"> {
  return {
    content,
    status,
    metadata
  };
}

export function createStoppedAssistantMessageUpdate(
  query: string
): Omit<UpdateChatMessageInput, "id"> {
  return createAssistantMessageUpdate("已停止本次查找。", "completed", {
    query
  });
}
