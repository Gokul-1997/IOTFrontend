/*
 * One behaviour for every dialog in the app (.ui-overlay > .ui-dialog, 29 of
 * them across 18 screens), instead of a copy in each component:
 *
 *   - it is announced as a dialog: role="dialog", aria-modal and a name
 *     from its title, where the template left them out;
 *   - opening it moves focus inside (the first field, else the first
 *     button), and Tab / Shift+Tab stay inside while it is open;
 *   - Escape closes it, through its own close (×) or Cancel button, so the
 *     component's close logic runs as if that button were pressed;
 *   - closing it puts focus back on whatever opened it.
 *
 * Tested 2026-10-02: 7 of the 8 master-data dialogs left focus on the page
 * behind, let Tab walk out into it, and dropped focus on close; two did not
 * close on Escape. A dialog that must manage all of this itself can be
 * marked data-dialog-a11y="self"; none needs to — the machine form, which
 * traps Tab itself, works the same with both in place.
 */
const DIALOGS = '.ui-overlay .ui-dialog';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let nextId = 0;

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function focusablesIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

/** The control that dismisses a dialog: its × button, else Cancel / Close / No. */
export function closeControlOf(dialog: Element): HTMLElement | null {
  const x = dialog.querySelector<HTMLElement>('.ui-close:not([disabled]), button[aria-label^="Close" i]:not([disabled])');
  if (x) return x;
  const words = /^(cancel|close|no|not now|keep|back)\b/i;
  return Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'))
    .find(b => words.test((b.textContent || '').trim())) || null;
}

export function startDialogA11y(doc: Document = document): () => void {
  /** open dialogs, oldest first, with what had focus before each opened */
  const open: { el: HTMLElement; back: Element | null }[] = [];

  const label = (d: HTMLElement) => {
    if (!d.hasAttribute('role')) d.setAttribute('role', 'dialog');
    if (!d.hasAttribute('aria-modal')) d.setAttribute('aria-modal', 'true');
    if (!d.hasAttribute('aria-labelledby') && !d.hasAttribute('aria-label')) {
      const t = d.querySelector<HTMLElement>('.ui-dialog-title, h2, h3');
      if (t) { if (!t.id) t.id = `dlg-title-${++nextId}`; d.setAttribute('aria-labelledby', t.id); }
    }
    if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1');
  };

  const opened = (d: HTMLElement) => {
    if (open.some(o => o.el === d) || d.getAttribute('data-dialog-a11y') === 'self') return;
    label(d);
    open.push({ el: d, back: doc.activeElement });
    // after the component has had its turn (some focus a field themselves)
    setTimeout(() => {
      if (!d.isConnected || d.contains(doc.activeElement)) return;
      const field = Array.from(d.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')).find(visible);
      (field || focusablesIn(d)[0] || d).focus();
    }, 30);
  };

  const sweep = () => {
    // closed: removed from the page — focus goes back to what opened it
    for (let i = open.length - 1; i >= 0; i--) {
      if (!open[i].el.isConnected) {
        const back = open[i].back as HTMLElement | null;
        open.splice(i, 1);
        const top = open[open.length - 1];
        if (top) { if (!top.el.contains(doc.activeElement)) (focusablesIn(top.el)[0] || top.el).focus(); }
        else if (back && back.isConnected && typeof back.focus === 'function') back.focus();
      }
    }
    doc.querySelectorAll<HTMLElement>(DIALOGS).forEach(opened);
  };

  const onKey = (e: KeyboardEvent) => {
    const top = open[open.length - 1]?.el;
    if (!top || !top.isConnected) return;
    if (e.key === 'Escape') {
      const c = closeControlOf(top);
      if (c) { e.preventDefault(); c.click(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusablesIn(top);
    if (!f.length) { e.preventDefault(); top.focus(); return; }
    const first = f[0], last = f[f.length - 1], active = doc.activeElement;
    if (!top.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (active === first || active === top)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  let queued = false;
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sweep(); }); } });
  mo.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('keydown', onKey, true);
  sweep();
  return () => { mo.disconnect(); doc.removeEventListener('keydown', onKey, true); };
}
