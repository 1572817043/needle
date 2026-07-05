import { describe, expect, it } from "vitest";
import { cleanSongMetadata } from "./songMetadata";

describe("songMetadata", () => {
  it("优先从书名号提取歌名，并从前缀提取歌手", () => {
    expect(cleanSongMetadata("范玮琪/张韶涵《如果的事》", "Music小铁匠")).toEqual({
      title: "如果的事",
      artist: "范玮琪 / 张韶涵",
      sourceTitle: "范玮琪/张韶涵《如果的事》",
      sourceAuthor: "Music小铁匠"
    });
  });

  it("去掉纯噪声括号标签和常见音质噪声", () => {
    expect(cleanSongMetadata("【Hi-Res无损】范玮琪/张韶涵《如果的事》官方完整版 4K", "Music小铁匠"))
      .toEqual({
        title: "如果的事",
        artist: "范玮琪 / 张韶涵",
        sourceTitle: "【Hi-Res无损】范玮琪/张韶涵《如果的事》官方完整版 4K",
        sourceAuthor: "Music小铁匠"
      });
  });

  it("无书名号时回退为清理后的原标题和来源作者", () => {
    expect(cleanSongMetadata("【Hi-Res无损】晴天 官方完整版 HQ", "周杰伦频道")).toEqual({
      title: "晴天",
      artist: "周杰伦频道",
      sourceTitle: "【Hi-Res无损】晴天 官方完整版 HQ",
      sourceAuthor: "周杰伦频道"
    });
  });

  it("统一多歌手分隔符", () => {
    expect(cleanSongMetadata("Aimer feat.Eve、milet《ONE》", "官方账号")).toEqual({
      title: "ONE",
      artist: "Aimer / Eve / milet",
      sourceTitle: "Aimer feat.Eve、milet《ONE》",
      sourceAuthor: "官方账号"
    });
  });
});
