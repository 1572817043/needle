import type { Song } from "../types";

export type PendingDeleteSong = {
  id: string;
  title: string;
  localPath: string;
  isCurrentPlaying: boolean;
};

export function createPendingDeleteSong(
  song: Song,
  activeSongId: string | null
): PendingDeleteSong {
  return {
    id: song.id,
    title: song.title,
    localPath: song.localPath,
    isCurrentPlaying: activeSongId === song.id
  };
}

export function getDeleteConfirmMessage(title: string): string {
  return `删除《${title}》？默认会同时删除本地文件。`;
}
