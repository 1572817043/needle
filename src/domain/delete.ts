import { DELETE_ERROR_CODE } from "../types";
import type { DeleteErrorPayload } from "../types";

function isDeleteErrorPayload(value: unknown): value is DeleteErrorPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

export function parseDeleteError(error: unknown): DeleteErrorPayload | null {
  if (!(error instanceof Error)) {
    return null;
  }

  try {
    const parsed = JSON.parse(error.message) as unknown;
    return isDeleteErrorPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getDeleteErrorMessage(error: DeleteErrorPayload): string {
  switch (error.code) {
    case DELETE_ERROR_CODE.PERMISSION_DENIED:
      return "删除失败：没有权限删除文件，请检查 ~/Music/Needle 目录权限";
    case DELETE_ERROR_CODE.DB_NOT_READY:
    case DELETE_ERROR_CODE.DB_ERROR:
      return "删除失败：数据库暂时不可用，请重启应用后重试";
    case DELETE_ERROR_CODE.FILE_DELETE_FAILED:
    case DELETE_ERROR_CODE.INTERNAL_ERROR:
      return `删除失败：${error.message}`;
    default:
      return `删除失败：${error.message}`;
  }
}
