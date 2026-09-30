import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from '../header/header.component';
import { BRAND } from '../../brand';
import { pageKey } from '../page-identity';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayoutComponent {
  /** Read once rather than hard-coded, so the footer is not wrong in January. */
  readonly year = new Date().getFullYear();
  readonly brand = BRAND;

  constructor() {
    /* Every page has its own identity (its accent, its label, its header
       picture); the key on <html> selects it. Set now for the first page,
       then on every navigation; cleared when the signed-in shell goes, so
       the sign-in pages are never tinted by the last page seen. */
    const router = inject(Router);
    const root = document.documentElement;
    const mark = (url: string) => { root.dataset['page'] = pageKey(url); };
    mark(router.url);
    router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => mark(e.urlAfterRedirects));
    inject(DestroyRef).onDestroy(() => delete root.dataset['page']);
  }
}
