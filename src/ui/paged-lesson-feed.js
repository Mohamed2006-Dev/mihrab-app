(() => {
  class PagedLessonFeed {
    constructor({ grid, root, createCard, onCount, onError, emptyState }) {
      Object.assign(this, { grid, root, createCard, onCount, onError, emptyState });
      this.isPaged = true;
      this.active = false;
      this.items = [];
      this.offset = 0;
      this.total = 0;
      this.revision = 0;
      this.filterKey = '';
      this.batchSize = window.mihrabPerformance.profile.batchSize;
      this.automatic = window.mihrabPerformance.profile.id === 'balanced';
      this.armed = { previous: false, next: false };
      this.previous = document.createElement('button');
      this.previous.type = 'button';
      this.previous.className = 'lesson-page-control';
      this.previous.textContent = 'الدروس السابقة';
      this.previous.dataset.direction = 'previous';
      this.next = document.createElement('button');
      this.next.type = 'button';
      this.next.className = 'lesson-page-control';
      this.next.textContent = 'الدروس التالية';
      this.next.dataset.direction = 'next';
      this.previous.addEventListener('click', () => this.load(this.offset - this.batchSize, true));
      this.next.addEventListener('click', () => this.load(this.offset + this.batchSize, true));
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const direction = entry.target.dataset.direction;
            if (!entry.isIntersecting) {
              this.armed[direction] = true;
              if (this.pendingDirection === direction) this.cancelPending();
            } else if (this.armed[direction] && this.active && !this.busy) {
              this.armed[direction] = false;
              this.schedulePage(direction);
            }
          }
        },
        { root, threshold: 0.2 },
      );
      // At the top of a freshly replaced page the previous sentinel is already visible.
      // A deliberate upward gesture must still be able to request the previous batch.
      this.onWheel = (event) => {
        if (!this.active || this.busy || this.disposed) return;
        if (event.deltaY < 0 && this.root.scrollTop <= 2 && this.offset > 0)
          this.schedulePage('previous');
      };
      this.onTouchStart = (event) => {
        this.touchY = event.touches[0]?.clientY;
      };
      this.onTouchEnd = (event) => {
        const y = event.changedTouches[0]?.clientY;
        if (
          this.touchY != null &&
          y - this.touchY > 35 &&
          this.root.scrollTop <= 2 &&
          this.offset > 0
        )
          this.schedulePage('previous');
        this.touchY = null;
      };
      if (this.automatic) root.addEventListener('wheel', this.onWheel, { passive: true });
      if (this.automatic) root.addEventListener('touchstart', this.onTouchStart, { passive: true });
      if (this.automatic) root.addEventListener('touchend', this.onTouchEnd, { passive: true });
      grid.replaceChildren();
    }
    cancelPending() {
      clearTimeout(this.pageTimer);
      this.pageTimer = null;
      this.pendingDirection = null;
    }
    schedulePage(direction) {
      if (!this.automatic || !this.active || this.busy || this.disposed) return;
      if (this.pendingDirection === direction) return;
      this.cancelPending();
      this.pendingDirection = direction;
      this.pageTimer = setTimeout(() => {
        this.cancelPending();
        if (this.active && !this.busy && !this.disposed)
          this.load(this.offset + (direction === 'next' ? this.batchSize : -this.batchSize), true);
      }, 1200);
    }
    release() {
      for (const img of this.grid.querySelectorAll('img')) img.removeAttribute('src');
      this.items = [];
      this.grid.replaceChildren();
    }
    setFilter(filter) {
      this.cancelPending();
      const key = JSON.stringify(filter);
      if (key === this.filterKey) return;
      this.filterKey = key;
      this.filter = filter;
      this.offset = 0;
      this.revision++;
      this.busy = false;
      if (this.active) this.load(0, true);
    }
    setActive(active) {
      if (this.disposed) return;
      const changed = this.active !== Boolean(active);
      this.active = Boolean(active);
      if (!this.active) {
        this.cancelPending();
        this.revision++;
        this.observer.disconnect();
        this.release();
        this.busy = false;
      } else if (changed || !this.items.length) this.load(this.offset);
    }
    async load(offset, scroll = false) {
      this.cancelPending();
      if (!this.active || this.disposed || this.busy) return;
      this.busy = true;
      const revision = ++this.revision;
      this.observer.disconnect();
      this.grid.setAttribute('aria-busy', 'true');
      try {
        const page = await window.mihrabApi.getYoutubePage({
          ...this.filter,
          offset: Math.max(0, offset),
        });
        if (revision !== this.revision || !this.active || this.disposed) return;
        const fragment = document.createDocumentFragment();
        if (page.offset > 0) fragment.append(this.previous);
        for (const video of page.videos) fragment.append(this.createCard(video));
        if (!page.total) fragment.append(this.emptyState());
        if (page.offset + page.videos.length < page.total) fragment.append(this.next);
        const backwards = page.offset < this.offset;
        this.release();
        this.offset = page.offset;
        this.total = page.total;
        this.items = page.videos;
        this.grid.append(fragment);
        this.armed = { previous: false, next: false };
        this.onCount(this.items.length, this.total);
        if (scroll)
          this.root.scrollTop = backwards
            ? Math.max(0, this.root.scrollHeight - this.root.clientHeight)
            : 0;
        if (this.automatic && this.previous.isConnected) this.observer.observe(this.previous);
        if (this.automatic && this.next.isConnected) this.observer.observe(this.next);
      } catch (error) {
        if (revision === this.revision) {
          this.onError(error);
        }
      } finally {
        if (revision === this.revision) {
          this.busy = false;
          this.grid.setAttribute('aria-busy', 'false');
        }
      }
    }
    dispose() {
      this.cancelPending();
      this.root.removeEventListener('wheel', this.onWheel);
      this.root.removeEventListener('touchstart', this.onTouchStart);
      this.root.removeEventListener('touchend', this.onTouchEnd);
      this.disposed = true;
      this.active = false;
      this.revision++;
      this.observer.disconnect();
      this.release();
    }
  }
  window.MihrabPagedLessonFeed = PagedLessonFeed;
})();
