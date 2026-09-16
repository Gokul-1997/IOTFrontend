import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../header/header.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent],
  templateUrl: './main-layout.html',
})
export class MainLayoutComponent {
  /** Read once rather than hard-coded, so the footer is not wrong in January. */
  readonly year = new Date().getFullYear();
}
