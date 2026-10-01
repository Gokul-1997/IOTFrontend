import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class ToastService {

  constructor(private snackBar: MatSnackBar) {}

  success(message: string) {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['toast-success'],
      horizontalPosition: 'right',
      verticalPosition: 'top'
    });
  }

  error(message: string) {
    this.snackBar.open(message, 'Close', {
      // long enough to read a sentence, and announced at once
      duration: 8000,
      politeness: 'assertive',
      panelClass: ['toast-error'],
      horizontalPosition: 'right',
      verticalPosition: 'top'
    });
  }

  info(message: string) {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['toast-info'],
      horizontalPosition: 'right',
      verticalPosition: 'top'
    });
  }
}
