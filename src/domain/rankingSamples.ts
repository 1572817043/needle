import type { RankingSample } from "./ranking";

export const rankingSamples: RankingSample[] = [
  {
    name: "默认优先原曲官方完整版",
    query: "江南",
    expectedTopIds: ["jiangnan-original"],
    results: [
      {
        id: "jiangnan-cover",
        title: "江南 live 翻唱片段",
        url: "https://www.bilibili.com/video/jiangnan-cover",
        coverUrl: "https://example.com/jiangnan-cover.jpg",
        author: "路人翻唱",
        durationSeconds: 68,
        playCount: 160
      },
      {
        id: "jiangnan-live",
        title: "林俊杰 江南 现场版 高清",
        url: "https://www.bilibili.com/video/jiangnan-live",
        coverUrl: "https://example.com/jiangnan-live.jpg",
        author: "音乐现场",
        durationSeconds: 261,
        playCount: 12000
      },
      {
        id: "jiangnan-remix",
        title: "江南 DJ 混剪",
        url: "https://www.bilibili.com/video/jiangnan-remix",
        coverUrl: "https://example.com/jiangnan-remix.jpg",
        author: "剪辑频道",
        durationSeconds: 205,
        playCount: 5200
      },
      {
        id: "jiangnan-original",
        title: "林俊杰《江南》官方完整版 MV",
        url: "https://www.bilibili.com/video/jiangnan-original",
        coverUrl: "https://example.com/jiangnan-original.jpg",
        author: "林俊杰官方频道",
        durationSeconds: 267,
        playCount: 88000
      }
    ],
    aiCandidates: [
      {
        sourceResult: {
          id: "jiangnan-cover",
          title: "江南 live 翻唱片段",
          url: "https://www.bilibili.com/video/jiangnan-cover",
          coverUrl: "https://example.com/jiangnan-cover.jpg",
          author: "路人翻唱",
          durationSeconds: 68,
          playCount: 160
        },
        confidence: 0.96,
        matchReason: "包含 live 关键词",
        status: "idle"
      }
    ]
  },
  {
    name: "明确要求现场时现场版优先",
    query: "江南 live 现场",
    expectedTopIds: ["jiangnan-live"],
    results: [
      {
        id: "jiangnan-cover",
        title: "江南 live 翻唱片段",
        url: "https://www.bilibili.com/video/jiangnan-cover",
        coverUrl: "https://example.com/jiangnan-cover.jpg",
        author: "路人翻唱",
        durationSeconds: 68,
        playCount: 160
      },
      {
        id: "jiangnan-live",
        title: "林俊杰 江南 现场版 高清",
        url: "https://www.bilibili.com/video/jiangnan-live",
        coverUrl: "https://example.com/jiangnan-live.jpg",
        author: "音乐现场",
        durationSeconds: 261,
        playCount: 12000
      },
      {
        id: "jiangnan-original",
        title: "林俊杰《江南》官方完整版 MV",
        url: "https://www.bilibili.com/video/jiangnan-original",
        coverUrl: "https://example.com/jiangnan-original.jpg",
        author: "林俊杰官方频道",
        durationSeconds: 267,
        playCount: 88000
      }
    ],
    aiCandidates: [
      {
        sourceResult: {
          id: "jiangnan-cover",
          title: "江南 live 翻唱片段",
          url: "https://www.bilibili.com/video/jiangnan-cover",
          coverUrl: "https://example.com/jiangnan-cover.jpg",
          author: "路人翻唱",
          durationSeconds: 68,
          playCount: 160
        },
        confidence: 0.96,
        matchReason: "包含 live 关键词",
        status: "idle"
      }
    ]
  },
  {
    name: "完整版优先于铃声剪辑",
    query: "周杰伦 晴天 完整版",
    expectedTopIds: ["qt-full"],
    results: [
      {
        id: "qt-ringtone",
        title: "晴天 铃声版 30秒",
        url: "https://www.bilibili.com/video/qt-ringtone",
        coverUrl: "https://example.com/qt-ringtone.jpg",
        author: "铃声库",
        durationSeconds: 30,
        playCount: 2200
      },
      {
        id: "qt-full",
        title: "周杰伦 晴天 完整版 高音质",
        url: "https://www.bilibili.com/video/qt-full",
        coverUrl: "https://example.com/qt-full.jpg",
        author: "音乐收藏馆",
        durationSeconds: 269,
        playCount: 18000
      },
      {
        id: "qt-edit",
        title: "晴天 混剪 剧情向",
        url: "https://www.bilibili.com/video/qt-edit",
        coverUrl: "https://example.com/qt-edit.jpg",
        author: "剪辑频道",
        durationSeconds: 201,
        playCount: 9100
      }
    ],
    aiCandidates: [
      {
        sourceResult: {
          id: "qt-edit",
          title: "晴天 混剪 剧情向",
          url: "https://www.bilibili.com/video/qt-edit",
          coverUrl: "https://example.com/qt-edit.jpg",
          author: "剪辑频道",
          durationSeconds: 201,
          playCount: 9100
        },
        confidence: 0.88,
        matchReason: "播放量和标题词较多",
        status: "idle"
      }
    ]
  },
  {
    name: "氛围需求下仍默认原曲优先",
    query: "适合夜里写代码听的粤语歌",
    expectedTopIds: ["yeyue-original"],
    results: [
      {
        id: "yeyue-original",
        title: "陈奕迅 富士山下 官方完整版",
        url: "https://www.bilibili.com/video/yeyue-original",
        coverUrl: "https://example.com/yeyue-original.jpg",
        author: "官方音乐频道",
        durationSeconds: 281,
        playCount: 62000
      },
      {
        id: "yeyue-live",
        title: "富士山下 live 现场版",
        url: "https://www.bilibili.com/video/yeyue-live",
        coverUrl: "https://example.com/yeyue-live.jpg",
        author: "音乐现场",
        durationSeconds: 286,
        playCount: 16000
      },
      {
        id: "yeyue-remix",
        title: "富士山下 DJ Remix",
        url: "https://www.bilibili.com/video/yeyue-remix",
        coverUrl: "https://example.com/yeyue-remix.jpg",
        author: "DJ阿杰",
        durationSeconds: 243,
        playCount: 21000
      },
      {
        id: "yeyue-cover",
        title: "富士山下 粤语翻唱",
        url: "https://www.bilibili.com/video/yeyue-cover",
        coverUrl: "https://example.com/yeyue-cover.jpg",
        author: "翻唱达人",
        durationSeconds: 278,
        playCount: 11000
      }
    ]
  }
];
