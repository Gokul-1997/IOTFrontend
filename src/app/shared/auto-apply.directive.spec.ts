import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoApplyDirective, DATE_WAIT_MS, SELECT_WAIT_MS } from './auto-apply.directive';

/* The directive reads only the event; its host is the form, so a change
   from any control inside reaches it. */
function changeOn(el: HTMLElement): Event {
  const e = new Event('change', { bubbles: true });
  Object.defineProperty(e, 'target', { value: el });
  return e;
}

describe('AutoApplyDirective', () => {
  let d: AutoApplyDirective;
  let applied: number;

  beforeEach(() => {
    vi.useFakeTimers();
    d = new AutoApplyDirective();
    applied = 0;
    d.autoApply.subscribe(() => applied++);
  });
  afterEach(() => { d.ngOnDestroy(); vi.useRealTimers(); });

  const select = () => document.createElement('select');
  const date = () => Object.assign(document.createElement('input'), { type: 'date' });

  it('a dropdown choice applies almost at once', () => {
    d.onChange(changeOn(select()));
    vi.advanceTimersByTime(SELECT_WAIT_MS - 1);
    expect(applied).toBe(0);
    vi.advanceTimersByTime(1);
    expect(applied).toBe(1);
  });

  it('a date applies once it has stopped changing — typing a year asks once, not four times', () => {
    const el = date();
    for (let i = 0; i < 4; i++) { d.onChange(changeOn(el)); vi.advanceTimersByTime(200); }
    expect(applied).toBe(0);
    vi.advanceTimersByTime(DATE_WAIT_MS);
    expect(applied).toBe(1);
  });

  it('changes close together are applied once', () => {
    d.onChange(changeOn(date()));
    d.onChange(changeOn(select()));
    vi.advanceTimersByTime(DATE_WAIT_MS);
    expect(applied).toBe(1);
  });

  it('a search box, a checkbox or a text field does not apply anything', () => {
    for (const type of ['search', 'checkbox', 'text']) {
      d.onChange(changeOn(Object.assign(document.createElement('input'), { type })));
    }
    vi.advanceTimersByTime(DATE_WAIT_MS * 2);
    expect(applied).toBe(0);
  });

  it('nothing is applied after the page has gone', () => {
    d.onChange(changeOn(select()));
    d.ngOnDestroy();
    vi.advanceTimersByTime(DATE_WAIT_MS);
    expect(applied).toBe(0);
  });
});
