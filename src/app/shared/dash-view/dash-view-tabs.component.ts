import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { UiTabsDirective } from '../ui-tabs.directive';
import { DashTab } from './dash-view';

/**
 * The tab strip of a dashboard with charts and tables (Charts | …Details),
 * as the dashboards draw it: the folder tabs (.ui-tabs-center), an icon and a
 * word each, under the KPI tiles and on top of the panel they switch. One
 * component so every dashboard has the same strip, and the keyboard with it:
 * Left/Right/Home/End move between tabs (uiTabs), Enter or a click opens one.
 * On a phone the strip scrolls sideways; the open tab is kept in view.
 *
 *   <app-dash-view-tabs [tabs]="views.tabs" [active]="views.tab"
 *                       (activeChange)="setView($event)" label="Downtime views"></app-dash-view-tabs>
 *   <div class="ui-tab-content">
 *     <div *ngIf="views.tab === 'charts'" id="dashPanel-charts" role="tabpanel"
 *          aria-labelledby="dashTab-charts" class="mexa-card">…</div>
 *   </div>
 */
@Component({
  selector: 'app-dash-view-tabs',
  standalone: true,
  imports: [UiTabsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; }'],
  template: `
    <div class="ui-tabs ui-tabs-center" role="tablist" uiTabs [attr.aria-label]="label">
      @for (t of tabs; track t.key) {
        <button type="button" class="ui-tab" role="tab" [id]="'dashTab-' + t.key"
                [class.is-active]="active === t.key" [attr.aria-selected]="active === t.key"
                [attr.aria-controls]="active === t.key ? 'dashPanel-' + t.key : null"
                [attr.tabindex]="active === t.key ? 0 : -1" (click)="pick(t.key)">
          <span class="ui-tab-icon material-icons" aria-hidden="true">{{ t.icon }}</span>
          {{ t.label }}
        </button>
      }
    </div>
  `
})
export class DashViewTabsComponent implements OnChanges {
  private host = inject(ElementRef) as ElementRef<HTMLElement>;

  @Input() tabs: DashTab[] = [];
  @Input() active = '';
  /** What the tabs switch between, for a screen reader: "Alarm Report views". */
  @Input() label = 'Dashboard views';
  @Output() activeChange = new EventEmitter<string>();

  pick(tab: string): void {
    if (tab !== this.active) this.activeChange.emit(tab);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['active']) requestAnimationFrame(() => this.keepInView());
  }

  /** Scroll the strip — never the page — so the open tab is whole on screen. */
  private keepInView(): void {
    const strip = this.host.nativeElement.querySelector<HTMLElement>('[role="tablist"]');
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
    const t = tab.getBoundingClientRect(), box = strip.getBoundingClientRect();
    if (t.left < box.left) strip.scrollLeft -= box.left - t.left;
    else if (t.right > box.right) strip.scrollLeft += t.right - box.right;
  }
}
