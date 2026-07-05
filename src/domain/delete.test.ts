import { describe, expect, it } from "vitest";
import { getDeleteErrorMessage, parseDeleteError } from "./delete";
import { DELETE_ERROR_CODE } from "../types";

describe("delete helpers", () => {
  it("parses structured Tauri delete errors from Error.message JSON", () => {
    const error = new Error(JSON.stringify({
      code: DELETE_ERROR_CODE.PERMISSION_DENIED,
      message: "没有权限删除文件",
      path: "/Users/a0000/Music/Needle/demo.m4a",
      osError: "Permission denied"
    }));

    expect(parseDeleteError(error)).toEqual({
      code: DELETE_ERROR_CODE.PERMISSION_DENIED,
      message: "没有权限删除文件",
      path: "/Users/a0000/Music/Needle/demo.m4a",
      osError: "Permission denied"
    });
  });

  it("returns null when the error message is not JSON", () => {
    expect(parseDeleteError(new Error("删除失败"))).toBeNull();
  });

  it("maps permission errors to a user-facing guidance message", () => {
    expect(getDeleteErrorMessage({
      code: DELETE_ERROR_CODE.PERMISSION_DENIED,
      message: "没有权限删除文件"
    })).toBe("删除失败：没有权限删除文件，请检查 ~/Music/Needle 目录权限");
  });

  it("uses backend messages for file delete failures", () => {
    expect(getDeleteErrorMessage({
      code: DELETE_ERROR_CODE.FILE_DELETE_FAILED,
      message: "删除本地文件失败：/tmp/demo.m4a：is a directory"
    })).toBe("删除失败：删除本地文件失败：/tmp/demo.m4a：is a directory");
  });
});
