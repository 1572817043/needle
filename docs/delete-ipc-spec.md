# 删除功能修复 & IPC 通信协议规范

> **状态**: 待实施
> **目标**: 修复 P0 删除不稳定问题，并建立前后端统一的错误通信标准

---

## 一、根因分析

### Bug 1（确定）：先删除后释放播放器，文件被占用

**位置**: `src/App.tsx:279` vs `src/App.tsx:292`

```
第 279 行   await needleApi.deleteSong(song.id);   // ← 先调 Rust 删除文件
第 292 行   if (shouldClearPlayer) {
第 293 行     audioRef.current?.pause();            // ← 后释放播放器
第 294 行     setPlayerSrc("");                     // ← 此时文件仍可能被 audio 持有
```

当用户删除正在播放的歌曲时：

1. `<audio>` 元素通过 Tauri asset protocol 持有文件描述符
2. Rust 端 `fs::remove_file` 在文件被占用时，macOS 行为不稳定：
   - 可能返回 `Ok(())`（unlink 成功但进程仍可读）
   - 可能返回 IO 错误（`EBUSY` / 权限相关）
3. `pause()` + `src=""` 不一定立即释放 fd；浏览器可能在内部保留缓冲

**修复原则**：必须先释放播放器，等待浏览器关闭文件句柄，再调用 Rust 删除。

### 分析 2（非 Bug）：Tauri v2 参数命名 — 无误

- Rust: `#[allow(non_snake_case)] fn delete_song(app: AppHandle, songId: String)`
- 前端: `invoke("delete_song", { songId })`
- Tauri v2 对 command 参数默认 `rename_all = "camelCase"`，`songId` 本身已是 camelCase，serde 不做转换
- **参数传递无类型不匹配，不是根因**

### 分析 3（UX 缺陷）：Compact 列表截断导致视觉不一致

**位置**: `src/App.tsx:592`

```tsx
<SongList songs={songs.slice(0, 5)} ... compact />
```

右侧 compact 面板只显示前 5 首。若用户删除第 6 首及之后的歌曲，compact 面板无视觉变化，用户以为删除失败。

### 分析 4（设计缺陷）：错误信息全为裸 String，不可机器区分

- Rust: `Result<(), String>` — 所有错误汇成一条字符串
- 前端: `invoke<void>` — catch 到 Error 后直接 `setStatus("删除失败：...")`
- 用户看到模糊提示，前端无法区分"文件被锁"、"权限不足"、"DB 坏了"

---

## 二、IPC 通信协议规范

### 2.1 共享错误码定义

#### Rust 端 (`src-tauri/src/error.rs` — 新建)

```rust
use serde::Serialize;

/// 删除操作的标准化错误码
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeleteErrorCode {
    /// 数据库未就绪（无法打开/初始化）
    DbNotReady,
    /// 数据库查询/写入失败
    DbError,
    /// 歌曲 ID 不存在（幂等：视为成功）
    SongNotFound,
    /// 本地文件正被占用（播放器未释放等）
    FileLocked,
    /// 文件系统权限不足
    PermissionDenied,
    /// 文件删除时发生未知 IO 错误
    FileDeleteFailed,
    /// 不可归类的内部错误
    InternalError,
}
```

#### TypeScript 前端 (`src/types.ts` — 追加)

```typescript
export const DELETE_ERROR_CODE = {
  DB_NOT_READY: "DB_NOT_READY",
  DB_ERROR: "DB_ERROR",
  SONG_NOT_FOUND: "SONG_NOT_FOUND",
  FILE_LOCKED: "FILE_LOCKED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  FILE_DELETE_FAILED: "FILE_DELETE_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type DeleteErrorCode =
  (typeof DELETE_ERROR_CODE)[keyof typeof DELETE_ERROR_CODE];
```

### 2.2 Rust 端返回结构体

```rust
// === src-tauri/src/error.rs ===

/// 删除操作成功时的返回载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    /// 被删除的 songId（回显，便于前端校验是否删对了）
    pub song_id: String,
    /// 是否删除了本地文件（null = 数据库记录中无对应文件 / 记录本身不存在）
    pub file_deleted: Option<bool>,
    /// 是否删除了数据库记录
    pub db_row_deleted: bool,
}

/// 删除操作失败时的错误载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteError {
    /// 机器可读错误码（前端据此分流处理）
    pub code: DeleteErrorCode,
    /// 面向开发者 / 日志的人类可读消息
    pub message: String,
    /// 涉及的文件路径（如有）
    pub path: Option<String>,
    /// 底层 OS 错误原始信息（调试用）
    pub os_error: Option<String>,
}
```

### 2.3 新 Tauri Command 签名

```rust
// === src-tauri/src/lib.rs ===

/// 删除一首已下载的歌曲及其数据库记录。
///
/// # 参数
/// - `app`: Tauri AppHandle
/// - `song_id`: 歌曲唯一标识（BV id 或系统生成的 id）
///
/// # 返回
/// - `Ok(DeleteResult)`: 删除成功（含是否删了文件/记录的详情）
/// - `Err(DeleteError)`: 结构化错误，前端可根据 code 分流处理
///
/// # 幂等性
/// 对同一 song_id 多次调用始终返回 Ok；
/// 歌曲不存在时 `db_row_deleted = false`，`file_deleted = null`。
#[tauri::command]
#[allow(non_snake_case)]
fn delete_song(app: AppHandle, song_id: String)
    -> Result<DeleteResult, DeleteError>
{
    // 实现要点：
    // 1. init_db / open_db 失败 → Err(DeleteError { code: DbNotReady, ... })
    // 2. query_row 失败 → Err(DeleteError { code: DbError, ... })
    // 3. song 不在 DB → Ok(DeleteResult { db_row_deleted: false, file_deleted: None, ... })
    // 4. remove_file 失败时分类：
    //    - ErrorKind::NotFound → 继续删 DB，file_deleted = Some(false)
    //    - ErrorKind::PermissionDenied → Err(DeleteError { code: PermissionDenied, ... })
    //    - 其他 IO 错误（含 EBUSY） → 判断是否来自文件被占用
    //      → 若是: Err(DeleteError { code: FileLocked, ... })
    //      → 否则: Err(DeleteError { code: FileDeleteFailed, ... })
    // 5. DELETE 执行成功 → Ok(DeleteResult { db_row_deleted: true, file_deleted: Some(true/false) })
}
```

#### IO Error 分类逻辑（伪代码）

```rust
Err(error) => {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::NotFound => {
            // 文件不存在，继续删库
            // ...
        }
        ErrorKind::PermissionDenied => {
            return Err(DeleteError {
                code: DeleteErrorCode::PermissionDenied,
                message: format!("没有权限删除文件：{}", local_path),
                path: Some(local_path),
                os_error: Some(error.to_string()),
            });
        }
        _ => {
            // macOS 上 EBUSY / EACCES 等可能被归入 Uncategorized
            let os_msg = error.to_string();
            let code = if os_msg.contains("Busy")
                || os_msg.contains("busy")
                || os_msg.contains("resource busy")
            {
                DeleteErrorCode::FileLocked
            } else {
                DeleteErrorCode::FileDeleteFailed
            };

            return Err(DeleteError {
                code,
                message: format!("删除本地文件失败：{}：{}", local_path, os_msg),
                path: Some(local_path),
                os_error: Some(os_msg),
            });
        }
    }
}
```

### 2.4 前端调用规范

#### `src/domain/bridge.ts` 改动

```typescript
// === 追加类型 ===
import type { DeleteErrorCode } from "../types";

export type DeleteSongArgs = { songId: string };

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
```

```typescript
// === createNeedleApi 中的 deleteSong 签名改为 ===

deleteSong: (songId: string): Promise<DeleteResult> =>
  invoke<DeleteResult>("delete_song", { songId } satisfies DeleteSongArgs),
```

> **Tauri v2 行为说明**:
> Rust 端返回 `Result<T, E>`，Tauri 会自动将 `Ok(t)` 作为 resolved value，将 `Err(e)` 序列化后 reject Promise。
> 前端 catch 到的 Error 的 message 中会包含序列化的 JSON，需解析得到 `code`。

#### `src/App.tsx` 中 `handleDelete` 修正方案

```
新时序（必须严格遵守）:

1. 若 song 正在播放:
      audioRef.current?.pause()
      setPlayerSrc("")
      // 通过 useEffect 或 key 变更确保 <audio> 元素被卸载/重建，
      // 从而让浏览器释放文件句柄。
      // 简易做法：递增 audioKey（已有 createAudioPlayerKey 机制）
      // 等待一帧确保 DOM 更新:
      await new Promise(r => requestAnimationFrame(r))

2. 调用 needleApi.deleteSong(song.id)
      → 成功 (DeleteResult):
            更新 UI，从 songs 状态中移除
            setStatus(`已删除：${song.title}`)

      → 失败 (Error，解析得到 code):
            FILE_LOCKED:
                等待 500ms 后自动重试一次
                若仍失败 → 提示"文件正在被使用，请关闭播放后重试"
            PERMISSION_DENIED:
                提示"没有权限删除文件，请检查 ~/Music/Needle 目录权限"
            DB_NOT_READY / DB_ERROR:
                提示"数据库错误，请重启应用"
            SONG_NOT_FOUND:
                视为成功（幂等），直接更新前端列表
            FILE_DELETE_FAILED / INTERNAL_ERROR:
                提示重试，展示 message

3. 清理播放器状态（若删除的是当前播放歌曲）

4. 可选：调用 refreshRuntimeState() 验证后端状态
```

#### 解析 Tauri Error 的辅助函数（建议新增）

```typescript
// === src/domain/bridge.ts ===

function parseDeleteError(error: unknown): DeleteErrorPayload | null {
  if (!(error instanceof Error)) return null;
  try {
    // Tauri v2 将 Err 序列化为 JSON 放在 message 中
    // 格式通常为纯 JSON 字符串
    const parsed = JSON.parse(error.message);
    if (parsed && typeof parsed.code === "string") {
      return parsed as DeleteErrorPayload;
    }
  } catch {
    // message 不是 JSON，可能是网络/序列化层错误
  }
  return null;
}
```

### 2.5 全部 Tauri Command 统一签名一览

> `AppError` 为通用错误结构，包含 `code: String` + `message: String` + `detail?: String`

| 命令 | Rust 签名 | 前端 invoke | 备注 |
|------|-----------|-------------|------|
| `check_tools` | `() -> ToolStatus` | `invoke<ToolStatus>("check_tools")` | 启动即调，无复杂错误 |
| `save_ai_settings` | `(AppHandle, settings, api_key) -> Result<(), AppError>` | `invoke<void>(...)` | |
| `list_models` | `(AppHandle) -> Result<Vec<String>, AppError>` | `invoke<string[]>(...)` | |
| `search_bilibili` | `(query) -> Result<Vec<BiliSearchResult>, AppError>` | `invoke<BiliSearchResult[]>(...)` | |
| `rank_candidates_with_ai` | `(AppHandle, query, results) -> Result<Vec<CandidateTrack>, AppError>` | `invoke<CandidateTrack[]>(...)` | |
| `resolve_preview_stream` | `(url) -> Result<String, AppError>` | `invoke<string>(...)` | |
| `load_song_data_url` | `(path) -> Result<String, AppError>` | `invoke<string>(...)` | |
| `convert_to_m4a` | `(AppHandle, candidate) -> Result<Song, AppError>` | `invoke<Song>(...)` | |
| `list_songs` | `(AppHandle) -> Result<Vec<Song>, AppError>` | `invoke<Song[]>(...)` | |
| **`delete_song`** | **`(AppHandle, song_id) -> Result<DeleteResult, DeleteError>`** | **`invoke<DeleteResult>(... { songId })`** | 本规范重点 |
| `show_in_finder` | `(path) -> Result<(), AppError>` | `invoke<void>(...)` | |

---

## 三、实施步骤（建议顺序）

### 步骤 1：Rust 端新增错误模块

1. 新建 `src-tauri/src/error.rs`
2. 定义 `DeleteErrorCode` 枚举 + `DeleteResult` + `DeleteError` 结构体
3. 在 `lib.rs` 中 `mod error;` 引入

### 步骤 2：改造 `delete_song` 和 `delete_song_from_conn`

1. 修改 `delete_song_from_conn` 的返回类型为 `Result<DeleteResult, DeleteError>`
2. 按 IO Error 分类映射错误码（见 2.3 中的伪代码）
3. 修改 `delete_song` command 函数签名

### 步骤 3：运行已有 Rust 测试确保不回归

```bash
cd src-tauri && cargo test
```

已有 5 个 delete 相关单元测试（`delete_song_from_conn_*`），需适配新返回类型。

### 步骤 4：前端修正时序 + 结构化错误处理

1. `handleDelete` 中：先暂停播放器 + 清 src + await 一帧，再调 `deleteSong`
2. 引入 `parseDeleteError` 解析错误码
3. 按错误码分流提示

### 步骤 5：真机验收

1. 转换一首歌
2. 播放中点击删除 → 应成功
3. 删除后右侧列表消失
4. `~/Music/Needle` 文件消失
5. 重启 App 后歌曲不再出现
6. 终端无未处理错误
