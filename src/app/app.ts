import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { startTableScrollHints } from './core/ui/table-scroll-hints';
import { startDialogA11y } from './core/ui/dialog-a11y';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  constructor(private auth: AuthService) {}

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
