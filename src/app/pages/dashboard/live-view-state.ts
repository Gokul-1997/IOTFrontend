import { Injectable } from '@angular/core';

export type LiveFilter = 'all' | 'running' | 'idle' | 'alarm';

/**
 * How a person left the Live Dashboard — Pause, the page, the status filter —
 * kept while the app is open, so opening a machine and coming back finds the
 * list as it was (27 Nov 2026, the user: back from a machine, a paused list
 * was rotating again, from page 1). Only for the same person; a fresh load
 * starts rotating, as a wall display should.
 */
@Injectable({ providedIn: 'root' })
export class LiveViewState {
  private kept: { viewer: unknown; paused: boolean; page: number; filter: LiveFilter } | null = null;

  /** What this person left, if anything. */
  restore(viewer: unknown): { paused: boolean; page: number; filter: LiveFilter } | null {
    return this.kept && this.kept.viewer === viewer ? this.kept : null;
  }

  keep(viewer: unknown, paused: boolean, page: number, filter: LiveFilter): void {
    this.kept = { viewer, paused, page, filter };
  }
}
