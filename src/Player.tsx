import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Expand, Minimize, Music2, Pause, Play, Shuffle, Volume2, VolumeX } from 'lucide-react';
import { SlideshowEngine } from './player-engine';
import { EFFECT_LABELS } from '../shared/defaults';
import type { Album, AlbumApi, Effect, PlaybackSettings } from '../shared/types';

export function Player({ album, api, start, onClose, onSettings, onError }: {
  album: Album; api: AlbumApi; start: number; onClose: () => void;
  onSettings: (settings: Partial<PlaybackSettings>) => void; onError: (message: string) => void;
}) {
  const stage = useRef<HTMLDivElement>(null), engine = useRef<SlideshowEngine | null>(null);
  const root = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(start), [playing, setPlaying] = useState(true), [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose), errorRef = useRef(onError);
  closeRef.current = onClose; errorRef.current = onError;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const instance = new SlideshowEngine(stage.current!, album.photos, album.settings, {
      onIndex: setIndex, onPlaying: setPlaying, onError: message => errorRef.current(message),
    }, start);
    engine.current = instance;
    if (window.location.search.includes('diagnostics') || import.meta.env.DEV) {
      (window as any).__playerDiagnostics = { engine: instance, advance: (d: 1 | -1, instant = false) => instance.advance(d, instant), debug: () => instance.debug(),
        audio: () => audio.current && ({ paused: audio.current.paused, loop: audio.current.loop, currentTime: audio.current.currentTime, volume: audio.current.volume, muted: audio.current.muted }) };
    }
    return () => { instance.destroy(); engine.current = null; delete (window as any).__playerDiagnostics; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [album.id, start]);

  useEffect(() => { engine.current?.updateSettings(album.settings); }, [album.settings]);
  useEffect(() => { void api.setPlaybackActive(playing); return () => { void api.setPlaybackActive(false); }; }, [api, playing]);
  useEffect(() => {
    if (!album.music) return;
    const element = new Audio(album.music.src); element.loop = true; element.preload = 'auto'; audio.current = element;
    const failed = () => errorRef.current('这首音乐无法播放，请换一个 MP3、WAV、OGG 或 M4A 文件。');
    element.addEventListener('error', failed);
    return () => { element.pause(); element.removeEventListener('error', failed); element.removeAttribute('src'); element.load(); audio.current = null; };
  }, [album.music?.src]);
  useEffect(() => {
    if (!audio.current) return;
    audio.current.volume = album.settings.volume; audio.current.muted = album.settings.muted;
    if (playing) void audio.current.play().catch(() => errorRef.current('音乐未能开始播放，可以点暂停后再继续，或换一首音乐。'));
    else audio.current.pause();
  }, [playing, album.music?.src, album.settings.volume, album.settings.muted]);

  async function toggleFullscreen() { try { setFullscreen(await api.toggleFullscreen()); } catch { errorRef.current('未能进入全屏，请再试一次。'); } }
  async function close() { if (fullscreen) { await api.toggleFullscreen(); setFullscreen(false); } closeRef.current(); }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Tab') {
        const elements = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, input') || []);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if ((event.target as HTMLElement)?.matches('input, select, textarea')) return;
      if (event.code === 'Space' && !(event.target as HTMLElement)?.matches('button')) { event.preventDefault(); engine.current?.toggle(); setControls(true); }
      if (event.code === 'ArrowRight') { event.preventDefault(); void engine.current?.advance(1, true); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); void engine.current?.advance(-1, true); }
      if (event.code === 'KeyF') { event.preventDefault(); void toggleFullscreen(); }
      if (event.code === 'Escape') { event.preventDefault(); if (fullscreen) void toggleFullscreen(); else closeRef.current(); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [fullscreen]);
  useEffect(() => () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); }, []);
  function showControls() {
    setControls(true); if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => { if (playing) setControls(false); }, 3500);
  }

  return <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" className={`player player-${album.settings.theme}`} data-testid="player" onPointerMove={showControls} onFocusCapture={() => setControls(true)} aria-label={`${album.name}的照片播放`}>
    <div ref={stage} className="slide-stage" data-testid="slide-stage" />
    <div className={`player-chrome ${controls || !playing ? '' : 'is-hidden'}`}>
      <div className="player-top">
        <button className="player-back" onClick={() => void close()}><ArrowLeft size={17} />返回相册</button>
        <div className="player-heading"><span>正在放映</span><strong>{album.name}</strong></div>
        <span className="player-counter"><b>{String(index + 1).padStart(2, '0')}</b><span>/ {String(album.photos.length).padStart(2, '0')}</span></span>
      </div>
      <button className="player-arrow player-arrow-left" aria-label="上一张照片" onClick={() => void engine.current?.advance(-1, !playing)}><ChevronLeft size={30} /></button>
      <button className="player-arrow player-arrow-right" aria-label="下一张照片" onClick={() => void engine.current?.advance(1, !playing)}><ChevronRight size={30} /></button>
      <div className="player-bottom">
        <div className="player-caption"><span>{album.settings.theme === 'warm' ? '暖暖的回忆' : album.settings.theme === 'electric' ? '让回忆发光' : '生活，自有电影感'}</span><p>{album.photos[index]?.name.replace(/\.[^.]+$/, '')}</p></div>
        <div className="player-toolbar" onPointerEnter={() => { if (controlsTimer.current) clearTimeout(controlsTimer.current); }}>
          <div className="playback-buttons">
            <button className="icon-button" aria-label="上一张" onClick={() => void engine.current?.advance(-1, !playing)}><ChevronLeft size={20} /></button>
            <button className="play-round" aria-label={playing ? '暂停播放' : '继续播放'} onClick={() => engine.current?.toggle()}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            <button className="icon-button" aria-label="下一张" onClick={() => void engine.current?.advance(1, !playing)}><ChevronRight size={20} /></button>
          </div>
          <span className="toolbar-divider" />
          <label className="player-effect-label"><span>动效</span><select aria-label="播放动效" value={album.settings.effect} onChange={event => onSettings({ effect: event.target.value as Effect })}>
            {Object.entries(EFFECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button className={`icon-button ${album.settings.randomOrder ? 'active' : ''}`} aria-label="随机播放" aria-pressed={album.settings.randomOrder} onClick={() => onSettings({ randomOrder: !album.settings.randomOrder })}><Shuffle size={19} /></button>
          {album.music && <><span className="toolbar-divider" /><Music2 size={16} className="muted" /><span className="player-song" title={album.music.name}>{album.music.name.replace(/\.[^.]+$/, '')}</span>
            <button className="icon-button" aria-label={album.settings.muted ? '开启声音' : '静音'} onClick={() => onSettings({ muted: !album.settings.muted })}>{album.settings.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
            <input className="player-volume" aria-label="播放音量" type="range" min="0" max="1" step="0.05" value={album.settings.volume} onChange={event => onSettings({ volume: Number(event.target.value) })} />
          </>}
          <span className="toolbar-divider" /><button className="icon-button" aria-label={fullscreen ? '退出全屏' : '进入全屏'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={19} /> : <Expand size={19} />}</button>
        </div>
        <div className="player-hint">空格 暂停 / 继续 <span>← → 切换</span><span>F 全屏</span></div>
      </div>
    </div>
  </section>;
}
