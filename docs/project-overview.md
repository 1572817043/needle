# Needle 项目现状说明

## 项目是什么

Needle 是一个 macOS 优先的 AI 本地音乐助手。

核心流程：

1. 用户在聊天框输入想听的歌。
2. App 搜索 B 站公开视频。
3. 本地规则和 AI 共同筛选候选。
4. 用户试听或打开原视频确认。
5. 用户确认后，App 用本机 `yt-dlp + ffmpeg` 转成 `m4a`。
6. 音频保存到 `~/Music/Needle`。
7. 已保存歌曲进入“我的歌曲”，可播放、删除、在 Finder 中显示。

第一版范围仍然是：只支持 B 站公开视频，不做登录、cookie、YouTube、歌词、批量下载和歌单同步。

## 技术栈

### 桌面端

- Tauri v2
- Rust
- SQLite：通过 `rusqlite`
- macOS Keychain：通过系统 `security` 命令保存 AI API Key
- Tauri Shell Plugin：打开外部 B 站原视频链接

### 前端

- React 18
- TypeScript
- Vite
- Vitest
- lucide-react
- 原生 CSS

### 本地外部工具

- `yt-dlp`：B 站音频试听和转音频
- `ffmpeg`：m4a 转换和 faststart 重封装

项目不内置这两个工具，需要用户本机安装。

## 当前主要文件

- `src/App.tsx`：主界面、聊天、搜索、试听、转换、播放、删除、设置、调试日志。
- `src/api.ts`：Tauri 桌面模式和浏览器预览模式 API。
- `src/types.ts`：核心数据类型。
- `src/domain/bridge.ts`：前端调用 Tauri 命令的封装。
- `src/domain/chat.ts`：聊天消息构造和 metadata 处理。
- `src/domain/chatScroll.ts`：聊天自动滚动判定。
- `src/domain/ranking.ts`：本地候选排序规则。
- `src/domain/debugLog.ts`：前端调试日志工具。
- `src/domain/playback.ts`：播放时间、进度、拖动计算。
- `src-tauri/src/lib.rs`：Tauri 后端命令、SQLite、B 站搜索、AI、试听、转换、歌曲库。
- `docs/plan.md`：第一版规划。
- `AGENTS.md`：项目协作和固定 agent team 规则。

## 已实现功能

### 桌面应用基础

- Tauri 桌面窗口可运行。
- Vite 固定端口 `5173`，`strictPort: true`，避免端口错连导致黑屏。
- 图标和 Tauri 构建配置已补齐。

### UI 和布局

- 保留简洁三栏布局：
  - 左侧导航和本机状态。
  - 中间主工作区。
  - 右侧最近歌曲。
  - 底部播放器。
- 风格为浅色、暖白、深绿点缀。
- 输入框固定在底部，发送后不会把输入区挤出视野。

### 聊天界面

- 输入框默认空，用 placeholder 展示示例文案。
- 支持按 `Enter` 发送，并避开中文输入法组合态误触发。
- 用户消息和 assistant 消息按真实聊天结构渲染。
- 候选卡挂在对应 assistant 消息下面。
- 聊天消息和候选 metadata 持久化到 SQLite。
- App 重启后可恢复默认聊天和候选卡。
- 支持清空当前默认聊天：
  - 只删除聊天消息和候选历史。
  - 不删除“我的歌曲”。
  - 不删除本地 m4a。
  - 不删除 AI 设置。
- 聊天区支持自动滚到底部：
  - 用户发送时会跟到底。
  - assistant pending 和候选卡展开后会跟到底。
  - 用户翻历史时不会强行拉回底部。

### 本机工具检测

- 启动时检测 `yt-dlp` 和 `ffmpeg`。
- 兼容常见路径：
  - `/opt/homebrew/bin`
  - `/usr/local/bin`
  - `/usr/bin`
  - `/bin`
  - `/opt/local/bin`

### AI 设置

- 支持 OpenAI 兼容接口。
- 设置项包括：
  - 服务商
  - Base URL
  - API Key
  - 模型
  - 获取模型
  - 保存并测试
- API Key 存 macOS Keychain。
- 普通设置存 SQLite。
- 支持从 `/v1/models` 获取模型，也支持自定义模型名。

### B 站搜索

- 后端调用 B 站非官方搜索接口。
- 请求中带浏览器 UA、Referer、Origin、Accept-Language 等头。
- 搜索结果解析为：
  - BV id
  - 标题
  - 链接
  - 封面
  - UP 主
  - 时长
  - 播放量

### 候选筛选

- 当前是“本地规则 + AI 精排”的混合排序。
- 核心产品原则：
  - 默认优先原曲、原唱、官方、MV、完整版、正常时长、标题干净的结果。
  - 只有用户明确要求特定版本时，才优先对应版本。
- 已识别版本意图：
  - `live / 现场 / 演唱会`
  - `翻唱 / cover`
  - `DJ / remix / 混音`
  - `伴奏`
  - `纯享`
  - `官方 / MV`
  - `完整版`
  - `粤语版 / 国语版`
- 氛围需求不等于版本需求。
  - 例如“适合夜里写代码听的粤语歌”仍默认偏向原曲/原唱/完整版，而不是 live/remix/翻唱。
- AI prompt 已同步上述原则。
- ranking harness 当前覆盖默认原曲、明确现场、完整版、氛围需求等样例。

### 试听

- 试听通过后端 `yt-dlp` 生成临时 m4a。
- 再由 `ffmpeg` 重封装。
- 前端用 data URL 播放。
- 试听失败时保留“打开原视频”兜底。

### 转换

- 点击“转音频”后使用 `yt-dlp` 转为 `m4a`。
- 转换后使用 `ffmpeg -movflags +faststart` 重封装。
- 已处理常见时长和拖动问题，避免 `0/0`、不可拖动。
- 同一个 BV 已存在且文件存在时，不重复转换，直接播放。
- 如果数据库记录存在但本地文件已丢失，会清理旧记录后重新转换。

### 本地歌曲库

- 歌曲元数据保存到 SQLite。
- 本地文件默认保存到 `~/Music/Needle`。
- “我的歌曲”主页面已做成更完整的音乐库列表：
  - 封面
  - 歌名
  - 作者
  - 时长
  - 本地状态
  - 来源
  - 播放
  - Finder
  - 删除
- 右侧栏保留最近 5 首的极简视图。
- 当前播放歌曲有高亮。
- 启动加载歌曲时会清理本地文件已不存在的旧数据库记录。

### 播放器

- 底部播放器支持：
  - 播放/暂停
  - 当前时间/总时长
  - 进度条跟随播放
  - 拖动进度
  - 封面/标题/作者显示
- 本地 m4a 和试听音频都能进入播放器。

### 删除歌曲

- 删除歌曲前有确认弹窗。
- 删除会：
  - 删除 SQLite 歌曲记录。
  - 默认删除本地文件。
  - 如果本地文件已不存在，仍会清理数据库记录。
- 删除结果通过结构化 `DeleteResult` / `DeleteError` 返回。
- 删除链路中的开发期诊断日志已清理，只保留错误返回。

### 调试日志

- 设置页有“调试日志”面板。
- 前端内存保留最近 100 条日志。
- 支持复制日志和清空日志。
- 覆盖关键流程：
  - 初始化
  - 工具检测
  - 歌曲库加载
  - B 站搜索
  - AI 筛选
  - 试听
  - 转换
  - 删除
  - AI 设置
  - 清空聊天
- 日志不持久化，重启后清空。

## 当前已知风险

### B 站搜索偶发 412

B 站非官方搜索接口仍可能返回：

```text
412 Precondition Failed
```

当前已经有友好提示，但根因没有彻底解决。可能原因包括接口反爬、请求头/cookie 不足、本机网络环境或接口不稳定。

第一版可以接受“偶发失败 + 友好提示 + 打开原视频/换关键词兜底”。后续可考虑搜索词改写、更稳的搜索来源或详情页补充。

### 筛选仍基于标题和元数据

当前没有音频识别，也没有抓评论、弹幕、详情页标签。对标题写法很绕的视频，仍可能依赖 AI 辅助和用户试听确认。

### 试听体验仍可优化

试听现在可用，但每次都需要生成临时音频，速度依赖网络和 `yt-dlp`。后续可以考虑更清晰的 loading 状态、缓存策略或更细的错误提示。

### 聊天仍是单会话

当前只有一个默认聊天会话。已经支持清空聊天，但没有多会话、新建聊天、历史会话列表、重命名等能力。

## 下一步建议

1. 真实 Tauri 桌面窗口做一次全链路回归。
2. 跑 `corepack pnpm tauri:build --debug`，确认 debug `.app` 可启动。
3. 重点观察 B 站搜索 412 出现频率。
4. 如果继续优化筛选，优先考虑搜索词改写和候选详情补充。
5. 如果继续优化聊天，再考虑多会话。

## 推荐 agent team 分工

- 主 Codex：产品判断、拆任务、派发、复核、验证、汇报。
- `gpt-5.4`：跨前后端、Rust/Tauri、数据库、复杂筛选策略。
- `gpt-5.4-mini`：小范围前端体验、样式、测试、局部功能。
- Mimo：真实界面、多模态、手动验收。

默认串行派工，优先复用固定 team，不再为每个小任务开新 agent。

## 常用命令

安装依赖：

```bash
corepack pnpm install
```

前端测试：

```bash
corepack pnpm test
```

ranking 专项测试：

```bash
corepack pnpm test:ranking
```

前端构建：

```bash
corepack pnpm build
```

启动 Tauri 桌面 App：

```bash
corepack pnpm tauri:dev
```

构建 debug App：

```bash
corepack pnpm tauri:build --debug
```

检查本机工具：

```bash
which yt-dlp
which ffmpeg
yt-dlp --version
ffmpeg -version
```

## 当前注意事项

- 当前目录不是 Git 仓库，`git status` 会失败。
- 第一版产品边界仍是 B 站公开视频。
- 不要引入登录、cookie、YouTube、歌词、批量下载、歌单同步。
- `yt-dlp` 和 `ffmpeg` 仍是外部依赖，不随 App 内置。
