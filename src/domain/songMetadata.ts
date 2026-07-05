import type { Song } from "../types";

const NOISE_PHRASES = [
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
  "推荐"
];

const NOISE_BRACKET_PATTERNS = [
  /【([^】]*)】/g,
  /\[([^\]]*)\]/g,
  /（([^）]*)）/g,
  /\(([^)]*)\)/g
];

export function cleanSongMetadata(sourceTitle: string, sourceAuthor: string): Pick<
  Song,
  "title" | "artist" | "sourceTitle" | "sourceAuthor"
> {
  const normalizedSourceTitle = sourceTitle.trim();
  const normalizedSourceAuthor = sourceAuthor.trim();
  const withoutNoiseBrackets = stripNoiseBrackets(normalizedSourceTitle);
  const bookTitleMatch = withoutNoiseBrackets.match(/《([^》]+)》/);
  const cleanedFallbackTitle = cleanupTitleText(withoutNoiseBrackets) || normalizedSourceTitle;

  if (!bookTitleMatch) {
    const inferred = inferArtistAndTitleFromPlainText(cleanedFallbackTitle);
    return {
      title: inferred?.title ?? cleanedFallbackTitle,
      artist: inferred?.artist ?? normalizedSourceAuthor,
      sourceTitle: normalizedSourceTitle,
      sourceAuthor: normalizedSourceAuthor
    };
  }

  const extractedTitle = cleanupTitleText(bookTitleMatch[1]) || cleanedFallbackTitle;
  const prefix = cleanupArtistPrefix(withoutNoiseBrackets.slice(0, bookTitleMatch.index));
  const extractedArtist = normalizeArtistText(prefix);

  return {
    title: extractedTitle,
    artist: extractedArtist || normalizedSourceAuthor,
    sourceTitle: normalizedSourceTitle,
    sourceAuthor: normalizedSourceAuthor
  };
}

function stripNoiseBrackets(value: string): string {
  let next = value;

  for (const pattern of NOISE_BRACKET_PATTERNS) {
    next = next.replace(pattern, (segment, inner: string) => (isNoiseText(inner) ? " " : segment));
  }

  return collapseSpaces(next);
}

function cleanupTitleText(value: string): string {
  let next = collapseSpaces(value)
    .replace(/《|》/g, " ")
    .replace(/[【】[\]()（）]/g, " ");

  for (const phrase of NOISE_PHRASES) {
    next = next.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
  }

  next = next
    .replace(/\b(?:feat\.?|ft\.?)\b/gi, " ")
    .replace(/[|·•]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return next;
}

function cleanupArtistPrefix(value: string): string {
  let next = collapseSpaces(value)
    .replace(/《|》/g, " ")
    .replace(/[【】[\]()（）]/g, " ");

  for (const phrase of NOISE_PHRASES.filter((phrase) => !["live"].includes(phrase))) {
    next = next.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
  }

  return next
    .replace(/[:：]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArtistText(value: string): string {
  if (!value) {
    return "";
  }

  const replaced = value
    .replace(/\b(?:feat\.?|ft\.?|with|x)\b/gi, "/")
    .replace(/[、，,&+／/]+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  const artists = replaced
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);

  return artists.join(" / ");
}

function inferArtistAndTitleFromPlainText(value: string): { title: string; artist: string } | null {
  const compact = collapseSpaces(value);
  if (!compact.includes(" ")) {
    return null;
  }

  const parts = compact.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return {
    artist: normalizeArtistText(parts[0]),
    title: parts.slice(1).join(" ")
  };
}

function isNoiseText(value: string): boolean {
  const normalized = cleanupTitleText(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  return NOISE_PHRASES.some((phrase) => normalized.includes(phrase.toLowerCase()));
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
