import { Component, ChangeDetectionStrategy, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/*
 * What a card or page shows when it has no figures to show: an icon, a short
 * title and the next step, in plain words.
 *
 *   <app-state kind="empty" title="No production data for this period"
 *              text="Select another date range or machine."></app-state>
 *   <app-state kind="error" title="Could not load the report"
 *              text="Check the connection, then try again." action="Try again" (act)="load()"></app-state>
 *
 * "empty" is not "error": an empty period is a real answer, a failed request
 * is not. Errors are announced (role=alert); empty and loading are polite.
 */
@Component({
  selector: 'app-state',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ux-state" [class.is-error]="kind === 'error'" [class.is-warn]="kind === 'warn'"
         [attr.role]="kind === 'error' ? 'alert' : 'status'" [attr.aria-busy]="kind === 'loading' ? 'true' : null">
      <span class="ux-state-icon" aria-hidden="true">
        <span *ngIf="kind !== 'loading'; else spin" class="material-icons">{{ icon || defaultIcon }}</span>
        <ng-template #spin><span class="ui-spinner"></span></ng-template>
      </span>
      <p class="ux-state-title">{{ title }}</p>
      <p class="ux-state-text" *ngIf="text">{{ text }}</p>
      <button *ngIf="action" type="button" class="ui-btn ui-btn-ghost ui-btn-sm ux-state-action" (click)="act.emit()">{{ action }}</button>
    </div>
  `
})
export class StateComponent {
  @Input() kind: 'empty' | 'error' | 'warn' | 'loading' = 'empty';
  @Input({ required: true }) title = '';
  @Input() text = '';
  @Input() icon = '';
  @Input() action = '';
  @Output() act = new EventEmitter<void>();

  get defaultIcon(): string {
    return this.kind === 'error' ? 'error_outline' : this.kind === 'warn' ? 'warning_amber' : 'inbox';
  }
}
