import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { Crumb, trailFor } from './nav-menu';

/*
 * One line above each page saying where it sits in the menu —
 * "Dashboards › Factory Overall". Most pages are two levels down a menu
 * group, and nothing on the page said which; on a phone the menu is folded
 * away entirely. Top-level pages (Alarms, Downtime) get no trail.
 */
@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav *ngIf="crumbs.length > 1" class="crumbs" aria-label="Breadcrumb">
      <ol>
        <li *ngFor="let c of crumbs; let last = last">
          <a *ngIf="c.path && !last; else plain" [routerLink]="c.path">{{ c.label }}</a>
          <ng-template #plain><span [attr.aria-current]="last ? 'page' : null">{{ c.label }}</span></ng-template>
          <span *ngIf="!last" class="sep" aria-hidden="true">›</span>
        </li>
      </ol>
    </nav>
  `,
  styles: [`
    .crumbs { margin: 0 0 .4rem; }
    ol { display: flex; flex-wrap: wrap; align-items: center; gap: .15rem .35rem; list-style: none; margin: 0; padding: 0;
         font-size: .8rem; line-height: 1.4; color: var(--mexa-on-field-2, rgba(255,255,255,.84)); }
    li { display: inline-flex; align-items: center; gap: .35rem; }
    /* 24px tall: a link people tap, not a word in a sentence (WCAG 2.5.8) */
    a { display: inline-flex; align-items: center; min-height: 24px; color: #fff; text-decoration: underline; text-underline-offset: 2px; border-radius: 4px; }
    a:hover { text-decoration-thickness: 2px; }
    a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    [aria-current="page"] { color: #fff; font-weight: 600; }
    .sep { opacity: .8; }
  `]
})
export class BreadcrumbComponent implements OnInit, OnDestroy {
  crumbs: Crumb[] = [];
  private sub?: Subscription;

  constructor(private router: Router, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.update(this.router.url);
    this.sub = this.router.events.pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => this.update((e as NavigationEnd).urlAfterRedirects));
  }

  private update(url: string): void {
    this.crumbs = trailFor(url);
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }
}
