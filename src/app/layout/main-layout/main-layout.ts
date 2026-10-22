import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { ConfirmDialogComponent } from '../../shared/confirm/confirm-dialog.component';
import { AssistantWidgetComponent } from '../../shared/assistant/assistant-widget.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ConfirmDialogComponent, AssistantWidgetComponent],
  templateUrl: './main-layout.html',
})
export class MainLayoutComponent {
  /** Read once rather than hard-coded, so the footer is not wrong in January. */
  readonly year = new Date().getFullYear();
}
