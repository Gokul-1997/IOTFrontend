import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'theme';

/**
 * Single source of truth for light/dark, so the header's toggle and the
 * Settings page's toggle can never disagree.
 *
 * Before this, the header toggle lived entirely in component state
 * (`isDark = false`) with no persistence — every navigation or reload
 * silently reverted to light mode regardless of what the user picked.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {

  /** A signal, not a plain field, so every consumer — header, settings,
   *  anything added later — re-renders together when the theme changes. */
  readonly isDark = signal(this.readStored());

  constructor() {
    this.apply(this.isDark());
  }

  private readStored(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark') return true;
      if (stored === 'light') return false;
    } catch { /* localStorage unavailable (private mode, SSR) — fall through */ }
    // No explicit choice yet: match the OS setting rather than defaulting to light.
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private apply(dark: boolean): void {
    document.documentElement.classList.toggle('dark', dark);
  }

  set(dark: boolean): void {
    this.isDark.set(dark);
    this.apply(dark);
    try { localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }

  toggle(): void {
    this.set(!this.isDark());
  }
}
