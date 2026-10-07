import { THEME_EFFECTS } from '../shared/defaults';
import { PlaybackOrder } from '../shared/playback';
import type { Effect, Photo, PlaybackSettings } from '../shared/types';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_MOVE = 'cubic-bezier(0.77, 0, 0.175, 1)';
type Callbacks = { onIndex: (index: number) => void; onPlaying: (playing: boolean) => void; onError: (message: string) => void; };

export class SlideshowEngine {
  private order: PlaybackOrder;
  private settings: PlaybackSettings;
  private playing = true;
  private destroyed = false;
  private generation = 0;
  private currentLayer: HTMLDivElement | null = null;
  private animations: Animation[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = 0;
  private remaining: number;
  private phase: 'loading' | 'transition' | 'hold' = 'loading';
  private lastEffect: Effect | null = null;
  private cache = new Map<string, Promise<HTMLImageElement>>();
  private failed = new Set<string>();
  private reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  private motionChanged = () => { void this.show(this.order.current, true); };
  transitions = 0;

  constructor(private host: HTMLElement, private photos: Photo[], settings: PlaybackSettings, private callbacks: Callbacks, start = 0) {
    this.settings = { ...settings }; this.remaining = settings.holdSeconds * 1000;
    this.order = new PlaybackOrder(photos.length, settings.randomOrder, settings.loop, start);
    this.reduce.addEventListener('change', this.motionChanged);
    void this.show(this.order.current, true);
  }

  private load(photo: Photo): Promise<HTMLImageElement> {
    let ready = this.cache.get(photo.id);
    if (!ready) {
      ready = new Promise((resolve, reject) => {
        const image = new Image(); image.decoding = 'async';
        image.onload = () => { image.onload = null; image.onerror = null; resolve(image); };
        image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error(`无法读取“${photo.name}”，已跳过。`)); };
        image.src = photo.src;
      });
      this.cache.set(photo.id, ready);
      while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
    }
    return ready;
  }

  private layer(photo: Photo): HTMLDivElement {
    const layer = document.createElement('div'); layer.className = 'slide-layer';
    const backdrop = document.createElement('div'); backdrop.className = 'slide-ambience'; backdrop.style.backgroundImage = `url(${JSON.stringify(photo.src)})`;
    const image = document.createElement('img'); image.className = 'slide-image'; image.src = photo.src;
    image.alt = photo.name; image.draggable = false; image.style.objectFit = this.settings.fit;
    layer.append(backdrop, image); return layer;
  }

  private chooseEffect(): Effect {
    if (this.reduce.matches) return 'fade';
    if (this.settings.effect !== 'random') return this.settings.effect;
    const effects = THEME_EFFECTS[this.settings.theme].filter(effect => effect !== this.lastEffect);
    return effects[Math.floor(Math.random() * effects.length)] ?? 'fade';
  }

  private animate(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions = {}): Animation {
    const animation = element.animate(frames, { duration: this.reduce.matches ? 200 : 700, easing: EASE_OUT, fill: 'both', ...options });
    if (!this.playing) animation.pause();
    this.animations.push(animation); return animation;
  }

  private transition(incoming: HTMLDivElement, outgoing: HTMLDivElement, effect: Effect): Animation[] {
    const results: Animation[] = []; const add = (node: Element, frames: Keyframe[], options?: KeyframeAnimationOptions) => results.push(this.animate(node, frames, options));
    incoming.style.zIndex = '2'; outgoing.style.zIndex = '1';
    if (effect === 'blinds-x' || effect === 'blinds-y' || effect === 'mosaic') {
      incoming.style.opacity = '0';
      const rows = effect === 'mosaic' ? 4 : effect === 'blinds-x' ? 8 : 1;
      const columns = effect === 'mosaic' ? 6 : effect === 'blinds-y' ? 10 : 1;
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const fragment = incoming.cloneNode(true) as HTMLDivElement; fragment.classList.add('slide-fragment'); fragment.style.opacity = '1'; fragment.style.zIndex = '3';
        const top = row * 100 / rows, bottom = 100 - (row + 1) * 100 / rows;
        const left = column * 100 / columns, right = 100 - (column + 1) * 100 / columns;
        const middleY = (row + 0.5) * 100 / rows, middleX = (column + 0.5) * 100 / columns;
        const closed = effect === 'blinds-x' ? `inset(${middleY}% ${right}% ${100 - middleY}% ${left}%)`
          : effect === 'blinds-y' ? `inset(${top}% ${100 - middleX}% ${bottom}% ${middleX}%)`
          : `inset(${middleY}% ${100 - middleX}% ${100 - middleY}% ${middleX}%)`;
        this.host.append(fragment);
        add(fragment, [{ clipPath: closed, opacity: 0 }, { clipPath: `inset(${top}% ${right}% ${bottom}% ${left}%)`, opacity: 1 }],
          { duration: 500, delay: effect === 'mosaic' ? (row + column) * 25 : (row + column) * 20, easing: EASE_MOVE });
      }
      return results;
    }
    switch (effect) {
      case 'slide-x':
        add(incoming, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { easing: EASE_MOVE });
        add(outgoing, [{ transform: 'translateX(0)' }, { transform: 'translateX(-28%)', opacity: 0.6 }], { easing: EASE_MOVE }); break;
      case 'slide-y':
        add(incoming, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { easing: EASE_MOVE });
        add(outgoing, [{ transform: 'translateY(0)' }, { transform: 'translateY(-25%)', opacity: 0.6 }], { easing: EASE_MOVE }); break;
      case 'zoom':
        add(incoming, [{ transform: 'scale(1.12)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]);
        add(outgoing, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.96)', opacity: 0 }]); break;
      case 'flip':
        incoming.style.transformOrigin = '50% 50%';
        add(incoming, [{ transform: 'perspective(1600px) rotateY(-70deg)', opacity: 0 }, { transform: 'perspective(1600px) rotateY(0deg)', opacity: 1 }], { easing: EASE_MOVE });
        add(outgoing, [{ transform: 'perspective(1600px) rotateY(0deg)', opacity: 1 }, { transform: 'perspective(1600px) rotateY(70deg)', opacity: 0 }], { easing: EASE_MOVE }); break;
      case 'cube':
        incoming.style.transformOrigin = '0% 50%'; outgoing.style.transformOrigin = '100% 50%';
        add(incoming, [{ transform: 'perspective(1600px) translateX(100%) rotateY(85deg)', opacity: 0.6 }, { transform: 'perspective(1600px) translateX(0) rotateY(0deg)', opacity: 1 }], { easing: EASE_MOVE });
        add(outgoing, [{ transform: 'perspective(1600px) translateX(0) rotateY(0deg)', opacity: 1 }, { transform: 'perspective(1600px) translateX(-100%) rotateY(-85deg)', opacity: 0.6 }], { easing: EASE_MOVE }); break;
      default:
        add(incoming, [{ opacity: 0 }, { opacity: 1 }]);
        add(outgoing, [{ opacity: 1 }, { opacity: 0 }]);
    }
    return results;
  }

  private cancelAnimations(): void {
    for (const animation of this.animations) animation.cancel(); this.animations = [];
    this.host.querySelectorAll('.slide-fragment').forEach(fragment => fragment.remove());
  }
  private clearTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }

  private async show(index: number, immediate = false): Promise<void> {
    const generation = ++this.generation; this.clearTimer(); this.cancelAnimations();
    if (this.currentLayer) { this.currentLayer.style.opacity = '1'; this.currentLayer.style.transform = 'none'; }
    this.host.querySelectorAll('.slide-layer').forEach(layer => { if (layer !== this.currentLayer) layer.remove(); });
    this.phase = 'loading'; const photo = this.photos[index]; if (!photo || this.destroyed) return;
    try { await this.load(photo); }
    catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      if (!this.failed.has(photo.id)) this.callbacks.onError((error as Error).message);
      this.failed.add(photo.id);
      if (this.failed.size >= this.photos.length) { this.pause(); return; }
      void this.advance(1, immediate); return;
    }
    if (generation !== this.generation || this.destroyed) return;
    const incoming = this.layer(photo), outgoing = this.currentLayer; this.host.append(incoming); this.currentLayer = incoming;
    this.callbacks.onIndex(index); const effect = this.chooseEffect(); this.lastEffect = effect;
    if (outgoing && !immediate && this.photos.length > 1) {
      this.phase = 'transition'; const transitions = this.transition(incoming, outgoing, effect);
      try { await Promise.all(transitions.map(animation => animation.finished)); } catch { return; }
      if (generation !== this.generation || this.destroyed) return;
      this.transitions++;
    }
    outgoing?.remove(); this.cancelAnimations(); incoming.style.opacity = '1'; incoming.style.transform = 'none'; incoming.style.zIndex = '1';
    this.phase = 'hold'; this.remaining = this.settings.holdSeconds * 1000;
    if (effect === 'kenburns' && !this.reduce.matches) {
      this.animate(incoming.querySelector('.slide-image')!, [{ transform: 'scale(1)' }, { transform: 'scale(1.07) translate(-0.5%, -0.5%)' }],
        { duration: this.remaining, easing: 'linear' });
    }
    this.resumeHold();
    const next = this.order.peekNext();
    if (this.photos.length > 1 && next !== null) void this.load(this.photos[next]).catch(() => undefined);
  }

  private resumeHold(): void {
    this.clearTimer(); if (!this.playing || this.phase !== 'hold' || this.destroyed) return;
    this.started = performance.now();
    this.timer = setTimeout(() => { this.timer = null; void this.advance(1); }, this.remaining);
  }

  async advance(direction: 1 | -1, immediate = false): Promise<void> {
    if (this.destroyed) return;
    let index = this.order.next(direction), attempts = 0;
    while (index !== null && this.failed.has(this.photos[index]?.id) && attempts++ < this.photos.length) index = this.order.next(direction);
    if (index === null || attempts >= this.photos.length) { this.pause(); return; }
    if (this.photos.length === 1) { this.remaining = this.settings.holdSeconds * 1000; this.resumeHold(); return; }
    await this.show(index, immediate);
  }

  pause(): void {
    if (!this.playing) return; this.playing = false;
    if (this.phase === 'hold' && this.timer !== null) this.remaining = Math.max(0, this.remaining - (performance.now() - this.started));
    this.clearTimer(); for (const animation of this.animations) animation.pause(); this.callbacks.onPlaying(false);
  }
  play(): void {
    if (this.playing || this.destroyed) return; this.playing = true;
    for (const animation of this.animations) animation.play(); this.resumeHold(); this.callbacks.onPlaying(true);
  }
  toggle(): void { if (this.playing) this.pause(); else this.play(); }
  updateSettings(settings: PlaybackSettings): void {
    const old = this.settings; this.settings = { ...settings };
    if (old.randomOrder !== settings.randomOrder) this.order = new PlaybackOrder(this.photos.length, settings.randomOrder, settings.loop, this.order.current);
    this.order.loop = settings.loop;
    this.host.querySelectorAll<HTMLImageElement>('.slide-image').forEach(image => { image.style.objectFit = settings.fit; });
    if (old.holdSeconds !== settings.holdSeconds && this.phase === 'hold') {
      this.remaining = settings.holdSeconds * 1000; this.resumeHold();
    }
  }
  debug(): object { return { playing: this.playing, index: this.order.current, phase: this.phase, transitions: this.transitions, layers: this.host.querySelectorAll('.slide-layer').length,
    animations: this.animations.length, cache: this.cache.size, hasTimer: this.timer !== null, failed: this.failed.size, effect: this.lastEffect }; }
  destroy(): void { this.destroyed = true; this.generation++; this.clearTimer(); this.cancelAnimations(); this.cache.clear(); this.host.replaceChildren(); this.reduce.removeEventListener('change', this.motionChanged); }
}
