import { describe, expect, it } from "vitest";
import { buildBilibiliSearchUrl, mapBilibiliResult } from "./bilibili";

describe("bilibili", () => {
  it("builds the Bilibili search API URL for public video search", () => {
    expect(buildBilibiliSearchUrl("林俊杰 江南 live")).toContain(
      "keyword=%E6%9E%97%E4%BF%8A%E6%9D%B0+%E6%B1%9F%E5%8D%97+live"
    );
  });

  it("maps Bilibili API result fields into app search results", () => {
    const result = mapBilibiliResult({
      bvid: "BV123",
      title: "<em class=\"keyword\">江南</em> Live",
      arcurl: "https://www.bilibili.com/video/BV123",
      pic: "//i0.hdslb.com/bfs/archive/demo.jpg",
      author: "音乐现场",
      duration: "04:21",
      play: 12000
    });

    expect(result).toEqual({
      id: "BV123",
      title: "江南 Live",
      url: "https://www.bilibili.com/video/BV123",
      coverUrl: "https://i0.hdslb.com/bfs/archive/demo.jpg",
      author: "音乐现场",
      durationSeconds: 261,
      playCount: 12000
    });
  });
});
