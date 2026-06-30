// @module virtual-scroller.ts — Virtual scrolling engine

export class VirtualScroller<T = any> {
  viewport: HTMLElement;
  container: HTMLElement;
  estimatedHeight: number;
  renderItem: (item: T) => HTMLElement;
  items: T[];
  heights: number[];
  positions: number[];
  totalHeight: number;
  scrollTop: number;
  ticking: boolean;
  lastStart: number;
  lastEnd: number;
  private rowMap: Map<number, HTMLElement>;
  private topSpacer: HTMLDivElement | null;
  private bottomSpacer: HTMLDivElement | null;
  private remeasureRAF: number | null;
  private rerenderRAF: number | null;

  constructor(
    viewport: HTMLElement,
    container: HTMLElement,
    estimatedHeight: number,
    renderItem: (item: T) => HTMLElement,
  ) {
    this.viewport = viewport;
    this.container = container;
    this.estimatedHeight = estimatedHeight;
    this.renderItem = renderItem;
    this.items = [];
    this.heights = [];
    this.positions = [];
    this.totalHeight = 0;
    this.scrollTop = 0;
    this.ticking = false;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.rowMap = new Map();
    this.topSpacer = null;
    this.bottomSpacer = null;
    this.remeasureRAF = null;
    this.rerenderRAF = null;

    this.onScroll = this.onScroll.bind(this);
    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (this.viewport.clientHeight > 0) {
          this.render(false);
          this.requestRemeasure();
        }
      }).observe(this.viewport);
    }
  }

  setItems(items: T[]): void {
    this.items = items;
    this.heights = new Array(items.length).fill(this.estimatedHeight);
    this.updatePositions();
    this.scrollTop = this.viewport.scrollTop = 0;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.container.innerHTML = '';
    this.rowMap.clear();
    this.topSpacer = null;
    this.bottomSpacer = null;
    this.render(true);
  }

  updatePositions(): void {
    let top = 0;
    this.positions = new Array(this.items.length);
    for (let i = 0; i < this.items.length; i++) {
      this.positions[i] = top;
      top += this.heights[i];
    }
    this.totalHeight = top;
  }

  scrollToIndex(index: number): void {
    if (index < 0 || index >= this.items.length) return;
    this.viewport.scrollTop = this.positions[index];
    this.scrollTop = this.viewport.scrollTop;
    this.render(false);
  }

  onScroll(): void {
    if (!this.ticking) {
      window.requestAnimationFrame(() => {
        this.scrollTop = this.viewport.scrollTop;
        this.render();
        this.ticking = false;
      });
      this.ticking = true;
    }
  }

  findStartIndex(): number {
    let low = 0;
    let high = this.items.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTop = this.positions[mid];
      const midBottom = midTop + this.heights[mid];
      if (this.scrollTop >= midTop && this.scrollTop < midBottom) {
        return mid;
      } else if (this.scrollTop < midTop) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return Math.max(0, Math.min(low, this.items.length - 1));
  }

  requestRemeasure(): void {
    if (this.remeasureRAF !== null) return;
    this.remeasureRAF = requestAnimationFrame(() => {
      this.remeasureRAF = null;
      this.remeasure();
    });
  }

  private updateMeasuredHeight(idx: number, el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return false;
    const actualHeight = rect.height;
    if (Math.abs(actualHeight - this.heights[idx]) <= 1) return false;
    this.heights[idx] = actualHeight;
    return true;
  }

  private applyMeasuredChanges(anchorIndex: number, anchorOffset: number): void {
    this.updatePositions();

    if (anchorIndex >= 0 && anchorIndex < this.items.length) {
      const nextScrollTop = this.positions[anchorIndex] + anchorOffset;
      if (Math.abs(this.viewport.scrollTop - nextScrollTop) > 1) {
        this.viewport.scrollTop = nextScrollTop;
        this.scrollTop = this.viewport.scrollTop;
      }
    }

    if (this.topSpacer) {
      this.topSpacer.style.height = `${this.positions[this.lastStart] || 0}px`;
    }
    if (this.bottomSpacer) {
      const endTop = this.positions[this.lastEnd] ?? this.totalHeight;
      const bottomPad = this.lastEnd < this.items.length ? this.totalHeight - endTop : 0;
      this.bottomSpacer.style.height = `${Math.max(0, bottomPad)}px`;
    }

    this.requestRangeRefresh();
  }

  private requestRangeRefresh(): void {
    if (this.rerenderRAF !== null) return;
    this.rerenderRAF = requestAnimationFrame(() => {
      this.rerenderRAF = null;
      this.lastStart = -1;
      this.lastEnd = -1;
      this.render(false);
    });
  }

  private remeasure(): void {
    const anchorIndex = this.findStartIndex();
    const anchorOffset = anchorIndex >= 0 ? this.scrollTop - this.positions[anchorIndex] : 0;
    let changed = false;
    for (const [idx, el] of this.rowMap) {
      if (idx < this.lastStart || idx >= this.lastEnd) continue;
      if (this.updateMeasuredHeight(idx, el)) changed = true;
    }
    if (changed) {
      this.applyMeasuredChanges(anchorIndex, anchorOffset);
    }
  }

  render(force = false): void {
    const viewportHeight = this.viewport.clientHeight || 800;
    const total = this.items.length;
    if (!total) {
      this.container.innerHTML = '';
      this.rowMap.clear();
      this.topSpacer = null;
      this.bottomSpacer = null;
      return;
    }

    const buffer = 25;
    let targetStart = this.findStartIndex() - Math.floor(buffer / 2);
    targetStart = Math.max(0, targetStart);

    let end = targetStart;
    let currentHeight = 0;
    while (end < total && currentHeight < viewportHeight + buffer * this.estimatedHeight) {
      currentHeight += this.heights[end];
      end++;
    }
    end = Math.min(total, end);

    if (!force && this.lastStart === targetStart && this.lastEnd === end) {
      return;
    }

    this.lastStart = targetStart;
    this.lastEnd = end;

    if (force) {
      for (const [, el] of this.rowMap) {
        el.remove();
      }
      this.rowMap.clear();
      // Keep cached heights for off-screen rows instead of resetting to estimated.
      // Visible rows will be re-measured after render. This prevents large
      // totalHeight miscalculations that cause blank space at the bottom.
      this.updatePositions();
    }

    const toRemove: number[] = [];
    for (const [idx] of this.rowMap) {
      if (idx < targetStart || idx >= end) {
        toRemove.push(idx);
      }
    }
    for (const idx of toRemove) {
      const el = this.rowMap.get(idx)!;
      el.remove();
      this.rowMap.delete(idx);
    }

    if (!this.topSpacer || !this.topSpacer.parentNode) {
      this.topSpacer = document.createElement('div');
      this.container.insertBefore(this.topSpacer, this.container.firstChild);
    }
    if (!this.bottomSpacer || !this.bottomSpacer.parentNode) {
      this.bottomSpacer = document.createElement('div');
      this.container.appendChild(this.bottomSpacer);
    }

    const frag = document.createDocumentFragment();
    const newElements: HTMLElement[] = [];
    for (let i = targetStart; i < end; i++) {
      let el = this.rowMap.get(i);
      if (!el) {
        el = this.renderItem(this.items[i]);
        (el as any).dataset.vindex = i;
        this.rowMap.set(i, el);
        newElements.push(el);
      }
      frag.appendChild(el);
    }
    this.container.insertBefore(frag, this.bottomSpacer);

    const topPad = this.positions[targetStart];
    const bottomPad = end < total ? this.totalHeight - this.positions[end] : 0;
    this.topSpacer.style.height = `${topPad}px`;
    this.bottomSpacer.style.height = `${bottomPad}px`;

    if (newElements.length > 0) {
      Promise.resolve().then(() => {
        const anchorIndex = this.findStartIndex();
        const anchorOffset = anchorIndex >= 0 ? this.scrollTop - this.positions[anchorIndex] : 0;
        let changed = false;
        for (const el of newElements) {
          const idx = parseInt((el as any).dataset.vindex);
          if (this.updateMeasuredHeight(idx, el)) changed = true;
        }
        if (changed) {
          this.applyMeasuredChanges(anchorIndex, anchorOffset);
        }
      });
    }
  }
}
