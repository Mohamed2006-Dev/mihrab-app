/* Incremental rendering; one observer per feed and no scroll listener or polling. */
(() => {
  class LessonFeed {
    constructor({
      grid,
      root,
      createCard,
      onCount = () => {},
      onError = (error) => {
        throw error;
      },
      emptyState,
    }) {
      if (!grid || !root || typeof createCard !== 'function')
        throw new Error('Incomplete lesson feed configuration.');
      if (typeof IntersectionObserver !== 'function')
        throw new Error('IntersectionObserver is unavailable.');
      this.grid = grid;
      this.root = root;
      this.createCard = createCard;
      this.onCount = onCount;
      this.onError = onError;
      this.emptyState = emptyState;
      this.batchSize = 8;
      this.items = [];
      this.rendered = 0;
      this.active = false;
      this.busy = false;
      this.failed = false;
      this.disposed = false;
      this.connected = false;
      this.sentinel = document.createElement('div');
      this.sentinel.className = 'lesson-feed-sentinel';
      this.sentinel.setAttribute('aria-hidden', 'true');
      this.observer = new IntersectionObserver(
        (entries) => {
          if (!this.disposed && this.active && entries.some((entry) => entry.isIntersecting))
            this.appendNextBatch();
        },
        { root, rootMargin: '0px 0px 160px 0px', threshold: 0 },
      );
    }

    disconnect() {
      this.observer.disconnect();
      this.connected = false;
    }

    observeMore() {
      this.disconnect();
      const more = this.active && !this.failed && this.rendered < this.items.length;
      this.sentinel.hidden = !more;
      if (more && !this.disposed) {
        // Rearm after a batch so large viewports can fill without a scroll handler.
        this.observer.observe(this.sentinel);
        this.connected = true;
      }
    }

    setItems(items) {
      if (this.disposed) throw new Error('Cannot reset a disposed lesson feed.');
      this.disconnect();
      this.items = Array.isArray(items) ? items : [];
      this.rendered = 0;
      this.failed = false;
      this.grid.replaceChildren(this.sentinel);
      if (this.active) this.appendNextBatch();
      else this.observeMore();
      this.onCount(this.rendered, this.items.length);
    }

    setActive(active) {
      if (this.disposed) return;
      this.active = Boolean(active);
      if (this.active && this.rendered === 0 && !this.failed) this.appendNextBatch();
      else this.observeMore();
    }

    appendNextBatch() {
      if (!this.active || this.busy || this.failed || this.disposed) return false;
      if (this.rendered >= this.items.length) {
        if (!this.items.length && this.grid.childElementCount === 1 && this.emptyState) {
          this.grid.insertBefore(this.emptyState(), this.sentinel);
        }
        this.observeMore();
        return false;
      }
      this.busy = true;
      this.grid.setAttribute('aria-busy', 'true');
      try {
        const end = Math.min(this.rendered + this.batchSize, this.items.length);
        const fragment = document.createDocumentFragment();
        for (let index = this.rendered; index < end; index++)
          fragment.appendChild(this.createCard(this.items[index]));
        this.grid.insertBefore(fragment, this.sentinel);
        this.rendered = end;
        this.onCount(this.rendered, this.items.length);
        this.observeMore();
        return true;
      } catch (error) {
        this.failed = true;
        this.disconnect();
        this.sentinel.hidden = true;
        this.onError(error);
        return false;
      } finally {
        this.busy = false;
        this.grid.setAttribute('aria-busy', 'false');
      }
    }

    dispose() {
      this.disconnect();
      this.disposed = true;
      this.active = false;
      this.items = [];
    }
  }
  window.MihrabLessonFeed = LessonFeed;
})();
