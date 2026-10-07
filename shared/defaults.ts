import type { Effect, PlaybackSettings, Theme } from './types.js';

export const DEFAULT_SETTINGS: PlaybackSettings = {
  theme: 'cinematic', effect: 'random', holdSeconds: 5, randomOrder: false,
  loop: true, fit: 'contain', volume: 0.5, muted: false,
};
export const EFFECT_LABELS: Record<Effect, string> = {
  random: '随心切换', fade: '柔和淡化', 'slide-x': '横向滑动', 'slide-y': '纵向滑动',
  zoom: '缩放穿越', kenburns: '慢慢推拉', flip: '立体翻页', cube: '立方体旋转',
  'blinds-x': '横向百叶', 'blinds-y': '纵向百叶', mosaic: '棋盘格显现',
};
export const THEME_EFFECTS: Record<Theme, Effect[]> = {
  warm: ['fade', 'kenburns', 'zoom', 'slide-x', 'blinds-y'],
  cinematic: ['kenburns', 'fade', 'slide-x', 'slide-y', 'zoom', 'blinds-x'],
  electric: ['flip', 'cube', 'mosaic', 'blinds-x', 'blinds-y', 'zoom', 'slide-x', 'slide-y'],
};
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif'];
export const MUSIC_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];
