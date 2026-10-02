/*
 * Tells a wide table's scroll box which edges have more to see, so the far
 * edge can fade (styles/system.scss) and a cut-off column reads as "scroll
 * sideways" instead of as missing data:
 *
 *   data-scroll-x = "right" | "left" | "both"     (absent when it all fits)
 *
 * One watcher for the whole app instead of a directive on every table: any
 * .mexa-tablewrap or .table-wrapper that appears is picked up, and its
 * marker follows scrolling, resizing and rows arriving.
 */
const BOXES = '.mexa-tablewrap, .table-wrapper';

export function edgeState(scrollLeft: number, scrollWidth: number, clientWidth: number): '' | 'left' | 'right' | 'both' {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return '';
  if (scrollLeft <= 1) return 'right';
  if (scrollLeft >= max - 1) return 'left';
  return 'both';
}

export function startTableScrollHints(doc: Document = document): () => void {
  const known = new WeakSet<Element>();
  const update = (box: HTMLElement) => {
    const v = edgeState(box.scrollLeft, box.scrollWidth, box.clientWidth);
    if (v) { if (box.getAttribute('data-scroll-x') !== v) box.setAttribute('data-scroll-x', v); }
    else if (box.hasAttribute('data-scroll-x')) box.removeAttribute('data-scroll-x');
  };
  // the box resizes with the window; the table inside resizes when rows arrive
  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const box = (e.target as Element).closest(BOXES) as HTMLElement | null;
      if (box) update(box);
    }
  });
  const attach = (box: HTMLElement) => {
    if (!known.has(box)) {
      known.add(box);
      box.addEventListener('scroll', () => update(box), { passive: true });
      ro.observe(box);
    }
    const table = box.querySelector('table');
    if (table && !known.has(table)) { known.add(table); ro.observe(table); }
    update(box);
  };
  let queued = false;
  const scan = () => {
    queued = false;
    doc.querySelectorAll<HTMLElement>(BOXES).forEach(attach);
  };
  const mo = new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(scan); }
  });
  mo.observe(doc.body, { childList: true, subtree: true });
  scan();
  return () => { mo.disconnect(); ro.disconnect(); };
}
