import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';
import { AuthService } from '../../core/services/auth.service';
import { AlarmNotificationSettingsComponent } from './alarm-notification-settings.component';
import { AssistantSettingsComponent } from './assistant-settings.component';

/** Personal display and alarm preferences, plus company administration. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink, AlarmNotificationSettingsComponent, AssistantSettingsComponent],
  templateUrl: './settings.component.html',
  styles: [`
    .set-grid { display: grid; gap: 1rem; width: 100%; max-width: 48rem; margin: 0 auto; }
    .set-grid .mexa-card + .mexa-card { margin-top: 0; }
    .set-content { display: flex; align-items: center; gap: .75rem; min-width: 0; }
    .set-text { min-width: 0; }
    .mexa-switch { flex: none; }
    .set-icon { flex: none; width: 2.25rem; height: 2.25rem; border-radius: 10px; display: grid; place-items: center;
                background: var(--mexa-row-alt); color: #3a4ab8; font-size: 1.25rem; }
    :host-context(.dark) .set-icon { color: #b9b6ff; }
    .set-link { color: inherit; text-decoration: none; border-radius: 10px; margin: 0 -.5rem; padding: .75rem .5rem;
                transition: background-color .2s ease; }
    .set-link:hover { background: var(--mexa-row-alt); }
    .set-link:focus-visible { outline: 2px solid #3a4ab8; outline-offset: 2px; }
    .set-link .set-text { flex: 1; }
    .set-chevron { flex: none; color: var(--mexa-ink-3); }
    @media (prefers-reduced-motion: reduce) { .set-link { transition: none; } }
  `]
})
export class SettingsComponent {
  readonly companyAdmin: boolean;
  /** The AI's daily allowance card: a company admin of a company S&T gave the AI to. */
  readonly assistant: boolean;
  readonly alarmNotifications: boolean;

  constructor(public theme: ThemeService, auth: AuthService) {
    this.companyAdmin = auth.isAdmin() && !auth.isSntSuper();
    this.assistant = this.companyAdmin && auth.hasPermission('page:assistant');
    this.alarmNotifications = !auth.isSntSuper() && ['page:alarms:view', 'page:analytics-alarms:view', 'page:dashboard:view']
      .some(permission => auth.hasPermission(permission));
  }
}
