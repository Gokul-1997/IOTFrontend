import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { AuthService } from "../../core/services/auth.service";
import { RouterModule } from "@angular/router";

@Component({
  standalone: true,
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  imports: [CommonModule, ReactiveFormsModule,RouterModule],
  styleUrls: ['./forgot-password.component.scss']

})
export class ForgotPasswordComponent {

  loading = false;
  message = '';

  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email])
  });

  constructor(private auth: AuthService) { }

  submit() {
    if (this.form.invalid) return;

    this.loading = true;
    this.auth.forgotPassword(this.form.value.email!)
      .subscribe({
        next: (res: any) => {
          this.message = res.message;
          this.loading = false;
        },
        error: () => {
          this.message = 'Something went wrong';
          this.loading = false;
        }
      });
  }
}
