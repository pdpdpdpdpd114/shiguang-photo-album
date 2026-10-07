export type Theme = 'warm' | 'cinematic' | 'electric';
export type Effect = 'random' | 'fade' | 'slide-x' | 'slide-y' | 'zoom' | 'kenburns' | 'flip' | 'cube' | 'blinds-x' | 'blinds-y' | 'mosaic';
export type Fit = 'contain' | 'cover';

export interface PlaybackSettings {
  theme: Theme;
  effect: Effect;
  holdSeconds: number;
  randomOrder: boolean;
  loop: boolean;
  fit: Fit;
  volume: number;
  muted: boolean;
}

export interface Photo {
  id: string;
  name: string;
  src: string;
  thumbnailSrc: string;
  width: number;
  height: number;
  size: number;
  format: string;
}

export interface Music { id: string; name: string; src: string; }
export interface Album {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coverId: string | null;
  photos: Photo[];
  music: Music | null;
  settings: PlaybackSettings;
  isDemo?: boolean;
}
export interface Library { version: 1; albums: Album[]; warning?: string; }
export interface ImportProgress { albumId: string; done: number; total: number; name: string; }
export interface ImportResult {
  library: Library;
  imported: number;
  skipped: number;
  failed: { name: string; reason: string }[];
  cancelled?: boolean;
}

export interface AlbumApi {
  isDesktop: boolean;
  getLibrary(): Promise<Library>;
  createAlbum(name: string): Promise<Library>;
  renameAlbum(id: string, name: string): Promise<Library>;
  deleteAlbum(id: string): Promise<Library | null>;
  importPhotos(id: string, kind: 'files' | 'folder'): Promise<ImportResult | null>;
  importDropped(id: string, files: File[]): Promise<ImportResult | null>;
  cancelImport(): Promise<void>;
  reorderPhotos(id: string, ids: string[]): Promise<Library>;
  setCover(id: string, photoId: string): Promise<Library>;
  removePhotos(id: string, photoIds: string[]): Promise<Library | null>;
  selectMusic(id: string): Promise<Library | null>;
  removeMusic(id: string): Promise<Library>;
  saveSettings(id: string, settings: Partial<PlaybackSettings>): Promise<Library>;
  toggleFullscreen(): Promise<boolean>;
  setPlaybackActive(active: boolean): Promise<void>;
  onImportProgress(callback: (progress: ImportProgress) => void): () => void;
}

declare global { interface Window { albumApi?: AlbumApi; } }
