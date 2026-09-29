import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { BRAND } from '../../brand';

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
}
