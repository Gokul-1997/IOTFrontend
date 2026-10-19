import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from './confirm.service';

/*
 * Draws ConfirmService's question in the same card as the pages' own delete
 * dialogs. Placed once, in the main layout. Focus, Tab, Escape (= Cancel)
 * and focus-return come from core/ui/dialog-a11y.ts like every other
 * dialog; focus starts on Cancel, so Enter alone never confirms.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *ngIf="confirm.pending() as c" class="ui-overlay">
      <div class="ui-dialog ui-dialog-sm" role="alertdialog" aria-modal="true"
           aria-labelledby="confirmTitle" [attr.aria-describedby]="c.message ? 'confirmBody' : null">
        <div class="ui-dialog-header">
          <div class="flex items-start gap-3">
            <span *ngIf="c.tone !== 'primary'" class="ui-danger-icon" aria-hidden="true">
              <span class="material-icons">{{ c.icon || 'warning_amber' }}</span>
            </span>
            <div>
              <h2 id="confirmTitle" class="ui-dialog-title">{{ c.title }}</h2>
              <p *ngIf="c.message" id="confirmBody" class="ui-dialog-subtitle cf-message">{{ c.message }}</p>
            </div>
          </div>
        </div>

        <div *ngIf="c.items?.length" class="ui-dialog-body">
          <ul class="ui-alert ui-alert-warn cf-items">
            <li *ngFor="let item of c.items">{{ item }}</li>
          </ul>
        </div>

        <div class="ui-dialog-footer">
          <button type="button" class="ui-btn ui-btn-ghost" (click)="c.answer(false)">{{ c.cancelText || 'Cancel' }}</button>
          <button type="button" class="ui-btn" [class.ui-btn-danger]="c.tone !== 'primary'"
                  [class.ui-btn-primary]="c.tone === 'primary'" (click)="c.answer(true)">{{ c.confirmText }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* the size .ui-danger-icon gives a mat-icon; a plain icon keeps Material out of the first download */
    .ui-danger-icon .material-icons { font-size: 1.25rem; }
    .cf-message { white-space: pre-line; }
    .cf-items { margin: 0; padding-left: 1.75rem; list-style: disc; display: grid; gap: .25rem; }
  `]
})
export class ConfirmDialogComponent {
  readonly confirm = inject(ConfirmService);
}
