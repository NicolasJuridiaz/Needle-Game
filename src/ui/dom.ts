/**
 * Tiny DOM helpers shared by the UI components. No framework: every component builds its DOM once
 * and then only touches text / classes / styles when values actually change.
 */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: Element | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** Element from an HTML string (used for inline SVG icons). */
export function fromHTML(html: string): Element {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as Element;
}

/** Text node wrapper that only writes the DOM when the value changes. */
export class TextSlot {
  private v: string | null = null;
  constructor(readonly el: HTMLElement) {}
  set(s: string): void {
    if (s === this.v) return;
    this.v = s;
    this.el.textContent = s;
  }
  get value(): string { return this.v ?? ''; }
}

/** Class toggle that only touches the DOM on change. */
export class ClassSlot {
  private v: boolean | null = null;
  constructor(readonly el: Element, readonly cls: string) {}
  set(on: boolean): void {
    if (on === this.v) return;
    this.v = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** Numeric style property writer (e.g. a bar width) that skips identical values. */
export class StyleSlot {
  private v = NaN;
  constructor(readonly el: HTMLElement, readonly prop: string, readonly unit = '') {}
  set(n: number): void {
    if (n === this.v) return;
    this.v = n;
    this.el.style.setProperty(this.prop, n + this.unit);
  }
}

/** Restart a CSS animation class on an element (e.g. a "pop" or "shake"). */
export function replayClass(el: Element, cls: string): void {
  el.classList.remove(cls);
  // Force a reflow so the animation restarts.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
