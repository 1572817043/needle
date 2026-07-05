import type { Song } from "../types";

export type SongMetadataDraft = {
  title: string;
  artist: string;
};

export function validateSongMetadataDraft(title: string, artist: string): string | null {
  if (!title.trim()) {
    return "歌名不能为空";
  }

  if (!artist.trim()) {
    return "歌手不能为空";
  }

  return null;
}

export function normalizeSongMetadataDraft(title: string, artist: string): SongMetadataDraft {
  return {
    title: title.trim(),
    artist: artist.trim()
  };
}

export function applySongMetadataUpdate(song: Song, draft: SongMetadataDraft): Song {
  return {
    ...song,
    title: draft.title,
    artist: draft.artist
  };
}
