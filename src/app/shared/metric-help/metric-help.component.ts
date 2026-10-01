import { Component, ChangeDetectionStrategy, ChangeDetectorRef, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';
import { metricHelp, MetricHelpEntry, HelpBasis } from './metric-help.content';

let nextId = 0;

/*
 * The (i) beside a number: what it means, how it is worked out, an example,
 * and why it matters — see metric-help.content.ts.
 *
 * <app-metric-help topic="availability" basis="shift"></app-metric-help>
 *
 * The icons are drawn from fontIcon (a ::before), so the label the (i) sits
 * in keeps its own text — "Availability", not "Availability info_outline".
 *
 * A real button (Enter / Space / tap), aria-expanded, and a panel that opens
 * in an overlay so a card's overflow cannot clip it and it never runs off
 * the screen. Opening moves focus into the panel; Escape, the close button
 * or a tap outside closes it and puts focus back on the (i).
 */
@Component({
  selector: 'app-metric-help',
  standalone: true,
  imports: [CommonModule, OverlayModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; line-height: 1; }
    .mh-btn {
      display: inline-grid; place-items: center; width: 28px; height: 28px; margin: -6px -2px -6px 0;
      padding: 0; border: 0; border-radius: 999px; background: transparent; cursor: pointer;
      color: currentColor; opacity: .75; transition: background .15s, opacity .15s;
    }
    .mh-btn:hover, .mh-btn[aria-expanded="true"] { opacity: 1; background: rgba(43, 57, 144, .1); }
    .mh-btn:focus-visible { outline: 2px solid var(--mexa-submit, #2f2d8f); outline-offset: 1px; opacity: 1; }
    .mh-btn mat-icon { width: 18px; height: 18px; font-size: 18px; }
    @media (pointer: coarse) { .mh-btn { width: 36px; height: 36px; margin: -10px -8px; } }

    .mh-panel {
      width: min(340px, calc(100vw - 24px)); max-height: min(70vh, 460px); overflow: auto;
      background: var(--mexa-card, #fff); color: var(--mexa-ink, #1f2430);
      border-radius: 14px; padding: .85rem 1rem 1rem; text-align: left;
      box-shadow: 0 16px 40px rgba(18, 14, 64, .28), 0 0 0 1px rgba(18, 14, 64, .06);
      font-size: .875rem; line-height: 1.5; font-weight: 400; letter-spacing: normal; text-transform: none;
    }
    .mh-panel:focus { outline: none; }
    .mh-panel:focus-visible { outline: 2px solid var(--mexa-submit, #2f2d8f); outline-offset: 2px; }
    .mh-head { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; margin-bottom: .35rem; }
    .mh-title { margin: .15rem 0 0; font-size: 1rem; font-weight: 700; line-height: 1.3; color: var(--mexa-ink, #1f2430); }
    .mh-close {
      flex: none; display: grid; place-items: center; width: 32px; height: 32px; margin: -4px -6px 0 0;
      border: 0; border-radius: 999px; background: transparent; color: var(--mexa-ink-2, #4b5262); cursor: pointer;
    }
    .mh-close:hover { background: var(--mexa-row-alt, #f5f4fc); }
    .mh-close:focus-visible { outline: 2px solid var(--mexa-submit, #2f2d8f); outline-offset: 1px; }
    .mh-close mat-icon { width: 20px; height: 20px; font-size: 20px; }
    .mh-what { margin: 0 0 .6rem; }
    .mh-formula {
      margin: 0 0 .6rem; padding: .55rem .7rem; border-radius: 10px;
      background: var(--mexa-row-alt, #f5f4fc); color: var(--mexa-ink, #1f2430); font-weight: 600;
    }
    .mh-formula p { margin: 0; }
    .mh-formula p + p { margin-top: .3rem; font-weight: 400; color: var(--mexa-ink-2, #4b5262); }
    .mh-example, .mh-why { margin: 0 0 .5rem; color: var(--mexa-ink-2, #4b5262); }
    .mh-why { margin-bottom: 0; }
    .mh-example strong, .mh-why strong { color: var(--mexa-ink, #1f2430); }
  `],
  template: `
    <button type="button" class="mh-btn" cdkOverlayOrigin #origin="cdkOverlayOrigin" #btn
      [attr.aria-label]="'What is ' + entry.title + '?'" [attr.aria-expanded]="open" [attr.aria-controls]="open ? id : null"
      (click)="toggle($event)">
      <mat-icon aria-hidden="true" fontIcon="info_outline"></mat-icon>
    </button>

    <ng-template cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open"
      [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayPush]="true"
      [cdkConnectedOverlayViewportMargin]="12"
      (overlayOutsideClick)="outside($event)" (overlayKeydown)="keydown($event)"
      (attach)="focusPanel()" (detach)="open = false">
      <div class="mh-panel" role="dialog" [id]="id" [attr.aria-labelledby]="id + '-t'" tabindex="-1" #panel>
        <div class="mh-head">
          <h3 class="mh-title" [id]="id + '-t'">{{ entry.title }}</h3>
          <button type="button" class="mh-close" (click)="close(true)" aria-label="Close">
            <mat-icon aria-hidden="true" fontIcon="close"></mat-icon>
          </button>
        </div>
        <p class="mh-what">{{ entry.what }}</p>
        <div class="mh-formula" *ngIf="entry.formula?.length">
          <p *ngFor="let f of entry.formula">{{ f }}</p>
        </div>
        <p class="mh-example" *ngIf="entry.example"><strong>Example:</strong> {{ entry.example }}</p>
        <p class="mh-why" *ngIf="entry.why"><strong>Why it matters:</strong> {{ entry.why }}</p>
      </div>
    </ng-template>
  `
})
export class MetricHelpComponent {
  @Input({ required: true }) topic!: string;
  /** 'shift' for the shift screens (Quality, machine page), 'period' for the dashboards. */
  @Input() basis: HelpBasis = 'period';

  @ViewChild('btn', { static: true }) btn!: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;

  readonly id = `metric-help-${++nextId}`;
  open = false;

  readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 }
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  get entry(): MetricHelpEntry { return metricHelp(this.topic, this.basis); }

  toggle(ev: Event): void {
    ev.stopPropagation();          // a help button inside a clickable card must not open the card
    this.open ? this.close(true) : (this.open = true);
    this.cdr.markForCheck();
  }

  close(returnFocus: boolean): void {
    this.open = false;
    this.cdr.markForCheck();
    if (returnFocus) setTimeout(() => this.btn.nativeElement.focus());
  }

  /** A tap outside closes the panel; a tap on the (i) itself is the toggle's job. */
  outside(ev: MouseEvent): void {
    if (this.btn.nativeElement.contains(ev.target as Node)) return;
    this.close(false);
  }

  keydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') { ev.preventDefault(); this.close(true); }
  }

  focusPanel(): void {
    setTimeout(() => this.panel?.nativeElement.focus());
  }
}
