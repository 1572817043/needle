import type { BiliSearchResult } from "../types";

type RawBilibiliResult = {
  bvid?: string;
  title?: string;
  arcurl?: string;
  pic?: string;
  author?: string;
  duration?: string | number;
  play?: number;
};

export function buildBilibiliSearchUrl(query: string): string {
  const params = new URLSearchParams({
    search_type: "video",
    keyword: query,
    page: "1"
  });

  return `https://api.bilibili.com/x/web-interface/search/type?${params.toString()}`;
}

export function mapBilibiliResult(raw: RawBilibiliResult): BiliSearchResult {
  const id = raw.bvid ?? "";

  return {
    id,
    title: stripHtml(raw.title ?? ""),
    url: raw.arcurl ?? `https://www.bilibili.com/video/${id}`,
    coverUrl: normalizeCoverUrl(raw.pic ?? ""),
    author: raw.author ?? "",
    durationSeconds: parseDuration(raw.duration ?? 0),
    playCount: raw.play ?? 0
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function normalizeCoverUrl(value: string): string {
  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return value;
}

function parseDuration(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}
