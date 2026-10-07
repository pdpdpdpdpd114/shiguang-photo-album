import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Check, CheckCircle2, ChevronRight, Clapperboard, FolderOpen, Grid2X2, HardDrive, Heart, ImagePlus, Images, LoaderCircle, Music2, Pencil, Play, Plus, Search, ShieldCheck, Sparkles, Star, Trash2, Upload, Volume2, X } from 'lucide-react';
import { browserApi } from './browser-api';
import { Player } from './Player';
import { EFFECT_LABELS } from '../shared/defaults';
import type { Album, Effect, ImportProgress, Library, PlaybackSettings, Theme } from '../shared/types';

const api = window.albumApi || browserApi;
const THEMES: { id: Theme; label: string; description: string; icon: string }[] = [
  { id: 'warm', label: '温馨时光', description: '柔和 · 温暖', icon: '☀' },
  { id: 'cinematic', label: '电影记忆', description: '沉浸 · 细腻', icon: '◈' },
  { id: 'electric', label: '闪耀瞬间', description: '立体 · 灵动', icon: '✧' },
];
function cover(album: Album) { return album.photos.find(photo => photo.id === album.coverId) || album.photos[0]; }
function formatDate(date: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(date)); }

function NameDialog({ title, initial, submitLabel, onClose, onSubmit }: { title: string; initial: string; submitLabel: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null); const [name, setName] = useState(initial), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  async function submit(event: FormEvent) { event.preventDefault(); if (!name.trim()) { setError('给相册起个名字吧'); return; } setPending(true);
    try { await onSubmit(name.trim()); onClose(); } catch (reason) { setError((reason as Error).message); } finally { setPending(false); } }
  return <dialog ref={ref} className="name-dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <form onSubmit={event => void submit(event)}><button type="button" className="icon-button dialog-close" aria-label="关闭" disabled={pending} onClick={onClose}><X size={20} /></button>
      <div className="dialog-mark"><Images size={24} /></div><h2 id="dialog-title">{title}</h2><p>给这段回忆，一个特别的名字。</p>
      <label className="field-label" htmlFor="album-name">相册名称</label><input id="album-name" autoFocus maxLength={80} placeholder="例如：我们的旅行、那些日常…" value={name} onChange={event => { setName(event.target.value); setError(''); }} />
      {error && <p className="field-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={pending}>取消</button><button className="button button-accent" disabled={pending}>{pending && <LoaderCircle size={16} className="spin" />}{submitLabel}</button></div>
    </form>
  </dialog>;
}

function MusicPreview({ album }: { album: Album }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { const element = audio.current; return () => element?.pause(); }, [album.music?.src]);
  return album.music ? <audio ref={audio} controls preload="metadata" src={album.music.src} aria-label="试听背景音乐" /> : null;
}

export function App() {
  const [library, setLibrary] = useState<Library>({ version: 1, albums: [] });
  const [loading, setLoading] = useState(true), [fatal, setFatal] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null), [playing, setPlaying] = useState<{ id: string; start: number } | null>(null);
  const [dialog, setDialog] = useState<'create' | 'rename' | null>(null), [search, setSearch] = useState(''), [sort, setSort] = useState('recent');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false), [dropActive, setDropActive] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean; details?: string[] } | null>(null);
  const [dragPhoto, setDragPhoto] = useState<string | null>(null), [activeNav, setActiveNav] = useState('all');
  const active = library.albums.find(album => album.id === selectedId), playingAlbum = library.albums.find(album => album.id === playing?.id);
  const count = library.albums.reduce((total, album) => total + album.photos.length, 0);
  const hero = library.albums.find(album => album.photos.length) || library.albums[0];

  useEffect(() => {
    let alive = true;
    api.getLibrary().then(result => { if (alive) { setLibrary(result); if (result.warning) setNotice({ message: result.warning, error: true }); } })
      .catch(error => { if (alive) setFatal(error.message || '相册库未能读取'); }).finally(() => { if (alive) setLoading(false); });
    const dispose = api.onImportProgress(setProgress); return () => { alive = false; dispose(); };
  }, []);
  useEffect(() => { setSelectedPhotos(new Set()); }, [selectedId]);
  useEffect(() => {
    if (!notice || notice.error || notice.details?.length) return;
    const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!(import.meta.env.DEV || window.location.search.includes('diagnostics'))) return;
    (window as any).__albumDiagnostics = {
      reload: async () => setLibrary(await api.getLibrary()),
      play: (id: string, start = 0) => setPlaying({ id, start }),
      stop: () => setPlaying(null),
      select: setSelectedId,
      settings: async (id: string, settings: Partial<PlaybackSettings>) => setLibrary(await api.saveSettings(id, settings)),
      state: () => ({ library, selectedId, playing }),
    };
    return () => { delete (window as any).__albumDiagnostics; };
  }, [library, selectedId, playing]);

  const visibleAlbums = useMemo(() => library.albums.filter(album => album.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)), [library, search, sort]);
  function notify(message: string, error = false, details?: string[]) { setNotice({ message, error, details }); }
  async function run(operation: () => Promise<Library | null>, message?: string) {
    setBusy(true);
    try { const result = await operation(); if (result) { setLibrary(result); if (message) notify(message); } return result; }
    catch (error) { notify((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); return null; }
    finally { setBusy(false); }
  }
  async function importPhotos(id: string, kind: 'files' | 'folder' | File[]) {
    if (busy) return; setBusy(true); setProgress({ albumId: id, done: 0, total: 0, name: '准备导入照片…' });
    try {
      const result = await (Array.isArray(kind) ? api.importDropped(id, kind) : api.importPhotos(id, kind));
      if (result) { setLibrary(result.library); notify(`${result.cancelled ? '导入已停止。' : ''}加入 ${result.imported} 张照片${result.skipped ? `，跳过 ${result.skipped} 张重复照片` : ''}${result.failed.length ? `，${result.failed.length} 张未能导入` : ''}。`, result.failed.length > 0,
        result.failed.slice(0, 12).map(item => `${item.name}：${item.reason}`)); }
    } catch (error) { notify((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); }
    finally { setBusy(false); setProgress(null); setDropActive(false); }
  }
  async function dropFiles(files: File[]) {
    if (busy || !files.length) return; let id = selectedId;
    if (!id) { const result = await run(() => api.createAlbum('新的回忆')); if (!result) return; id = result.albums[0].id; setSelectedId(id); }
    await importPhotos(id, files);
  }
  function togglePhoto(id: string) { setSelectedPhotos(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  async function saveSettings(settings: Partial<PlaybackSettings>, id = selectedId) { if (id) await run(() => api.saveSettings(id, settings)); }
  async function reorder(fromId: string, toId: string) {
    if (!active || fromId === toId) return; const ids = active.photos.map(photo => photo.id), from = ids.indexOf(fromId), to = ids.indexOf(toId);
    if (from < 0 || to < 0) return; ids.splice(to, 0, ids.splice(from, 1)[0]); await run(() => api.reorderPhotos(active.id, ids));
  }
  function startAlbum(album: Album, index = 0) { if (album.photos.length) { setSelectedId(album.id); setPlaying({ id: album.id, start: index }); } else notify('先为相册加入几张照片吧'); }

  return <div className="app-shell" data-testid="app-ready" data-loading={loading}>
    <aside className="sidebar" inert={!!playing}>
      <button className="brand" onClick={() => { setSelectedId(null); setActiveNav('all'); }} aria-label="拾光相册首页"><span className="brand-mark"><span /><span /><span /><span /></span><span className="brand-type"><strong>拾光相册</strong><small>SHIGUANG ALBUM</small></span></button>
      <div className="sidebar-section-title">我的空间</div>
      <nav className="main-nav" aria-label="相册导航">
        <button className={activeNav === 'all' ? 'active' : ''} onClick={() => { setSelectedId(null); setActiveNav('all'); setSearch(''); }}><Grid2X2 size={19} /><span>全部相册</span><span className="nav-count">{library.albums.length}</span></button>
        <button className={activeNav === 'recent' ? 'active' : ''} onClick={() => { setSelectedId(null); setActiveNav('recent'); setSort('created'); }}><Heart size={19} /><span>最近添加</span></button>
        <button onClick={() => hero ? startAlbum(hero) : setDialog('create')}><Sparkles size={19} /><span>动效放映</span><span className="nav-dot" /></button>
      </nav>
      <div className="sidebar-section-title albums-label">相册集<span>{library.albums.length}</span></div>
      <div className="sidebar-albums">{library.albums.slice(0, 12).map(album => <button key={album.id} className={selectedId === album.id ? 'active' : ''} onClick={() => setSelectedId(album.id)}>
        {cover(album) ? <img src={cover(album)!.thumbnailSrc} alt="" /> : <span className="mini-empty"><Images size={14} /></span>}<span>{album.name}</span><ChevronRight size={13} />
      </button>)}</div>
      <button className="sidebar-create" disabled={busy} onClick={() => setDialog('create')}><Plus size={16} />创建新相册</button>
      <div className="sidebar-bottom"><div className="local-status"><span className="status-dot" /><span>你的回忆，安心收藏</span></div><p>照片与音乐保存在这台电脑</p><div className="sidebar-storage"><HardDrive size={15} /><span>{library.albums.length} 个相册 · {count} 张照片</span><ShieldCheck size={15} /></div><div className="sidebar-version"><span>拾光相册</span><span>v1.0.0</span></div></div>
    </aside>

    <main className="main-content" inert={!!playing} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); if (!busy) setDropActive(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void dropFiles(Array.from(event.dataTransfer.files)); } setDropActive(false); }}>
      <header className="topbar"><div className="breadcrumbs"><Camera size={17} /><span>我的相册</span><ChevronRight size={14} /><strong>{active?.name || (activeNav === 'recent' ? '最近添加' : '全部相册')}</strong></div>
        <div className="topbar-actions"><span className="offline-tag"><span />离线也能收藏美好</span><button className="button button-accent" disabled={busy} onClick={() => setDialog('create')}><Plus size={17} />新建相册</button></div>
      </header>

      {loading ? <div className="loading-state"><LoaderCircle size={32} className="spin" /><p>正在打开你的回忆…</p></div> : fatal ? <div className="empty-state"><HardDrive size={42} /><h2>相册库未能打开</h2><p>{fatal}</p></div> : active ? <div className="editor-page">
        <button className="text-button back-link" onClick={() => setSelectedId(null)}><ArrowLeft size={16} />全部相册</button>
        <section className="album-heading"><div className="album-heading-cover">{cover(active) ? <img src={cover(active)!.thumbnailSrc} alt="相册封面" /> : <Images size={30} />}</div>
          <div className="album-heading-copy"><span className="eyebrow">一段值得收藏的时光</span><div className="album-title-line"><h1>{active.name}</h1><button className="icon-button" aria-label="重命名相册" disabled={busy} onClick={() => setDialog('rename')}><Pencil size={17} /></button></div><p>{active.photos.length} 张照片 <span>·</span> {active.music ? '已添加背景音乐' : '等待一首合适的歌'} <span>·</span> {formatDate(active.createdAt)}</p></div>
          <div className="album-heading-actions"><button className="button button-secondary" disabled={busy} onClick={() => void importPhotos(active.id, 'files')}><ImagePlus size={17} />添加照片</button><button className="button button-accent" disabled={!active.photos.length || busy} onClick={() => startAlbum(active)}><Play size={17} fill="currentColor" />开始放映</button></div>
        </section>
        <div className="editor-columns"><section className="photos-panel"><div className="panel-heading"><div><h2>照片集<span>{active.photos.length}</span></h2><p>拖动照片调整顺序，点击照片从这一张开始播放。</p></div><button className="text-button" disabled={busy} onClick={() => void importPhotos(active.id, 'folder')}><FolderOpen size={16} />导入文件夹</button></div>
          <div className="selection-toolbar"><button className="text-button" disabled={!active.photos.length || busy} onClick={() => setSelectedPhotos(selectedPhotos.size === active.photos.length ? new Set() : new Set(active.photos.map(p => p.id)))}><span className={`checkbox ${selectedPhotos.size === active.photos.length && active.photos.length ? 'checked' : ''}`}>{selectedPhotos.size === active.photos.length && active.photos.length ? <Check size={11} /> : null}</span>{selectedPhotos.size ? `已选 ${selectedPhotos.size} 张` : '选择照片'}</button>
            {selectedPhotos.size > 0 && <div className="selected-actions"><button className="text-button" disabled={selectedPhotos.size !== 1 || busy} onClick={() => void run(() => api.setCover(active.id, [...selectedPhotos][0]), '相册封面已更新')}><Star size={14} />设为封面</button><button className="text-button danger" disabled={busy} onClick={() => void run(() => api.removePhotos(active.id, [...selectedPhotos])).then(result => { if (result) setSelectedPhotos(new Set()); })}><Trash2 size={14} />移除</button></div>}
          </div>
          {active.photos.length ? <div className="photo-grid">{active.photos.map((photo, index) => <article key={photo.id} className={`photo-card ${selectedPhotos.has(photo.id) ? 'selected' : ''} ${dragPhoto === photo.id ? 'dragging' : ''}`} draggable={!busy}
            onDragStart={event => { setDragPhoto(photo.id); event.dataTransfer.setData('application/x-shiguang-photo', photo.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragPhoto(null)}
            onDragOver={event => { if (dragPhoto) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { const fromId = event.dataTransfer.getData('application/x-shiguang-photo'); if (fromId) { event.preventDefault(); event.stopPropagation(); void reorder(fromId, photo.id); setDragPhoto(null); } }}>
            <button className="photo-open" aria-label={`播放 ${photo.name}`} onClick={() => startAlbum(active, index)}><img src={photo.thumbnailSrc} loading="lazy" alt={photo.name} /><span className="photo-play"><Play size={22} fill="currentColor" /></span></button>
            <button className={`photo-select checkbox ${selectedPhotos.has(photo.id) ? 'checked' : ''}`} aria-label={`选择 ${photo.name}`} aria-pressed={selectedPhotos.has(photo.id)} onClick={() => togglePhoto(photo.id)}>{selectedPhotos.has(photo.id) && <Check size={13} />}</button>
            <span className="photo-number">{String(index + 1).padStart(2, '0')}</span>{photo.id === active.coverId && <span className="cover-tag"><Star size={10} fill="currentColor" />封面</span>}
            <div className="photo-caption"><span title={photo.name}>{photo.name}</span><div className="photo-move"><button aria-label={`前移 ${photo.name}`} disabled={index === 0 || busy} onClick={() => void reorder(photo.id, active.photos[index - 1].id)}><ArrowUp size={12} /></button><button aria-label={`后移 ${photo.name}`} disabled={index === active.photos.length - 1 || busy} onClick={() => void reorder(photo.id, active.photos[index + 1].id)}><ArrowDown size={12} /></button></div></div>
          </article>)}<button className="add-photo-tile" disabled={busy} onClick={() => void importPhotos(active.id, 'files')}><Plus size={25} /><span>再添一点回忆</span></button></div> : <div className="import-empty"><div className="empty-photo-stack"><Images size={36} /></div><h3>把美好，装进这个相册</h3><p>拖入照片，或选择图片与整个文件夹。<br />JPG、PNG、WebP、HEIC 等常见照片都可以。</p><button className="button button-accent" disabled={busy} onClick={() => void importPhotos(active.id, 'files')}><Upload size={16} />选择照片</button><button className="text-button" disabled={busy} onClick={() => void importPhotos(active.id, 'folder')}>导入整个文件夹<ArrowRight size={14} /></button></div>}
        </section>

        <aside className="settings-panel"><div className="settings-title"><Sparkles size={18} /><h2>让回忆动起来</h2></div><div className="settings-section"><label className="field-label">放映氛围</label><div className="theme-options">{THEMES.map(theme => <button key={theme.id} className={`theme-option theme-${theme.id} ${active.settings.theme === theme.id ? 'selected' : ''}`} aria-pressed={active.settings.theme === theme.id} onClick={() => void saveSettings({ theme: theme.id })}><span className="theme-swatch">{theme.icon}</span><span><strong>{theme.label}</strong><small>{theme.description}</small></span>{active.settings.theme === theme.id && <CheckCircle2 size={15} />}</button>)}</div></div>
          <div className="settings-section"><label className="field-label" htmlFor="effect">照片动效</label><select id="effect" value={active.settings.effect} onChange={event => void saveSettings({ effect: event.target.value as Effect })}>{Object.entries(EFFECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><p className="field-help">随心切换会在当前氛围中交替使用不同动效。</p>
            <div className="range-heading"><label className="field-label" htmlFor="duration">每张照片停留</label><span>{active.settings.holdSeconds} <small>秒</small></span></div><input id="duration" type="range" min="3" max="30" step="1" value={active.settings.holdSeconds} onChange={event => void saveSettings({ holdSeconds: Number(event.target.value) })} /><div className="range-labels"><span>轻快 · 3 秒</span><span>慢慢看 · 30 秒</span></div>
            <div className="fit-options"><button className={active.settings.fit === 'contain' ? 'selected' : ''} onClick={() => void saveSettings({ fit: 'contain' })}>完整显示</button><button className={active.settings.fit === 'cover' ? 'selected' : ''} onClick={() => void saveSettings({ fit: 'cover' })}>铺满画面</button></div>
            <label className="switch-row"><span>随机播放照片</span><input type="checkbox" checked={active.settings.randomOrder} onChange={event => void saveSettings({ randomOrder: event.target.checked })} /><span className="switch" /></label><label className="switch-row"><span>循环播放</span><input type="checkbox" checked={active.settings.loop} onChange={event => void saveSettings({ loop: event.target.checked })} /><span className="switch" /></label>
          </div>
          <div className="settings-section music-section"><div className="music-heading"><label className="field-label"><Music2 size={15} />背景音乐</label>{active.music && <button className="icon-button" aria-label="移除背景音乐" disabled={busy} onClick={() => void run(() => api.removeMusic(active.id))}><X size={14} /></button>}</div>
            {active.music ? <><div className="music-file"><span className="music-file-icon"><Music2 size={18} /></span><span title={active.music.name}>{active.music.name}</span><button className="text-button" disabled={busy} onClick={() => void run(() => api.selectMusic(active.id))}>更换</button></div>{!playing && <MusicPreview album={active} />}<div className="volume-row"><Volume2 size={15} /><input aria-label="背景音乐音量" type="range" min="0" max="1" step="0.05" value={active.settings.volume} onChange={event => void saveSettings({ volume: Number(event.target.value) })} /><span>{Math.round(active.settings.volume * 100)}%</span></div></> : <button className="music-add" disabled={busy} onClick={() => void run(() => api.selectMusic(active.id), '背景音乐已加入')}><Plus size={18} /><span>给回忆配一首歌</span><small>MP3 / WAV / OGG / M4A</small></button>}
          </div><button className="text-button delete-album" disabled={busy} onClick={() => void run(() => api.deleteAlbum(active.id)).then(result => { if (result) setSelectedId(null); })}><Trash2 size={14} />移除这个相册</button>
        </aside></div>
      </div> : <div className="library-page">
        <div className="page-intro"><div><div className="eyebrow"><span className="tiny-line" />每一帧，都值得停留</div><h1>把日子，收藏成光。</h1><p>照片里的故事，值得慢慢重温。</p></div><div className="memory-stat"><span className="stat-icon"><Images size={22} /></span><div><strong>{count}<small>张</small></strong><span>珍藏的瞬间</span></div></div></div>
        <section className="hero-card">{hero && cover(hero) ? <img className="hero-image" src={cover(hero)!.src} alt={`${hero.name}封面`} /> : <div className="hero-image hero-placeholder" />}<div className="hero-shade" /><div className="hero-copy"><span className="hero-kicker"><span />让回忆，自由流动</span><h2>打开相册<br />重逢那些美好。</h2><p>选一个相册，一首喜欢的歌。<br />让每个平凡的瞬间，再次闪闪发光。</p><button className="button button-cream" disabled={busy} onClick={() => hero?.photos.length ? startAlbum(hero) : setDialog('create')}><Play size={16} fill="currentColor" />{hero?.photos.length ? '播放我的回忆' : '创建第一本相册'}<ArrowRight size={16} /></button><div className="hero-footnote"><Clapperboard size={14} />10 种照片动效<span />3 种放映氛围</div></div>
          {hero?.photos.length > 0 && <div className="hero-caption"><span className="hero-caption-line" /><span>{hero.name}<small>每一张，都是生活的礼物</small></span><span className="hero-photo-count">{String(hero.photos.length).padStart(2, '0')}<small>PHOTOS</small></span></div>}
          <div className="hero-corner">SHIGUANG / MOMENTS</div>
        </section>
        <section className="albums-section"><div className="albums-header"><div className="section-title"><h2>{activeNav === 'recent' ? '最近添加' : '我的相册'}</h2><span>{library.albums.length} 本回忆</span></div><div className="albums-tools"><label className="search-box"><Search size={16} /><input aria-label="搜索相册" placeholder="寻找一段回忆…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="清除搜索" onClick={() => setSearch('')}><X size={14} /></button>}</label><select className="sort-select" aria-label="相册排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近更新</option><option value="created">最近创建</option><option value="name">按名称</option></select></div></div>
          <div className="album-grid">{visibleAlbums.map(album => <article className="album-card" key={album.id}><button className="album-card-cover" onClick={() => setSelectedId(album.id)} aria-label={`打开相册 ${album.name}`}>
            {cover(album) ? <img src={cover(album)!.thumbnailSrc} alt={`${album.name}封面`} /> : <span className="empty-cover"><Images size={34} /><small>等待回忆入场</small></span>}<span className="album-count"><Images size={12} />{album.photos.length} 张照片</span>{album.isDemo && <span className="demo-tag">示例相册</span>}<span className="album-card-hover"><ArrowRight size={24} /></span>
          </button><div className="album-card-body"><div><button className="album-name" onClick={() => setSelectedId(album.id)}>{album.name}</button><p>{formatDate(album.createdAt)}<span>·</span>{album.music ? '有音乐的回忆' : '留住每一帧'}</p></div><button className="album-quick-play" disabled={!album.photos.length || busy} aria-label={`播放相册 ${album.name}`} onClick={() => startAlbum(album)}><Play size={17} fill="currentColor" /></button></div></article>)}
            {!search && <button className="new-album-card" disabled={busy} onClick={() => setDialog('create')}><span className="new-album-plus"><Plus size={26} /></span><strong>收藏下一段美好</strong><span>创建相册，导入你的照片</span></button>}
          </div>{search && !visibleAlbums.length && <div className="search-empty"><Search size={28} /><p>还没有找到“{search}”相关的相册。</p><button className="text-button" onClick={() => setSearch('')}>查看全部相册</button></div>}
        </section><footer className="page-footer"><span>让每一次回望，都有温度。</span><span><HardDrive size={13} />本机保存<small>·</small>离线播放</span></footer>
      </div>}
      {dropActive && <div className="drop-overlay"><div><Upload size={40} /><h2>松开，把回忆放进来</h2><p>{active ? `照片将加入“${active.name}”` : '为这些照片创建一本新相册'}</p></div></div>}
    </main>

    {dialog && <NameDialog key={dialog} title={dialog === 'create' ? '新建一本相册' : '给相册换个名字'} initial={dialog === 'rename' ? active?.name || '' : ''} submitLabel={dialog === 'create' ? '创建相册' : '保存名称'} onClose={() => setDialog(null)} onSubmit={async name => {
      const result = dialog === 'create' ? await api.createAlbum(name) : await api.renameAlbum(active!.id, name);
      setLibrary(result); if (dialog === 'create') setSelectedId(result.albums[0].id); notify(dialog === 'create' ? '新相册已创建，加入你的第一张照片吧。' : '相册名称已更新');
    }} />}
    {playingAlbum && playing && <Player album={playingAlbum} api={api} start={playing.start} onClose={() => setPlaying(null)} onSettings={settings => void saveSettings(settings, playingAlbum.id)} onError={message => notify(message, true)} />}
    {progress && <div className="import-progress" role="status"><div className="import-progress-icon"><LoaderCircle size={23} className="spin" /></div><div className="import-progress-content"><div><strong>正在装进回忆里</strong><span>{progress.total ? `${progress.done} / ${progress.total}` : '准备中'}</span></div><p>{progress.name}</p><div className="progress-track"><span style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0.03})` }} /></div></div><button className="text-button" onClick={() => void api.cancelImport()}>停止</button></div>}
    {notice && <div className={`notice ${notice.error ? 'notice-error' : ''}`} role={notice.error ? 'alert' : 'status'}><CheckCircle2 size={19} /><div><p>{notice.message}</p>{notice.details?.length ? <details><summary>查看未导入的文件</summary><ul>{notice.details.map((detail, i) => <li key={i}>{detail}</li>)}</ul></details> : null}</div><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={16} /></button></div>}
  </div>;
}
