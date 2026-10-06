import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { startTableScrollHints } from './core/ui/table-scroll-hints';
import { startDialogA11y } from './core/ui/dialog-a11y';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  /* ThemeService applies the saved light/dark choice when it is created. The
     header's theme button used to create it on every signed-in page; the
     button is gone (the choice lives in Settings), so the app creates it —
     before the first page renders, the sign-in page included. */
  constructor(private auth: AuthService, _theme: ThemeService) {}

  ngOnInit() {
  // wide tables say which way there is more to see (styles/system.scss)
  startTableScrollHints();
  // every dialog: named, focus in and kept in, Escape closes, focus back (core/ui/dialog-a11y.ts)
  startDialogA11y();

  const token = localStorage.getItem('token');

  if (token) {
    this.auth.scheduleRefresh(token);
  }
}

}
