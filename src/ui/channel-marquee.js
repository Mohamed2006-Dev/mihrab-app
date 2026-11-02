/* One compositor animation, two copies of the strip, no frame loop or polling. */
class ChannelMarquee {
  constructor(container) {
    this.container = container;
    this.animation = null;
    this.rows = [];
    this.visible = false;
    this.focused = false;
    this.frame = 0;
    this.widths = new WeakMap();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.resize = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (entry.contentRect.width !== this.widths.get(entry.target)) {
          this.widths.set(entry.target, entry.contentRect.width);
          changed = true;
        }
      }
      if (changed) this.schedule();
    });
    this.resize.observe(container);
    if (container.parentElement) this.resize.observe(container.parentElement);
    this.visibility = new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting === true;
      if (this.visible && !this.animation) this.schedule();
      this.playback();
    });
    this.visibility.observe(container);
    this.profile = new MutationObserver(() => this.schedule());
    this.profile.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-performance', 'data-a11y-motion'],
    });
    this.reduced.addEventListener('change', () => this.schedule());
    document.addEventListener('visibilitychange', () => this.playback());
    container.addEventListener('pointerenter', () => this.playback());
    container.addEventListener('pointerleave', () => this.playback());
    container.addEventListener('focusin', () => {
      if (!this.focused) {
        this.focused = true;
        this.refresh();
      }
    });
    container.addEventListener('focusout', () =>
      queueMicrotask(() => {
        if (!container.contains(document.activeElement)) {
          this.focused = false;
          this.schedule();
        }
      }),
    );
    container.addEventListener(
      'wheel',
      (event) => {
        if (!this.animation) {
          if (
            container.scrollWidth > container.clientWidth &&
            Math.abs(event.deltaY) > Math.abs(event.deltaX)
          ) {
            event.preventDefault();
            container.scrollLeft += event.deltaY;
          }
          return;
        }
        event.preventDefault();
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const duration = this.animation.effect.getTiming().duration;
        this.animation.currentTime =
          (((Number(this.animation.currentTime) + (delta / this.speed) * 1000) % duration) +
            duration) %
          duration;
        this.playback();
      },
      { passive: false },
    );
    document.fonts.ready.then(() => this.schedule());
  }
  schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.refresh();
      });
  }
  release() {
    this.animation?.cancel();
    this.animation = null;
    for (const row of this.container.querySelectorAll('.channel-marquee-copy .channel-row'))
      channelAvatarObserver.unobserve(row);
    const originals = this.container.querySelector('.channel-marquee-original');
    const active = this.container.contains(document.activeElement) ? document.activeElement : null;
    if (originals) {
      const track = originals.parentElement;
      for (const row of [...originals.children]) {
        if (this.container.moveBefore) this.container.moveBefore(row, track);
        else this.container.insertBefore(row, track);
      }
      track.remove();
    }
    this.container.classList.remove('channel-marquee-active');
    this.container.scrollLeft = 0;
    if (active?.isConnected && document.activeElement !== active)
      active.focus({ preventScroll: true });
    if (this.focused && active?.isConnected)
      active.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' });
  }
  refresh() {
    this.release();
    this.rows = [...this.container.querySelectorAll(':scope > .channel-row')];
    const level = document.documentElement.dataset.performance;
    if (
      !this.visible ||
      document.hidden ||
      this.focused ||
      level === 'eco' ||
      this.reduced.matches ||
      document.documentElement.dataset.a11yMotion === 'reduce' ||
      !this.rows.length
    )
      return;
    const style = getComputedStyle(this.container);
    const gap = parseFloat(style.columnGap) || 10;
    const available =
      this.container.clientWidth -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0);
    if (available <= 0) return;
    const viewportWidth = this.container.getBoundingClientRect().width;
    const original = document.createElement('div');
    original.className = 'channel-marquee-group channel-marquee-original';
    original.dir = 'rtl';
    original.append(...this.rows);
    // The native strip shrink-wraps its cards. Keep that width when the duplicate is added.
    this.container.style.setProperty('--channel-strip-viewport-width', viewportWidth + 'px');
    original.style.minWidth = available + 'px';
    original.style.gap = gap + 'px';
    original.style.paddingLeft = gap + 'px';
    const copy = original.cloneNode(true);
    copy.className = 'channel-marquee-group channel-marquee-copy';
    copy.setAttribute('aria-hidden', 'true');
    for (const [index, row] of [...copy.children].entries()) {
      const button = row.querySelector('button');
      button.tabIndex = -1;
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.rows[index]?.querySelector('button')?.click());
      if (row.dataset.avatarId && !row.querySelector('img'))
        observeChannelAvatar(row, row.dataset.avatarId);
    }
    const track = document.createElement('div');
    track.className = 'channel-marquee-track';
    track.dir = 'ltr';
    track.append(original, copy);
    this.container.classList.add('channel-marquee-active');
    this.container.replaceChildren(track);
    const distance = original.getBoundingClientRect().width;
    const offset = Math.max(0, distance - available);
    this.speed = level === 'balanced' ? 10 : 18;
    this.animation = track.animate(
      [
        { transform: `translate3d(${-offset}px,0,0)` },
        { transform: `translate3d(${-offset - distance}px,0,0)` },
      ],
      { duration: (distance / this.speed) * 1000, iterations: Infinity, easing: 'linear' },
    );
    this.playback();
  }
  playback() {
    if (!this.animation) return;
    if (!this.visible || document.hidden || this.focused || this.container.matches(':hover'))
      this.animation.pause();
    else this.animation.play();
  }
}
let channelMarquee = null;
