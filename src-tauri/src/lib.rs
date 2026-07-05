mod error;

use crate::error::{DeleteError, DeleteResult};
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use reqwest::{header, Client};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;
use tauri::{AppHandle, Manager};
use tokio::process::Command as AsyncCommand;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    provider_name: String,
    base_url: String,
    model: String,
    audio_format: String,
    api_key_stored_in_keychain: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BiliSearchResult {
    id: String,
    title: String,
    url: String,
    cover_url: String,
    author: String,
    duration_seconds: i64,
    play_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CandidateTrack {
    source_result: BiliSearchResult,
    match_reason: String,
    confidence: f64,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Song {
    id: String,
    title: String,
    artist: String,
    source_title: String,
    source_author: String,
    source_url: String,
    cover_url: String,
    local_path: String,
    audio_format: String,
    duration_seconds: i64,
    created_at: String,
}

#[derive(Debug, Clone)]
struct CleanedSongMetadata {
    title: String,
    artist: String,
    source_title: String,
    source_author: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatSession {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    session_id: String,
    role: String,
    content: String,
    status: String,
    metadata: serde_json::Value,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendChatMessageInput {
    session_id: String,
    role: String,
    content: String,
    status: String,
    metadata: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateChatMessageInput {
    id: String,
    content: String,
    status: String,
    metadata: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadChatSessionResult {
    session: ChatSession,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStatus {
    yt_dlp_available: bool,
    ffmpeg_available: bool,
    yt_dlp_path: Option<String>,
    ffmpeg_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BiliResponse {
    data: Option<BiliData>,
}

#[derive(Debug, Deserialize)]
struct BiliData {
    result: Option<Vec<BiliRawResult>>,
}

#[derive(Debug, Deserialize)]
struct BiliRawResult {
    bvid: Option<String>,
    title: Option<String>,
    arcurl: Option<String>,
    pic: Option<String>,
    author: Option<String>,
    duration: Option<String>,
    play: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelItem>,
}

#[derive(Debug, Deserialize)]
struct ModelItem {
    id: String,
}

#[derive(Debug, Deserialize)]
struct RankingResponse {
    candidates: Vec<RankingItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankingItem {
    id: String,
    match_reason: String,
    confidence: f64,
}

static CONVERSION_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
const DEFAULT_CHAT_SESSION_ID: &str = "default";
const DEFAULT_CHAT_SESSION_TITLE: &str = "默认会话";
const DEFAULT_AUDIO_FORMAT: &str = "m4a";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_tools,
            load_ai_settings,
            save_ai_settings,
            list_models,
            search_bilibili,
            rank_candidates_with_ai,
            load_cover_data_url,
            resolve_preview_stream,
            load_song_data_url,
            convert_audio,
            load_chat_session,
            clear_chat_messages,
            append_chat_message,
            update_chat_message,
            list_songs,
            update_song_metadata,
            delete_song,
            show_in_finder,
            show_app_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Needle");
}

#[tauri::command]
fn check_tools() -> ToolStatus {
    let yt_dlp_path = find_command("yt-dlp");
    let ffmpeg_path = find_command("ffmpeg");

    ToolStatus {
        yt_dlp_available: yt_dlp_path.is_some(),
        ffmpeg_available: ffmpeg_path.is_some(),
        yt_dlp_path,
        ffmpeg_path,
    }
}

#[tauri::command]
fn load_ai_settings(app: AppHandle) -> Result<AiSettings, String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    load_ai_settings_from_conn(&conn)
}

#[tauri::command]
fn save_ai_settings(app: AppHandle, settings: AiSettings, api_key: String) -> Result<(), String> {
    init_db(&app)?;
    save_api_key(&api_key)?;

    let conn = open_db(&app)?;
    conn.execute(
        "INSERT OR REPLACE INTO ai_settings (id, provider_name, base_url, model, audio_format, api_key_stored_in_keychain)
         VALUES (1, ?1, ?2, ?3, ?4, 1)",
        params![
            settings.provider_name,
            settings.base_url,
            settings.model,
            normalize_audio_format(&settings.audio_format)
        ],
    )
    .map_err(to_string)?;

    Ok(())
}

#[tauri::command]
async fn list_models(app: AppHandle) -> Result<Vec<String>, String> {
    let settings = load_required_ai_settings(&app)?;
    let api_key = load_api_key()?;
    let url = format!("{}/models", trim_slashes(&settings.base_url));
    let response = Client::new()
        .get(url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(to_string)?
        .error_for_status()
        .map_err(to_string)?
        .json::<ModelsResponse>()
        .await
        .map_err(to_string)?;

    Ok(response.data.into_iter().map(|model| model.id).collect())
}

#[tauri::command]
async fn search_bilibili(query: String) -> Result<Vec<BiliSearchResult>, String> {
    let client = Client::builder()
        .user_agent(browser_user_agent())
        .build()
        .map_err(to_string)?;
    let url = build_bilibili_search_url(&query);
    let referer = build_bilibili_search_referer(&query);

    let cookie_header = match client
        .get("https://www.bilibili.com")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .send()
        .await
    {
        Ok(response) => collect_set_cookie(response.headers()),
        Err(_) => String::new(),
    };

    let mut request = client
        .get(url)
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Referer", referer)
        .header("Origin", "https://search.bilibili.com")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-site");
    if !cookie_header.is_empty() {
        request = request.header("Cookie", cookie_header);
    }

    let response = request.send().await.map_err(to_string)?;
    if response.status().as_u16() == 412 {
        return Err("B 站搜索被临时拦截了（412）".to_string());
    }
    let response = response
        .error_for_status()
        .map_err(to_string)?
        .json::<BiliResponse>()
        .await
        .map_err(to_string)?;

    Ok(response
        .data
        .and_then(|data| data.result)
        .unwrap_or_default()
        .into_iter()
        .filter_map(map_bili_result)
        .collect())
}

#[tauri::command]
async fn rank_candidates_with_ai(
    app: AppHandle,
    query: String,
    results: Vec<BiliSearchResult>,
) -> Result<Vec<CandidateTrack>, String> {
    let settings = load_required_ai_settings(&app)?;
    let api_key = load_api_key()?;
    let prompt = build_ranking_prompt(&query, &results);
    let url = format!("{}/chat/completions", trim_slashes(&settings.base_url));
    let body = json!({
        "model": settings.model,
        "messages": [
            {"role": "system", "content": "你是音乐搜索结果筛选助手，只返回 JSON。"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    });

    let response = Client::new()
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(to_string)?
        .error_for_status()
        .map_err(to_string)?
        .json::<serde_json::Value>()
        .await
        .map_err(to_string)?;

    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "AI 没有返回可解析内容".to_string())?;
    let ranking = serde_json::from_str::<RankingResponse>(content).map_err(to_string)?;

    Ok(apply_ranking(results, ranking))
}

#[tauri::command]
async fn resolve_preview_stream(url: String) -> Result<String, String> {
    let yt_dlp = find_command("yt-dlp").ok_or_else(|| {
        "未检测到 yt-dlp，请确认已安装并位于 /opt/homebrew/bin 或 /usr/local/bin".to_string()
    })?;
    let ffmpeg = find_command("ffmpeg").ok_or_else(|| {
        "未检测到 ffmpeg，请确认已安装并位于 /opt/homebrew/bin 或 /usr/local/bin".to_string()
    })?;
    let output_path = build_preview_output_path(preview_id_hint(&url), preview_title_hint(&url));
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    let args = build_preview_download_args(&url, &output_path);
    let output = AsyncCommand::new(yt_dlp)
        .args(&args)
        .output()
        .await
        .map_err(to_string)?;

    if !output.status.success() {
        return Err(command_error_message(
            "试听音频生成失败",
            &output.stderr,
            &output.stdout,
        ));
    }

    if !output_path.is_file() {
        return Err(format!(
            "试听音频生成失败：未找到输出文件 {}",
            output_path.display()
        ));
    }

    repack_m4a_with_faststart(&ffmpeg, &output_path, &output_path, "试听音频重封装失败").await?;
    load_song_data_url(output_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn load_cover_data_url(url: String) -> Result<String, String> {
    let response = Client::builder()
        .user_agent(browser_user_agent())
        .build()
        .map_err(to_string)?
        .get(&url)
        .header(
            "Accept",
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com")
        .send()
        .await
        .map_err(to_string)?
        .error_for_status()
        .map_err(to_string)?;

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = response.bytes().await.map_err(to_string)?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    let mime = infer_image_mime_type(content_type.as_deref(), &url);

    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn load_song_data_url(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(to_string)?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    let mime = if infer_audio_format_from_path(&path) == "mp3" {
        "audio/mpeg"
    } else {
        "audio/mp4"
    };
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
async fn convert_audio(app: AppHandle, candidate: CandidateTrack) -> Result<Song, String> {
    init_db(&app)?;
    let yt_dlp = find_command("yt-dlp").ok_or_else(|| {
        "未检测到 yt-dlp，请确认已安装并位于 /opt/homebrew/bin 或 /usr/local/bin".to_string()
    })?;
    let ffmpeg = find_command("ffmpeg").ok_or_else(|| {
        "未检测到 ffmpeg，请确认已安装并位于 /opt/homebrew/bin 或 /usr/local/bin".to_string()
    })?;
    let music_dir = default_music_dir()?;
    fs::create_dir_all(&music_dir).map_err(to_string)?;
    let conn = open_db(&app)?;
    let _conversion_guard = CONVERSION_LOCK.lock().await;
    let audio_format = load_ai_settings_from_conn(&conn)?.audio_format;

    let replaced_local_path = find_song_by_id(&conn, &candidate.source_result.id)?
        .filter(|song| {
            Path::new(&song.local_path).exists()
                && normalize_audio_format(&song.audio_format) != audio_format
        })
        .map(|song| song.local_path);

    if let Some(existing_song) =
        reuse_or_purge_existing_song(&conn, &candidate.source_result.id, &audio_format)?
    {
        return Ok(existing_song);
    }

    let filename = format!(
        "{}.{}",
        sanitize_filename(&candidate.source_result.title),
        audio_format
    );
    let output_path = unique_path(music_dir.join(filename));
    let download_template = build_conversion_download_template(&output_path, &audio_format);
    let output = AsyncCommand::new(yt_dlp)
        .args(build_convert_download_args(
            &candidate.source_result.url,
            &download_template,
            &audio_format,
        ))
        .output()
        .await
        .map_err(to_string)?;

    if !output.status.success() {
        return Err(command_error_message(
            &format!("{} 转换失败", audio_format.to_uppercase()),
            &output.stderr,
            &output.stdout,
        ));
    }

    let downloaded_path =
        resolve_downloaded_audio_path(Path::new(&download_template), &output.stdout, &audio_format)?;
    if downloaded_path.extension().and_then(|value| value.to_str()) != Some(audio_format.as_str()) {
        return Err(format!(
            "{} 转换失败：yt-dlp 生成的文件不是 {}：{}",
            audio_format.to_uppercase(),
            audio_format,
            downloaded_path.display()
        ));
    }

    if audio_format == "m4a" {
        repack_m4a_with_faststart(&ffmpeg, &downloaded_path, &output_path, "M4A 重封装失败").await?;
    } else {
        replace_file(&downloaded_path, &output_path, "MP3 文件落盘失败")?;
    }

    let metadata = clean_song_metadata(&candidate.source_result.title, &candidate.source_result.author);
    let song = Song {
        id: candidate.source_result.id,
        title: metadata.title,
        artist: metadata.artist,
        source_title: metadata.source_title,
        source_author: metadata.source_author,
        source_url: candidate.source_result.url,
        cover_url: candidate.source_result.cover_url,
        local_path: output_path.to_string_lossy().to_string(),
        audio_format,
        duration_seconds: candidate.source_result.duration_seconds,
        created_at: Utc::now().to_rfc3339(),
    };
    insert_song_into_conn(&conn, &song)?;
    if let Some(replaced_local_path) = replaced_local_path {
        if replaced_local_path != song.local_path {
            let _ = fs::remove_file(replaced_local_path);
        }
    }

    Ok(song)
}

#[tauri::command]
fn load_chat_session(app: AppHandle) -> Result<LoadChatSessionResult, String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    let session = ensure_default_chat_session(&conn)?;
    let messages = load_chat_messages(&conn, &session.id)?;
    Ok(LoadChatSessionResult { session, messages })
}

#[tauri::command]
fn clear_chat_messages(app: AppHandle) -> Result<(), String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    let _ = ensure_default_chat_session(&conn)?;
    clear_default_chat_messages(&conn)?;
    Ok(())
}

#[tauri::command]
fn append_chat_message(
    app: AppHandle,
    message: AppendChatMessageInput,
) -> Result<ChatMessage, String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    ensure_chat_session_exists(&conn, &message.session_id)?;
    let chat_message = insert_chat_message(&conn, &message)?;
    touch_chat_session(&conn, &message.session_id, &chat_message.created_at)?;
    Ok(chat_message)
}

#[tauri::command]
fn update_chat_message(
    app: AppHandle,
    message: UpdateChatMessageInput,
) -> Result<ChatMessage, String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    let chat_message = update_chat_message_in_conn(&conn, &message)?;
    touch_chat_session(&conn, &chat_message.session_id, &Utc::now().to_rfc3339())?;
    Ok(chat_message)
}

#[tauri::command]
fn list_songs(app: AppHandle) -> Result<Vec<Song>, String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    load_songs(&conn)
}

#[tauri::command]
#[allow(non_snake_case)]
async fn update_song_metadata(
    app: AppHandle,
    songId: String,
    title: String,
    artist: String,
) -> Result<Song, String> {
    init_db(&app)?;
    let conn = open_db(&app)?;
    let existing_song = find_song_by_id(&conn, &songId)?
        .ok_or_else(|| format!("歌曲不存在：{songId}"))?;
    let local_path = PathBuf::from(&existing_song.local_path);
    if !local_path.is_file() {
        return Err(format!(
            "本地文件不存在：{}",
            local_path.display()
        ));
    }

    let ffmpeg = find_command("ffmpeg").ok_or_else(|| {
        "未检测到 ffmpeg，请确认已安装并位于 /opt/homebrew/bin 或 /usr/local/bin".to_string()
    })?;

    write_audio_metadata(
        &ffmpeg,
        &local_path,
        &title,
        &artist,
        &existing_song.audio_format,
    )
    .await?;
    update_song_metadata_in_conn(&conn, &songId, &title, &artist)
}

#[tauri::command]
#[allow(non_snake_case)]
fn delete_song(app: AppHandle, songId: String) -> Result<DeleteResult, DeleteError> {
    init_db(&app).map_err(DeleteError::db_not_ready)?;
    let conn = open_db(&app).map_err(DeleteError::db_not_ready)?;
    delete_song_from_conn(&conn, &songId)
}

#[tauri::command]
fn show_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .args(["-R", &path])
        .status()
        .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn show_app_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(to_string)?;
    fs::create_dir_all(&dir).map_err(to_string)?;
    Command::new("open")
        .arg(dir)
        .status()
        .map_err(to_string)?;
    Ok(())
}

fn init_db(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    create_schema(&conn)?;
    Ok(())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(to_string)?;
    fs::create_dir_all(&dir).map_err(to_string)?;
    Connection::open(dir.join("needle.sqlite")).map_err(to_string)
}

fn default_ai_settings() -> AiSettings {
    AiSettings {
        provider_name: "DeepSeek".to_string(),
        base_url: "https://api.deepseek.com/v1".to_string(),
        model: String::new(),
        audio_format: DEFAULT_AUDIO_FORMAT.to_string(),
        api_key_stored_in_keychain: true,
    }
}

fn normalize_audio_format(audio_format: &str) -> String {
    match audio_format.trim().to_lowercase().as_str() {
        "mp3" => "mp3".to_string(),
        _ => DEFAULT_AUDIO_FORMAT.to_string(),
    }
}

fn infer_audio_format_from_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(normalize_audio_format)
        .unwrap_or_else(|| DEFAULT_AUDIO_FORMAT.to_string())
}

fn load_ai_settings_from_conn(conn: &Connection) -> Result<AiSettings, String> {
    conn.query_row(
        "SELECT provider_name, base_url, model, audio_format, api_key_stored_in_keychain FROM ai_settings WHERE id = 1",
        [],
        |row| {
            Ok(AiSettings {
                provider_name: row.get(0)?,
                base_url: row.get(1)?,
                model: row.get(2)?,
                audio_format: normalize_audio_format(&row.get::<_, String>(3)?),
                api_key_stored_in_keychain: row.get::<_, i64>(4)? == 1,
            })
        },
    )
    .optional()
    .map_err(to_string)?
    .map(Ok)
    .unwrap_or_else(|| Ok(default_ai_settings()))
}

fn load_required_ai_settings(app: &AppHandle) -> Result<AiSettings, String> {
    init_db(app)?;
    let conn = open_db(app)?;
    let settings = load_ai_settings_from_conn(&conn)?;
    if settings.model.trim().is_empty() {
        return Err("请先保存 AI 设置".to_string());
    }
    Ok(settings)
}

fn ensure_default_chat_session(conn: &Connection) -> Result<ChatSession, String> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO chat_sessions (id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            DEFAULT_CHAT_SESSION_ID,
            DEFAULT_CHAT_SESSION_TITLE,
            now,
            now
        ],
    )
    .map_err(to_string)?;

    load_chat_session_from_conn(conn, DEFAULT_CHAT_SESSION_ID)?
        .ok_or_else(|| "默认聊天会话初始化失败".to_string())
}

fn ensure_chat_session_exists(conn: &Connection, session_id: &str) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(to_string)?;
    if count == 0 {
        return Err(format!("聊天会话不存在：{session_id}"));
    }
    Ok(())
}

fn load_chat_session_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ChatSession>, String> {
    conn.query_row(
        "SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?1",
        params![session_id],
        |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(to_string)
}

fn load_chat_messages(conn: &Connection, session_id: &str) -> Result<Vec<ChatMessage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, status, metadata_json, created_at
             FROM chat_messages
             WHERE session_id = ?1
             ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map(params![session_id], |row| {
            let metadata_json: String = row.get(5)?;
            let metadata = serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({}));
            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                status: row.get(4)?,
                metadata,
                created_at: row.get(6)?,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn clear_default_chat_messages(conn: &Connection) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM chat_messages WHERE session_id = ?1",
        params![DEFAULT_CHAT_SESSION_ID],
    )
    .map_err(to_string)
}

fn insert_chat_message(
    conn: &Connection,
    message: &AppendChatMessageInput,
) -> Result<ChatMessage, String> {
    let now = Utc::now().to_rfc3339();
    let id = build_chat_message_id();
    let metadata_json = serde_json::to_string(&message.metadata).map_err(to_string)?;
    conn.execute(
        "INSERT INTO chat_messages (id, session_id, role, content, status, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            message.session_id,
            message.role,
            message.content,
            message.status,
            metadata_json,
            now
        ],
    )
    .map_err(to_string)?;

    Ok(ChatMessage {
        id,
        session_id: message.session_id.clone(),
        role: message.role.clone(),
        content: message.content.clone(),
        status: message.status.clone(),
        metadata: message.metadata.clone(),
        created_at: now,
    })
}

fn update_chat_message_in_conn(
    conn: &Connection,
    message: &UpdateChatMessageInput,
) -> Result<ChatMessage, String> {
    let existing = conn
        .query_row(
            "SELECT id, session_id, role, created_at FROM chat_messages WHERE id = ?1",
            params![message.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(to_string)?
        .ok_or_else(|| format!("聊天消息不存在：{}", message.id))?;
    let metadata_json = serde_json::to_string(&message.metadata).map_err(to_string)?;
    conn.execute(
        "UPDATE chat_messages
         SET content = ?2, status = ?3, metadata_json = ?4
         WHERE id = ?1",
        params![message.id, message.content, message.status, metadata_json],
    )
    .map_err(to_string)?;

    Ok(ChatMessage {
        id: existing.0,
        session_id: existing.1,
        role: existing.2,
        content: message.content.clone(),
        status: message.status.clone(),
        metadata: message.metadata.clone(),
        created_at: existing.3,
    })
}

fn touch_chat_session(conn: &Connection, session_id: &str, updated_at: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE chat_sessions SET updated_at = ?2 WHERE id = ?1",
        params![session_id, updated_at],
    )
    .map_err(to_string)?;
    Ok(())
}

fn build_chat_message_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("chat-msg-{nanos}")
}

fn load_songs(conn: &Connection) -> Result<Vec<Song>, String> {
    let songs = query_songs(conn)?;
    let mut valid_songs = Vec::with_capacity(songs.len());
    let mut stale_song_ids = Vec::new();

    for song in songs {
        if Path::new(&song.local_path).exists() {
            valid_songs.push(song);
        } else {
            stale_song_ids.push(song.id);
        }
    }

    if !stale_song_ids.is_empty() {
        delete_songs_by_ids(conn, &stale_song_ids)?;
    }

    Ok(valid_songs)
}

fn query_songs(conn: &Connection) -> Result<Vec<Song>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, artist, source_title, source_author, source_url, cover_url, local_path, audio_format, duration_seconds, created_at
             FROM songs ORDER BY created_at DESC",
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Song {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                source_title: row.get(3)?,
                source_author: row.get(4)?,
                source_url: row.get(5)?,
                cover_url: row.get(6)?,
                local_path: row.get(7)?,
                audio_format: normalize_audio_format(&row.get::<_, String>(8)?),
                duration_seconds: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(to_string)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn find_song_by_id(conn: &Connection, song_id: &str) -> Result<Option<Song>, String> {
    conn.query_row(
        "SELECT id, title, artist, source_title, source_author, source_url, cover_url, local_path, audio_format, duration_seconds, created_at
         FROM songs WHERE id = ?1",
        params![song_id],
        |row| {
            Ok(Song {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                source_title: row.get(3)?,
                source_author: row.get(4)?,
                source_url: row.get(5)?,
                cover_url: row.get(6)?,
                local_path: row.get(7)?,
                audio_format: normalize_audio_format(&row.get::<_, String>(8)?),
                duration_seconds: row.get(9)?,
                created_at: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(to_string)
}

fn reuse_or_purge_existing_song(
    conn: &Connection,
    song_id: &str,
    audio_format: &str,
) -> Result<Option<Song>, String> {
    let Some(existing_song) = find_song_by_id(conn, song_id)? else {
        return Ok(None);
    };

    if Path::new(&existing_song.local_path).exists() {
        if normalize_audio_format(&existing_song.audio_format) == normalize_audio_format(audio_format) {
            return Ok(Some(existing_song));
        }
        return Ok(None);
    }

    delete_songs_by_ids(conn, std::slice::from_ref(&existing_song.id))?;
    Ok(None)
}

fn delete_song_from_conn(conn: &Connection, song_id: &str) -> Result<DeleteResult, DeleteError> {
    let local_path: Option<String> = conn
        .query_row(
            "SELECT local_path FROM songs WHERE id = ?1",
            params![song_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| DeleteError::db_error(to_string(error)))?;

    let Some(local_path) = local_path else {
        return Ok(DeleteResult {
            song_id: song_id.to_string(),
            file_deleted: None,
            db_row_deleted: false,
        });
    };

    let file_deleted = match fs::remove_file(&local_path) {
        Ok(()) => Some(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(false),
        Err(error)
            if error.kind() == std::io::ErrorKind::PermissionDenied
                && !Path::new(&local_path).is_dir() =>
        {
            return Err(DeleteError::permission_denied(
                format!("没有权限删除文件：{local_path}"),
                local_path,
                error.to_string(),
            ));
        }
        Err(error) => {
            if error.to_string().trim().is_empty() {
                return Err(DeleteError::internal_error(format!(
                    "删除本地文件失败：{local_path}"
                )));
            }
            return Err(DeleteError::file_delete_failed(
                format!("删除本地文件失败：{}：{}", local_path, error),
                local_path,
                error.to_string(),
            ));
        }
    };

    let affected_rows = conn
        .execute("DELETE FROM songs WHERE id = ?1", params![song_id])
        .map_err(|error| DeleteError::db_error(to_string(error)))?;
    Ok(DeleteResult {
        song_id: song_id.to_string(),
        file_deleted,
        db_row_deleted: affected_rows > 0,
    })
}

fn update_song_metadata_in_conn(
    conn: &Connection,
    song_id: &str,
    title: &str,
    artist: &str,
) -> Result<Song, String> {
    let existing_song = find_song_by_id(conn, song_id)?
        .ok_or_else(|| format!("歌曲不存在：{song_id}"))?;

    conn.execute(
        "UPDATE songs SET title = ?2, artist = ?3 WHERE id = ?1",
        params![song_id, title, artist],
    )
    .map_err(to_string)?;

    Ok(Song {
        title: title.to_string(),
        artist: artist.to_string(),
        ..existing_song
    })
}

fn delete_songs_by_ids(conn: &Connection, song_ids: &[String]) -> Result<(), String> {
    for song_id in song_ids {
        conn.execute("DELETE FROM songs WHERE id = ?1", params![song_id])
            .map_err(to_string)?;
    }
    Ok(())
}

fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider_name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            model TEXT NOT NULL,
            audio_format TEXT NOT NULL DEFAULT 'm4a',
            api_key_stored_in_keychain INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS songs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            source_title TEXT NOT NULL,
            source_author TEXT NOT NULL,
            source_url TEXT NOT NULL,
            cover_url TEXT NOT NULL,
            local_path TEXT NOT NULL,
            audio_format TEXT NOT NULL DEFAULT 'm4a',
            duration_seconds INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );",
    )
    .map_err(to_string)?;
    migrate_ai_settings_schema(conn)?;
    migrate_song_schema(conn)?;
    Ok(())
}

fn insert_song_into_conn(conn: &Connection, song: &Song) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO songs
         (id, title, artist, source_title, source_author, source_url, cover_url, local_path, audio_format, duration_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            song.id,
            song.title,
            song.artist,
            song.source_title,
            song.source_author,
            song.source_url,
            song.cover_url,
            song.local_path,
            normalize_audio_format(&song.audio_format),
            song.duration_seconds,
            song.created_at
        ],
    )
    .map_err(to_string)?;
    Ok(())
}

fn migrate_song_schema(conn: &Connection) -> Result<(), String> {
    if !table_exists(conn, "songs")? {
        return Ok(());
    }

    if !column_exists(conn, "songs", "source_title")? {
        conn.execute("ALTER TABLE songs ADD COLUMN source_title TEXT", [])
            .map_err(to_string)?;
    }

    if !column_exists(conn, "songs", "source_author")? {
        conn.execute("ALTER TABLE songs ADD COLUMN source_author TEXT", [])
            .map_err(to_string)?;
    }

    if !column_exists(conn, "songs", "audio_format")? {
        conn.execute(
            &format!(
                "ALTER TABLE songs ADD COLUMN audio_format TEXT NOT NULL DEFAULT '{}'",
                DEFAULT_AUDIO_FORMAT
            ),
            [],
        )
        .map_err(to_string)?;
    }

    conn.execute(
        "UPDATE songs
         SET source_title = COALESCE(NULLIF(source_title, ''), title),
             source_author = COALESCE(NULLIF(source_author, ''), artist),
             audio_format = CASE
                 WHEN lower(COALESCE(NULLIF(audio_format, ''), '')) = 'mp3' THEN 'mp3'
                 WHEN lower(local_path) LIKE '%.mp3' THEN 'mp3'
                 ELSE 'm4a'
             END",
        [],
    )
    .map_err(to_string)?;

    Ok(())
}

fn migrate_ai_settings_schema(conn: &Connection) -> Result<(), String> {
    if !table_exists(conn, "ai_settings")? {
        return Ok(());
    }

    if !column_exists(conn, "ai_settings", "audio_format")? {
        conn.execute(
            &format!(
                "ALTER TABLE ai_settings ADD COLUMN audio_format TEXT NOT NULL DEFAULT '{}'",
                DEFAULT_AUDIO_FORMAT
            ),
            [],
        )
        .map_err(to_string)?;
    }

    conn.execute(
        "UPDATE ai_settings
         SET audio_format = CASE
             WHEN lower(COALESCE(NULLIF(audio_format, ''), '')) = 'mp3' THEN 'mp3'
             ELSE 'm4a'
         END",
        [],
    )
    .map_err(to_string)?;

    Ok(())
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table_name],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .map_err(to_string)
}

fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn.prepare(&pragma).map_err(to_string)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_string)?;

    for row in rows {
        if row.map_err(to_string)? == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn clean_song_metadata(source_title: &str, source_author: &str) -> CleanedSongMetadata {
    let normalized_source_title = source_title.trim().to_string();
    let normalized_source_author = source_author.trim().to_string();
    let title_without_noise_brackets = strip_noise_brackets(&normalized_source_title);
    let cleaned_fallback_title =
        cleanup_title_text(&title_without_noise_brackets).unwrap_or_else(|| normalized_source_title.clone());

    if let Some((_, inner)) = extract_book_title(&title_without_noise_brackets) {
        let extracted_title = cleanup_title_text(inner).unwrap_or_else(|| cleaned_fallback_title.clone());
        let prefix_end = title_without_noise_brackets.find('《').unwrap_or(0);
        let extracted_artist =
            normalize_artist_text(&cleanup_artist_prefix(&title_without_noise_brackets[..prefix_end]));

        return CleanedSongMetadata {
            title: extracted_title,
            artist: if extracted_artist.is_empty() {
                normalized_source_author.clone()
            } else {
                extracted_artist
            },
            source_title: normalized_source_title,
            source_author: normalized_source_author,
        };
    }

    let inferred = infer_artist_and_title_from_plain_text(&cleaned_fallback_title);
    CleanedSongMetadata {
        title: inferred
            .as_ref()
            .map(|(_, title)| title.clone())
            .unwrap_or_else(|| cleaned_fallback_title.clone()),
        artist: inferred
            .as_ref()
            .map(|(artist, _)| artist.clone())
            .filter(|artist| !artist.is_empty())
            .unwrap_or_else(|| normalized_source_author.clone()),
        source_title: normalized_source_title,
        source_author: normalized_source_author,
    }
}

fn extract_book_title(value: &str) -> Option<(&str, &str)> {
    let start = value.find('《')?;
    let end = value[start..].find('》')? + start;
    if end <= start + '《'.len_utf8() {
        return None;
    }
    Some((&value[..start], &value[start + '《'.len_utf8()..end]))
}

fn strip_noise_brackets(value: &str) -> String {
    let next = strip_bracket_pairs(value, '【', '】');
    let next = strip_bracket_pairs(&next, '[', ']');
    let next = strip_bracket_pairs(&next, '（', '）');
    strip_bracket_pairs(&next, '(', ')')
}

fn strip_bracket_pairs(value: &str, open: char, close: char) -> String {
    let mut result = String::new();
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != open {
            result.push(ch);
            continue;
        }

        let mut inner = String::new();
        let mut found_close = false;
        while let Some(inner_ch) = chars.next() {
            if inner_ch == close {
                found_close = true;
                break;
            }
            inner.push(inner_ch);
        }

        if !found_close {
            result.push(open);
            result.push_str(&inner);
            continue;
        }

        if is_noise_text(&inner) {
            result.push(' ');
        } else {
            result.push(open);
            result.push_str(&inner);
            result.push(close);
        }
    }

    collapse_spaces(&result)
}

fn cleanup_title_text(value: &str) -> Option<String> {
    let mut next = value
        .replace(['《', '》'], " ")
        .replace(['【', '】', '[', ']', '(', ')', '（', '）'], " ");

    for phrase in noise_phrases() {
        next = replace_case_insensitive(&next, phrase, " ");
    }

    next = replace_case_insensitive(&next, "feat.", " ");
    next = replace_case_insensitive(&next, "feat", " ");
    next = replace_case_insensitive(&next, "ft.", " ");
    next = replace_case_insensitive(&next, "ft", " ");
    next = next
        .replace(['|', '·', '•'], " ")
        .replace(['-', '_'], " ");

    let collapsed = collapse_spaces(&next);
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
}

fn cleanup_artist_prefix(value: &str) -> String {
    let mut next = value
        .replace(['《', '》'], " ")
        .replace(['【', '】', '[', ']', '(', ')', '（', '）'], " ");

    for phrase in noise_phrases() {
        if *phrase == "live" {
            continue;
        }
        next = replace_case_insensitive(&next, phrase, " ");
    }

    collapse_spaces(&next)
        .trim_end_matches([':', '：'])
        .trim()
        .to_string()
}

fn normalize_artist_text(value: &str) -> String {
    let mut next = replace_case_insensitive(value, "feat.", "/");
    next = replace_case_insensitive(&next, "feat", "/");
    next = replace_case_insensitive(&next, "ft.", "/");
    next = replace_case_insensitive(&next, "ft", "/");
    next = replace_case_insensitive(&next, "with", "/");
    next = replace_case_insensitive(&next, " x ", "/");
    next = next.replace(['、', '，', ',', '&', '+', '／'], "/");

    let artists = next
        .split('/')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    artists.join(" / ")
}

fn infer_artist_and_title_from_plain_text(value: &str) -> Option<(String, String)> {
    let compact = collapse_spaces(value);
    let parts = compact.split(' ').filter(|part| !part.is_empty()).collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }

    Some((
        normalize_artist_text(parts[0]),
        parts[1..].join(" "),
    ))
}

fn is_noise_text(value: &str) -> bool {
    let normalized = cleanup_title_text(value)
        .unwrap_or_default()
        .to_lowercase();
    if normalized.is_empty() {
        return true;
    }

    noise_phrases()
        .iter()
        .any(|phrase| normalized.contains(&phrase.to_lowercase()))
}

fn noise_phrases() -> &'static [&'static str] {
    &[
        "hi-res",
        "hires",
        "无损音质",
        "无损",
        "高音质",
        "完整版",
        "官方完整版",
        "官方",
        "歌词版",
        "纯享版",
        "纯享",
        "live",
        "现场版",
        "现场",
        "高清",
        "hq",
        "sq",
        "flac",
        "mv",
        "4k",
        "合集",
        "推荐",
    ]
}

fn replace_case_insensitive(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }

    let haystack_chars = haystack.chars().collect::<Vec<_>>();
    let needle_chars = needle.chars().collect::<Vec<_>>();
    let needle_lower = needle.to_lowercase();
    let mut index = 0;
    let mut result = String::new();

    while index < haystack_chars.len() {
        let remaining = haystack_chars[index..].iter().take(needle_chars.len()).collect::<String>();
        if remaining.to_lowercase() == needle_lower {
            result.push_str(replacement);
            index += needle_chars.len();
        } else {
            result.push(haystack_chars[index]);
            index += 1;
        }
    }

    result
}

fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn save_api_key(api_key: &str) -> Result<(), String> {
    let _ = Command::new("security")
        .args(["delete-generic-password", "-s", "Needle AI API Key"])
        .output();
    Command::new("security")
        .args([
            "add-generic-password",
            "-s",
            "Needle AI API Key",
            "-a",
            "Needle",
            "-w",
            api_key,
        ])
        .status()
        .map_err(to_string)?;
    Ok(())
}

fn load_api_key() -> Result<String, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", "Needle AI API Key", "-w"])
        .output()
        .map_err(to_string)?;
    if !output.status.success() {
        return Err("未找到 AI API Key，请先保存设置".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn find_command(name: &str) -> Option<String> {
    if let Some(path) = Command::new("which")
        .arg(name)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        return Some(path);
    }

    [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/opt/local/bin",
    ]
    .iter()
    .map(|dir| Path::new(dir).join(name))
    .find(|path| path.is_file())
    .map(|path| path.to_string_lossy().to_string())
}

fn build_bilibili_search_url(query: &str) -> String {
    format!(
        "https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword={}",
        urlencoding::encode(query)
    )
}

fn build_bilibili_search_referer(query: &str) -> String {
    format!(
        "https://search.bilibili.com/all?keyword={}",
        urlencoding::encode(query)
    )
}

fn browser_user_agent() -> &'static str {
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
}

fn collect_set_cookie(headers: &header::HeaderMap) -> String {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("; ")
}

fn map_bili_result(raw: BiliRawResult) -> Option<BiliSearchResult> {
    let id = raw.bvid?;
    let title = strip_html(&raw.title.unwrap_or_default());
    let cover_url = normalize_cover_url(&raw.pic.unwrap_or_default());

    Some(BiliSearchResult {
        url: raw
            .arcurl
            .unwrap_or_else(|| format!("https://www.bilibili.com/video/{id}")),
        id,
        title,
        cover_url,
        author: raw.author.unwrap_or_default(),
        duration_seconds: parse_duration(&raw.duration.unwrap_or_default()),
        play_count: raw.play.unwrap_or_default(),
    })
}

fn build_ranking_prompt(query: &str, results: &[BiliSearchResult]) -> String {
    let compact_results: Vec<_> = results
        .iter()
        .map(|result| {
            json!({
                "id": result.id,
                "title": result.title,
                "author": result.author,
                "durationSeconds": result.duration_seconds,
                "playCount": result.play_count
            })
        })
        .collect();
    format!(
        "你是音乐搜索结果筛选助手。\n默认优先原曲、原唱、官方来源、MV、完整版、正常时长、标题干净的结果。\n只有当用户明确要求特定版本时，才优先对应版本，例如 live/现场、翻唱、DJ/remix、伴奏、纯享、粤语版、国语版。\n如果用户只是表达氛围或场景，比如适合夜里写代码听，不等于要求 live、remix、翻唱；这时仍应优先原曲/原唱/完整版。\n不要因为出现 live、热门、播放量高，就优先翻唱片段、混剪、铃声、DJ、教学、合集或剪辑版。\n用户需求：{query}\n候选结果：{}\n只返回 JSON：{{\"candidates\":[{{\"id\":\"BV...\",\"matchReason\":\"...\",\"confidence\":0.9}}]}}",
        serde_json::to_string(&compact_results).unwrap_or_else(|_| "[]".to_string())
    )
}

fn apply_ranking(results: Vec<BiliSearchResult>, ranking: RankingResponse) -> Vec<CandidateTrack> {
    let mut candidates: Vec<CandidateTrack> = ranking
        .candidates
        .into_iter()
        .filter_map(|item| {
            results
                .iter()
                .find(|result| result.id == item.id)
                .cloned()
                .map(|source_result| CandidateTrack {
                    source_result,
                    match_reason: item.match_reason,
                    confidence: item.confidence.clamp(0.0, 1.0),
                    status: "idle".to_string(),
                })
        })
        .collect();
    candidates.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());
    candidates
}

fn strip_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output.trim().to_string()
}

fn normalize_cover_url(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else {
        value.to_string()
    }
}

fn infer_image_mime_type(content_type: Option<&str>, url: &str) -> &'static str {
    if let Some(content_type) = content_type {
        if content_type.starts_with("image/") {
            if content_type.contains("jpeg") || content_type.contains("jpg") {
                return "image/jpeg";
            }
            if content_type.contains("png") {
                return "image/png";
            }
            if content_type.contains("webp") {
                return "image/webp";
            }
            if content_type.contains("gif") {
                return "image/gif";
            }
        }
    }

    let lowercase_url = url.to_ascii_lowercase();
    if lowercase_url.ends_with(".jpg") || lowercase_url.ends_with(".jpeg") {
        return "image/jpeg";
    }
    if lowercase_url.ends_with(".webp") {
        return "image/webp";
    }
    if lowercase_url.ends_with(".gif") {
        return "image/gif";
    }

    "image/png"
}

fn parse_duration(value: &str) -> i64 {
    value
        .split(':')
        .filter_map(|part| part.parse::<i64>().ok())
        .fold(0, |total, part| total * 60 + part)
}

fn default_music_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join("Music").join("Needle"))
        .ok_or_else(|| "无法定位用户主目录".to_string())
}

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn preview_id_hint(url: &str) -> &str {
    url.rsplit('/')
        .next()
        .and_then(|segment| segment.split('?').next())
        .filter(|segment| !segment.is_empty())
        .unwrap_or("preview-track")
}

fn preview_title_hint(url: &str) -> &str {
    preview_id_hint(url)
}

fn build_preview_output_path(id_hint: &str, title_hint: &str) -> PathBuf {
    let safe_id = sanitize_filename(id_hint).trim_matches('.').to_string();
    let safe_title = sanitize_filename(title_hint).trim_matches('.').to_string();
    let same_name = safe_title == safe_id;
    let mut stem_parts = vec!["needle-preview".to_string()];

    if !safe_id.is_empty() {
        stem_parts.push(safe_id);
    }

    if !safe_title.is_empty() && !same_name {
        stem_parts.push(safe_title);
    }

    let stem = stem_parts.join("-");
    let filename = if stem == "needle-preview" {
        "needle-preview-preview-track.m4a".to_string()
    } else {
        format!("{stem}.m4a")
    };
    let dir = std::env::temp_dir().join("needle-preview");
    unique_path(dir.join(filename))
}

fn build_preview_download_args(url: &str, output_path: &Path) -> Vec<String> {
    vec![
        "--no-playlist".to_string(),
        "--socket-timeout".to_string(),
        "15".to_string(),
        "--extract-audio".to_string(),
        "--audio-format".to_string(),
        "m4a".to_string(),
        "--audio-quality".to_string(),
        "0".to_string(),
        "--postprocessor-args".to_string(),
        "ffmpeg:-t 30".to_string(),
        "-o".to_string(),
        output_path.to_string_lossy().to_string(),
        url.to_string(),
    ]
}

fn build_faststart_repack_temp_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("track");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("m4a");
    let filename = format!("{stem}.needle-faststart.tmp.{extension}");
    unique_path(parent.join(filename))
}

fn build_conversion_download_template(final_path: &Path, audio_format: &str) -> String {
    let parent = final_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = final_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("track");
    let staging_path = unique_path(parent.join(format!(
        "{stem}.needle-download.{}",
        normalize_audio_format(audio_format)
    )));
    let staging_stem = staging_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("track.needle-download");

    parent
        .join(format!("{staging_stem}.%(ext)s"))
        .to_string_lossy()
        .to_string()
}

fn build_convert_download_args(url: &str, output_template: &str, audio_format: &str) -> Vec<String> {
    vec![
        "--no-playlist".to_string(),
        "-x".to_string(),
        "--audio-format".to_string(),
        normalize_audio_format(audio_format),
        "--audio-quality".to_string(),
        "0".to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
        "-o".to_string(),
        output_template.to_string(),
        url.to_string(),
    ]
}

fn parse_yt_dlp_reported_output_path(stdout: &[u8]) -> Option<PathBuf> {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
        .map(PathBuf::from)
}

fn resolve_downloaded_audio_path(
    download_template: &Path,
    stdout: &[u8],
    audio_format: &str,
) -> Result<PathBuf, String> {
    if let Some(reported_path) = parse_yt_dlp_reported_output_path(stdout) {
        if reported_path.is_file() {
            return Ok(reported_path);
        }
    }

    let parent = download_template.parent().unwrap_or_else(|| Path::new("."));
    let stem = download_template
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "{} 转换失败：无法解析 yt-dlp 临时模板 {}",
                normalize_audio_format(audio_format).to_uppercase(),
                download_template.display()
            )
        })?;

    let mut candidates = fs::read_dir(parent)
        .map_err(to_string)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| path.file_stem().and_then(|value| value.to_str()) == Some(stem))
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return Err(format!(
            "{} 转换失败：yt-dlp 已完成，但未找到输出文件。临时模板：{}",
            normalize_audio_format(audio_format).to_uppercase(),
            download_template.display()
        ));
    }

    candidates.sort();
    let expected_audio_format = normalize_audio_format(audio_format);
    if let Some(target_path) = candidates
        .iter()
        .find(|path| {
            path.extension().and_then(|value| value.to_str()) == Some(expected_audio_format.as_str())
        })
    {
        return Ok(target_path.clone());
    }

    if candidates.len() == 1 {
        return Ok(candidates.remove(0));
    }

    Err(format!(
        "{} 转换失败：检测到多个临时输出文件，无法确定最终音频：{}",
        expected_audio_format.to_uppercase(),
        candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn build_faststart_repack_args(input_path: &Path, output_path: &Path) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().to_string(),
    ]
}

fn build_audio_metadata_write_args(
    input_path: &Path,
    output_path: &Path,
    title: &str,
    artist: &str,
    audio_format: &str,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-map".to_string(),
        "0".to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-metadata".to_string(),
        format!("title={title}"),
        "-metadata".to_string(),
        format!("artist={artist}"),
    ];

    if normalize_audio_format(audio_format) == "mp3" {
        args.push("-id3v2_version".to_string());
        args.push("3".to_string());
    } else {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push(output_path.to_string_lossy().to_string());
    args
}

async fn repack_m4a_with_faststart(
    ffmpeg: &str,
    input_path: &Path,
    output_path: &Path,
    error_prefix: &str,
) -> Result<(), String> {
    let temp_path = build_faststart_repack_temp_path(output_path);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }

    let output = AsyncCommand::new(ffmpeg)
        .args(build_faststart_repack_args(input_path, &temp_path))
        .output()
        .await
        .map_err(to_string)?;

    if !output.status.success() {
        let _ = fs::remove_file(&temp_path);
        return Err(command_error_message(
            error_prefix,
            &output.stderr,
            &output.stdout,
        ));
    }

    if !temp_path.is_file() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "{error_prefix}：未生成重封装临时文件 {}",
            temp_path.display()
        ));
    }

    if let Err(error) = fs::rename(&temp_path, output_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "{error_prefix}：无法替换原文件 {} -> {}：{}",
            temp_path.display(),
            output_path.display(),
            error
        ));
    }

    if input_path != output_path {
        let _ = fs::remove_file(input_path);
    }

    Ok(())
}

fn replace_file(input_path: &Path, output_path: &Path, error_prefix: &str) -> Result<(), String> {
    if input_path == output_path {
        return Ok(());
    }

    fs::rename(input_path, output_path).map_err(|error| {
        format!(
            "{error_prefix}：无法替换原文件 {} -> {}：{}",
            input_path.display(),
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

async fn write_audio_metadata(
    ffmpeg: &str,
    input_path: &Path,
    title: &str,
    artist: &str,
    audio_format: &str,
) -> Result<(), String> {
    let temp_path = build_faststart_repack_temp_path(input_path);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }

    let output = AsyncCommand::new(ffmpeg)
        .args(build_audio_metadata_write_args(
            input_path,
            &temp_path,
            title,
            artist,
            audio_format,
        ))
        .output()
        .await
        .map_err(to_string)?;

    if !output.status.success() {
        let _ = fs::remove_file(&temp_path);
        return Err(command_error_message(
            "metadata 写入失败",
            &output.stderr,
            &output.stdout,
        ));
    }

    if !temp_path.is_file() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "metadata 写入失败：未生成临时文件 {}",
            temp_path.display()
        ));
    }

    replace_file(&temp_path, input_path, "替换原文件失败").map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error
    })?;

    Ok(())
}

fn command_error_message(prefix: &str, stderr: &[u8], stdout: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr_text.is_empty() {
        return format!("{prefix}：{stderr_text}");
    }

    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();
    if !stdout_text.is_empty() {
        return format!("{prefix}：{stdout_text}");
    }

    prefix.to_string()
}

fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("track")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("m4a")
        .to_string();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));

    for index in 2..1000 {
        let candidate = parent.join(format!("{stem} ({index}).{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    path
}

fn trim_slashes(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::DeleteErrorCode;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cleans_song_metadata_with_book_title_and_multiple_artists() {
        let cleaned = clean_song_metadata("范玮琪/张韶涵《如果的事》", "Music小铁匠");

        assert_eq!(cleaned.title, "如果的事");
        assert_eq!(cleaned.artist, "范玮琪 / 张韶涵");
        assert_eq!(cleaned.source_title, "范玮琪/张韶涵《如果的事》");
        assert_eq!(cleaned.source_author, "Music小铁匠");
    }

    #[test]
    fn cleans_song_metadata_by_removing_noise_tags_and_falling_back() {
        let cleaned = clean_song_metadata("【Hi-Res无损】晴天 官方完整版 HQ", "周杰伦频道");

        assert_eq!(cleaned.title, "晴天");
        assert_eq!(cleaned.artist, "周杰伦频道");
    }

    #[test]
    fn cleans_song_metadata_with_feat_and_multiple_artist_separators() {
        let cleaned = clean_song_metadata("Aimer feat.Eve、milet《ONE》", "官方账号");

        assert_eq!(cleaned.title, "ONE");
        assert_eq!(cleaned.artist, "Aimer / Eve / milet");
    }

    #[test]
    fn migrates_existing_song_rows_to_source_columns() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-song-migration-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();

        conn.execute_batch(
            "CREATE TABLE songs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                source_url TEXT NOT NULL,
                cover_url TEXT NOT NULL,
                local_path TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO songs
              (id, title, artist, source_url, cover_url, local_path, duration_seconds, created_at)
            VALUES
              ('old-1', '原标题', '原作者', 'https://example.com', 'https://example.com/cover.jpg', '/tmp/demo.m4a', 120, '2025-01-01T00:00:00Z');",
        )
        .unwrap();

        create_schema(&conn).unwrap();

        let row = conn
            .query_row(
                "SELECT title, artist, source_title, source_author FROM songs WHERE id = 'old-1'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .unwrap();

        assert_eq!(row.0, "原标题");
        assert_eq!(row.1, "原作者");
        assert_eq!(row.2, "原标题");
        assert_eq!(row.3, "原作者");
    }

    #[test]
    fn migrates_existing_song_rows_to_audio_format_from_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-song-format-migration-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();

        conn.execute_batch(
            "CREATE TABLE songs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                source_url TEXT NOT NULL,
                cover_url TEXT NOT NULL,
                local_path TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO songs
              (id, title, artist, source_url, cover_url, local_path, duration_seconds, created_at)
            VALUES
              ('old-mp3', '原标题', '原作者', 'https://example.com', 'https://example.com/cover.jpg', '/tmp/demo.mp3', 120, '2025-01-01T00:00:00Z');",
        )
        .unwrap();

        create_schema(&conn).unwrap();

        let audio_format: String = conn
            .query_row(
                "SELECT audio_format FROM songs WHERE id = 'old-mp3'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(audio_format, "mp3");
    }

    #[test]
    fn loads_default_ai_settings_when_row_is_missing() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-ai-settings-default-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();

        create_schema(&conn).unwrap();

        let settings = load_ai_settings_from_conn(&conn).unwrap();

        assert_eq!(settings.provider_name, "DeepSeek");
        assert_eq!(settings.base_url, "https://api.deepseek.com/v1");
        assert_eq!(settings.audio_format, "m4a");
        assert_eq!(settings.model, "");
    }

    #[test]
    fn builds_bilibili_search_url_with_encoded_keyword() {
        let url = build_bilibili_search_url("粤语歌 live");

        assert!(url.contains("search_type=video"));
        assert!(url.contains("keyword=%E7%B2%A4%E8%AF%AD%E6%AD%8C%20live"));
    }

    #[test]
    fn builds_bilibili_referer_for_search_page() {
        let referer = build_bilibili_search_referer("粤语歌 live");

        assert_eq!(
            referer,
            "https://search.bilibili.com/all?keyword=%E7%B2%A4%E8%AF%AD%E6%AD%8C%20live"
        );
    }

    #[test]
    fn collects_cookie_pairs_from_set_cookie_headers() {
        let mut headers = header::HeaderMap::new();
        headers.append(
            header::SET_COOKIE,
            "buvid3=abc; Path=/; Domain=.bilibili.com".parse().unwrap(),
        );
        headers.append(
            header::SET_COOKIE,
            "b_nut=123; Path=/; Domain=.bilibili.com".parse().unwrap(),
        );

        assert_eq!(collect_set_cookie(&headers), "buvid3=abc; b_nut=123");
    }

    #[test]
    fn builds_preview_temp_path_in_system_temp_dir() {
        let path = build_preview_output_path("BV1xx411c7mD", "A/B:C?*试听");

        assert!(path.starts_with(std::env::temp_dir()));
        assert_eq!(
            path.extension().and_then(|value| value.to_str()),
            Some("m4a")
        );
        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some("needle-preview-BV1xx411c7mD-A_B_C__试听.m4a")
        );
    }

    #[test]
    fn preview_output_path_falls_back_when_name_becomes_empty() {
        let path = build_preview_output_path("", "   ");

        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some("needle-preview-preview-track.m4a")
        );
    }

    #[test]
    fn infers_jpeg_image_mime_type_from_content_type_header() {
        assert_eq!(
            infer_image_mime_type(Some("image/jpeg"), "https://i1.hdslb.com/bfs/archive/demo"),
            "image/jpeg"
        );
    }

    #[test]
    fn infers_webp_image_mime_type_from_url_extension() {
        assert_eq!(
            infer_image_mime_type(None, "https://i1.hdslb.com/bfs/archive/demo.webp"),
            "image/webp"
        );
    }

    #[test]
    fn falls_back_to_png_when_content_type_is_missing() {
        assert_eq!(
            infer_image_mime_type(None, "https://i1.hdslb.com/bfs/archive/demo"),
            "image/png"
        );
    }

    #[test]
    fn build_ranking_prompt_defaults_to_original_unless_user_requests_a_version() {
        let prompt = build_ranking_prompt(
            "想听江南现场版",
            &[BiliSearchResult {
                id: "BV1".to_string(),
                title: "林俊杰 江南 Live".to_string(),
                url: "https://www.bilibili.com/video/BV1".to_string(),
                cover_url: "https://example.com/cover.jpg".to_string(),
                author: "音乐现场".to_string(),
                duration_seconds: 261,
                play_count: 12000,
            }],
        );

        assert!(prompt.contains("默认优先原曲"));
        assert!(prompt.contains("只有当用户明确要求特定版本时"));
        assert!(prompt.contains("不要因为出现 live"));
    }

    #[test]
    fn builds_preview_download_arguments_with_time_limit() {
        let output_path = Path::new("/tmp/needle-preview.m4a");
        let args =
            build_preview_download_args("https://www.bilibili.com/video/BV1xx411c7mD", output_path);

        assert_eq!(
            args,
            vec![
                "--no-playlist".to_string(),
                "--socket-timeout".to_string(),
                "15".to_string(),
                "--extract-audio".to_string(),
                "--audio-format".to_string(),
                "m4a".to_string(),
                "--audio-quality".to_string(),
                "0".to_string(),
                "--postprocessor-args".to_string(),
                "ffmpeg:-t 30".to_string(),
                "-o".to_string(),
                "/tmp/needle-preview.m4a".to_string(),
                "https://www.bilibili.com/video/BV1xx411c7mD".to_string()
            ]
        );
    }

    #[test]
    fn builds_faststart_repack_arguments_for_copy_rewrap() {
        let input_path = Path::new("/Users/a0000/Music/source.m4a");
        let output_path = Path::new("/Users/a0000/Music/source.needle-faststart.tmp.m4a");
        let args = build_faststart_repack_args(input_path, output_path);

        assert_eq!(
            args,
            vec![
                "-y".to_string(),
                "-i".to_string(),
                "/Users/a0000/Music/source.m4a".to_string(),
                "-c".to_string(),
                "copy".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                "/Users/a0000/Music/source.needle-faststart.tmp.m4a".to_string(),
            ]
        );
    }

    #[test]
    fn builds_faststart_repack_temp_path_next_to_source() {
        let path = Path::new("/tmp/needle-repack/song.m4a");
        let temp_path = build_faststart_repack_temp_path(path);

        assert_eq!(temp_path.parent(), path.parent());
        assert_eq!(
            temp_path.extension().and_then(|value| value.to_str()),
            Some("m4a")
        );
        assert_eq!(
            temp_path.file_name().and_then(|value| value.to_str()),
            Some("song.needle-faststart.tmp.m4a")
        );
    }

    #[test]
    fn builds_m4a_metadata_write_arguments() {
        let args = build_audio_metadata_write_args(
            Path::new("/Users/a0000/Music/source.m4a"),
            Path::new("/Users/a0000/Music/source.needle-faststart.tmp.m4a"),
            "晴天（Live）",
            "周杰伦",
            "m4a",
        );

        assert_eq!(
            args,
            vec![
                "-y".to_string(),
                "-i".to_string(),
                "/Users/a0000/Music/source.m4a".to_string(),
                "-map".to_string(),
                "0".to_string(),
                "-c".to_string(),
                "copy".to_string(),
                "-metadata".to_string(),
                "title=晴天（Live）".to_string(),
                "-metadata".to_string(),
                "artist=周杰伦".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                "/Users/a0000/Music/source.needle-faststart.tmp.m4a".to_string(),
            ]
        );
    }

    #[test]
    fn faststart_repack_temp_path_uses_unique_suffix_when_taken() {
        let dir = std::env::temp_dir().join(format!("needle-repack-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("song.m4a");
        let first_temp = build_faststart_repack_temp_path(&path);
        fs::write(&first_temp, b"occupied").unwrap();

        let second_temp = build_faststart_repack_temp_path(&path);

        assert_ne!(first_temp, second_temp);
        assert!(second_temp
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap()
            .contains("(2)"));

        let _ = fs::remove_file(&first_temp);
    }

    #[test]
    fn builds_conversion_download_template_with_ext_placeholder() {
        let final_path = Path::new("/Users/a0000/Music/song.m4a");
        let template = build_conversion_download_template(final_path, "m4a");

        assert_eq!(template, "/Users/a0000/Music/song.needle-download.%(ext)s");
    }

    #[test]
    fn builds_mp3_conversion_download_template_with_matching_extension() {
        let final_path = Path::new("/Users/a0000/Music/song.mp3");
        let template = build_conversion_download_template(final_path, "mp3");

        assert_eq!(template, "/Users/a0000/Music/song.needle-download.%(ext)s");
    }

    #[test]
    fn builds_convert_download_arguments_with_reported_output_path() {
        let args = build_convert_download_args(
            "https://www.bilibili.com/video/BV1xx411c7mD",
            "/Users/a0000/Music/song.needle-download.%(ext)s",
            "m4a",
        );

        assert_eq!(
            args,
            vec![
                "--no-playlist".to_string(),
                "-x".to_string(),
                "--audio-format".to_string(),
                "m4a".to_string(),
                "--audio-quality".to_string(),
                "0".to_string(),
                "--print".to_string(),
                "after_move:filepath".to_string(),
                "-o".to_string(),
                "/Users/a0000/Music/song.needle-download.%(ext)s".to_string(),
                "https://www.bilibili.com/video/BV1xx411c7mD".to_string(),
            ]
        );
    }

    #[test]
    fn builds_convert_download_arguments_for_mp3() {
        let args = build_convert_download_args(
            "https://www.bilibili.com/video/BV1xx411c7mD",
            "/Users/a0000/Music/song.needle-download.%(ext)s",
            "mp3",
        );

        assert_eq!(args[3], "mp3");
    }

    #[test]
    fn parses_reported_yt_dlp_output_path_from_stdout() {
        let stdout = b"\n/Users/a0000/Music/song.needle-download.m4a\n";

        assert_eq!(
            parse_yt_dlp_reported_output_path(stdout),
            Some(PathBuf::from("/Users/a0000/Music/song.needle-download.m4a"))
        );
    }

    #[test]
    fn finds_downloaded_file_by_template_when_stdout_is_empty() {
        let dir = std::env::temp_dir().join(format!("needle-convert-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let final_path = dir.join("song.m4a");
        let template = build_conversion_download_template(&final_path, "m4a");
        let produced_path = dir.join("song.needle-download.m4a");
        fs::write(&produced_path, b"audio").unwrap();

        let resolved_path =
            resolve_downloaded_audio_path(Path::new(&template), b"", "m4a").unwrap();

        assert_eq!(resolved_path, produced_path);

        let _ = fs::remove_file(&produced_path);
    }

    #[test]
    fn load_songs_filters_missing_local_files_and_removes_stale_rows() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-list-songs-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let existing_path = dir.join("keep.m4a");
        fs::write(&existing_path, b"keep").unwrap();
        let existing_song = Song {
            id: "keep".to_string(),
            title: "Keep".to_string(),
            artist: "Artist".to_string(),
            source_title: "Keep".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/keep".to_string(),
            cover_url: "https://example.com/keep.jpg".to_string(),
            local_path: existing_path.to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 120,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        let missing_song = Song {
            id: "stale".to_string(),
            title: "Stale".to_string(),
            artist: "Artist".to_string(),
            source_title: "Stale".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/stale".to_string(),
            cover_url: "https://example.com/stale.jpg".to_string(),
            local_path: dir.join("missing.m4a").to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 121,
            created_at: "2025-01-02T00:00:00Z".to_string(),
        };

        insert_song_into_conn(&conn, &existing_song).unwrap();
        insert_song_into_conn(&conn, &missing_song).unwrap();

        let songs = load_songs(&conn).unwrap();

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, "keep");
        let remaining_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining_count, 1);
        let remaining_id: String = conn
            .query_row("SELECT id FROM songs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining_id, "keep");
    }

    #[test]
    fn finds_existing_song_by_id_for_conversion_reuse() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-find-song-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let song = Song {
            id: "BV1demo".to_string(),
            title: "Demo".to_string(),
            artist: "Artist".to_string(),
            source_title: "Demo".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/demo".to_string(),
            cover_url: "https://example.com/demo.jpg".to_string(),
            local_path: dir.join("demo.m4a").to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 120,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let found = find_song_by_id(&conn, "BV1demo").unwrap();
        let missing = find_song_by_id(&conn, "missing").unwrap();

        assert_eq!(found.unwrap().local_path, song.local_path);
        assert!(missing.is_none());
    }

    #[test]
    fn reuse_or_purge_existing_song_returns_song_when_file_exists() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-reuse-song-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let local_path = dir.join("keep.m4a");
        fs::write(&local_path, b"keep").unwrap();
        let song = Song {
            id: "BV1reuse".to_string(),
            title: "Reuse".to_string(),
            artist: "Artist".to_string(),
            source_title: "Reuse".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/reuse".to_string(),
            cover_url: "https://example.com/reuse.jpg".to_string(),
            local_path: local_path.to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 180,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let reused = reuse_or_purge_existing_song(&conn, "BV1reuse", "m4a").unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .unwrap();

        assert_eq!(reused.unwrap().local_path, song.local_path);
        assert_eq!(count, 1);
    }

    #[test]
    fn reuse_or_purge_existing_song_does_not_reuse_when_format_changes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-reuse-format-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let local_path = dir.join("keep.m4a");
        fs::write(&local_path, b"keep").unwrap();
        let song = Song {
            id: "BV1reuse-format".to_string(),
            title: "Reuse Format".to_string(),
            artist: "Artist".to_string(),
            source_title: "Reuse Format".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/reuse-format".to_string(),
            cover_url: "https://example.com/reuse-format.jpg".to_string(),
            local_path: local_path.to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 180,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let reused = reuse_or_purge_existing_song(&conn, "BV1reuse-format", "mp3").unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .unwrap();

        assert!(reused.is_none());
        assert_eq!(count, 1);
        assert!(local_path.exists());
    }

    #[test]
    fn reuse_or_purge_existing_song_deletes_stale_row_when_file_is_missing() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-stale-song-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let song = Song {
            id: "BV1stale".to_string(),
            title: "Stale".to_string(),
            artist: "Artist".to_string(),
            source_title: "Stale".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/stale".to_string(),
            cover_url: "https://example.com/stale.jpg".to_string(),
            local_path: dir.join("missing.m4a").to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 181,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let reused = reuse_or_purge_existing_song(&conn, "BV1stale", "m4a").unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .unwrap();

        assert!(reused.is_none());
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_song_from_conn_succeeds_when_row_is_missing() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-delete-missing-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let result = delete_song_from_conn(&conn, "missing-song").unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(result.song_id, "missing-song");
        assert_eq!(result.file_deleted, None);
        assert!(!result.db_row_deleted);
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_song_from_conn_removes_file_and_db_row_when_local_file_exists() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-delete-existing-file-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let local_path = dir.join("existing.m4a");
        fs::write(&local_path, b"fake audio data").unwrap();
        assert!(local_path.exists());

        let song = Song {
            id: "existing-file".to_string(),
            title: "Existing File".to_string(),
            artist: "Artist".to_string(),
            source_title: "Existing File".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/existing-file".to_string(),
            cover_url: "https://example.com/existing-file.jpg".to_string(),
            local_path: local_path.to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 124,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let result = delete_song_from_conn(&conn, &song.id).unwrap();

        assert!(!local_path.exists());
        assert_eq!(result.song_id, song.id);
        assert_eq!(result.file_deleted, Some(true));
        assert!(result.db_row_deleted);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM songs WHERE id = ?1",
                params![song.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_song_from_conn_removes_db_row_when_local_file_is_missing() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-delete-stale-file-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let song = Song {
            id: "missing-file".to_string(),
            title: "Missing File".to_string(),
            artist: "Artist".to_string(),
            source_title: "Missing File".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/missing-file".to_string(),
            cover_url: "https://example.com/missing-file.jpg".to_string(),
            local_path: dir.join("missing.m4a").to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 123,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let result = delete_song_from_conn(&conn, &song.id).unwrap();

        assert_eq!(result.song_id, song.id);
        assert_eq!(result.file_deleted, Some(false));
        assert!(result.db_row_deleted);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM songs WHERE id = ?1",
                params![song.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_song_from_conn_returns_clear_error_when_local_file_delete_fails() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-delete-error-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let local_path = dir.join("not-a-file.m4a");
        fs::create_dir_all(&local_path).unwrap();
        let song = Song {
            id: "delete-error".to_string(),
            title: "Delete Error".to_string(),
            artist: "Artist".to_string(),
            source_title: "Delete Error".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/delete-error".to_string(),
            cover_url: "https://example.com/delete-error.jpg".to_string(),
            local_path: local_path.to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 124,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let error = delete_song_from_conn(&conn, &song.id).unwrap_err();

        assert_eq!(error.code, DeleteErrorCode::FileDeleteFailed);
        assert_eq!(error.path, Some(song.local_path));
        assert!(error.message.contains("删除本地文件失败"));
    }

    #[test]
    fn update_song_metadata_only_changes_title_and_artist() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-update-song-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let local_path = dir.join("edit-target.m4a");
        fs::write(&local_path, b"fake audio data").unwrap();
        let song = Song {
            id: "edit-target".to_string(),
            title: "原标题".to_string(),
            artist: "原歌手".to_string(),
            source_title: "来源标题".to_string(),
            source_author: "来源UP".to_string(),
            source_url: "https://example.com/source".to_string(),
            cover_url: "https://example.com/cover.jpg".to_string(),
            local_path: local_path.to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 124,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let updated = update_song_metadata_in_conn(&conn, "edit-target", "新歌名", "新歌手").unwrap();

        assert_eq!(updated.id, "edit-target");
        assert_eq!(updated.title, "新歌名");
        assert_eq!(updated.artist, "新歌手");
        assert_eq!(updated.source_title, "来源标题");
        assert_eq!(updated.source_author, "来源UP");
        assert_eq!(updated.source_url, "https://example.com/source");
        assert_eq!(updated.local_path, song.local_path);
        assert_eq!(updated.cover_url, "https://example.com/cover.jpg");

        let persisted = find_song_by_id(&conn, "edit-target").unwrap().unwrap();
        assert_eq!(persisted.title, "新歌名");
        assert_eq!(persisted.artist, "新歌手");
        assert_eq!(persisted.source_title, "来源标题");
        assert_eq!(persisted.source_author, "来源UP");
    }

    #[test]
    fn build_m4a_metadata_write_args_preserves_streams_and_writes_title_artist() {
        let input = PathBuf::from("/tmp/input.m4a");
        let output = PathBuf::from("/tmp/output.m4a");

        let args = build_audio_metadata_write_args(&input, &output, "新歌名", "新歌手", "m4a");

        assert_eq!(
            args,
            vec![
                "-y",
                "-i",
                "/tmp/input.m4a",
                "-map",
                "0",
                "-c",
                "copy",
                "-metadata",
                "title=新歌名",
                "-metadata",
                "artist=新歌手",
                "-movflags",
                "+faststart",
                "/tmp/output.m4a"
            ]
        );
    }

    #[test]
    fn build_mp3_metadata_write_args_uses_id3_and_preserves_streams() {
        let input = PathBuf::from("/tmp/input.mp3");
        let output = PathBuf::from("/tmp/output.mp3");

        let args = build_audio_metadata_write_args(&input, &output, "新歌名", "新歌手", "mp3");

        assert_eq!(
            args,
            vec![
                "-y",
                "-i",
                "/tmp/input.mp3",
                "-map",
                "0",
                "-c",
                "copy",
                "-metadata",
                "title=新歌名",
                "-metadata",
                "artist=新歌手",
                "-id3v2_version",
                "3",
                "/tmp/output.mp3"
            ]
        );
    }

    #[test]
    fn ensure_default_chat_session_creates_single_default_row() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-chat-session-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let first = ensure_default_chat_session(&conn).unwrap();
        let second = ensure_default_chat_session(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_sessions", [], |row| row.get(0))
            .unwrap();

        assert_eq!(first.id, DEFAULT_CHAT_SESSION_ID);
        assert_eq!(second.id, DEFAULT_CHAT_SESSION_ID);
        assert_eq!(count, 1);
    }

    #[test]
    fn clear_default_chat_messages_removes_only_default_session_messages() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-clear-chat-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();

        let default_session = ensure_default_chat_session(&conn).unwrap();
        conn.execute(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "secondary",
                "第二会话",
                "2025-01-01T00:00:00Z",
                "2025-01-01T00:00:00Z"
            ],
        )
        .unwrap();

        let default_message = insert_chat_message(
            &conn,
            &AppendChatMessageInput {
                session_id: default_session.id.clone(),
                role: "user".to_string(),
                content: "清空我".to_string(),
                status: "completed".to_string(),
                metadata: json!({"query": "清空我"}),
            },
        )
        .unwrap();
        let secondary_message = insert_chat_message(
            &conn,
            &AppendChatMessageInput {
                session_id: "secondary".to_string(),
                role: "assistant".to_string(),
                content: "别删我".to_string(),
                status: "completed".to_string(),
                metadata: json!({}),
            },
        )
        .unwrap();
        let song = Song {
            id: "song-keep".to_string(),
            title: "保留歌曲".to_string(),
            artist: "Artist".to_string(),
            source_title: "保留歌曲".to_string(),
            source_author: "Artist".to_string(),
            source_url: "https://example.com/song".to_string(),
            cover_url: "https://example.com/song.jpg".to_string(),
            local_path: dir.join("keep.m4a").to_string_lossy().to_string(),
            audio_format: "m4a".to_string(),
            duration_seconds: 180,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        };
        insert_song_into_conn(&conn, &song).unwrap();

        let deleted = clear_default_chat_messages(&conn).unwrap();
        let default_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chat_messages WHERE session_id = ?1",
                params![default_session.id],
                |row| row.get(0),
            )
            .unwrap();
        let secondary_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chat_messages WHERE session_id = ?1",
                params!["secondary"],
                |row| row.get(0),
            )
            .unwrap();
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_sessions", [], |row| row.get(0))
            .unwrap();
        let song_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .unwrap();

        assert_eq!(deleted, 1);
        assert_eq!(default_count, 0);
        assert_eq!(secondary_count, 1);
        assert_eq!(session_count, 2);
        assert_eq!(song_count, 1);
        assert_eq!(default_message.session_id, DEFAULT_CHAT_SESSION_ID);
        assert_eq!(secondary_message.session_id, "secondary");
    }

    #[test]
    fn chat_message_roundtrip_persists_metadata_json() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("needle-chat-message-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("needle.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        let session = ensure_default_chat_session(&conn).unwrap();

        let inserted = insert_chat_message(
            &conn,
            &AppendChatMessageInput {
                session_id: session.id.clone(),
                role: "assistant".to_string(),
                content: "找到 1 个候选".to_string(),
                status: "completed".to_string(),
                metadata: json!({
                    "query": "夜里写代码",
                    "candidates": [{
                        "sourceResult": {
                            "id": "BV1chat",
                            "title": "夜里写代码听的粤语歌",
                            "url": "https://www.bilibili.com/video/BV1chat",
                            "coverUrl": "https://example.com/cover.jpg",
                            "author": "演示作者",
                            "durationSeconds": 200,
                            "playCount": 1234
                        },
                        "matchReason": "风格接近",
                        "confidence": 0.93,
                        "status": "readyToConvert"
                    }]
                }),
            },
        )
        .unwrap();

        let loaded = load_chat_messages(&conn, &session.id).unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, inserted.id);
        assert_eq!(loaded[0].metadata["query"], "夜里写代码");
        assert_eq!(
            loaded[0].metadata["candidates"][0]["sourceResult"]["id"],
            "BV1chat"
        );
    }
}
