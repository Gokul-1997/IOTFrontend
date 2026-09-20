/**
 * ThemeService — the single source of truth for light/dark.
 *
 * Before this existed, dark mode lived in HeaderComponent as a plain field
 * (`isDark = false`) with nothing reading or writing localStorage: it never
 * survived a reload or a new tab, and the Settings page's toggle had no way
 * to agree with the header's.
 */

import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

function freshService(): ThemeService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(ThemeService);
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  test('defaults to light when nothing is stored and the OS has no preference', () => {
    const svc = freshService();
    expect(svc.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('an explicit stored choice of dark wins on construction', () => {
    localStorage.setItem('theme', 'dark');
    const svc = freshService();
    expect(svc.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('an explicit stored choice of light wins on construction', () => {
    localStorage.setItem('theme', 'light');
    const svc = freshService();
    expect(svc.isDark()).toBe(false);
  });

  test('toggle flips state, the DOM class, and persists the choice', () => {
    const svc = freshService();
    expect(svc.isDark()).toBe(false);

    svc.toggle();
    expect(svc.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    svc.toggle();
    expect(svc.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  test('set() applies both the signal and the DOM class together', () => {
    const svc = freshService();
    svc.set(true);
    expect(svc.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('a second injection reads back what the first one persisted — this is the whole point', () => {
    const first = freshService();
    first.set(true);

    const second = freshService();
    expect(second.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('garbage in localStorage falls back rather than throwing', () => {
    localStorage.setItem('theme', 'not-a-real-value');
    expect(() => freshService()).not.toThrow();
  });
});
