import { inject, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { App } from './app/app';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { AuthInterceptor } from './app/core/interceptors/auth.interceptor'; 

bootstrapApplication(App, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([AuthInterceptor])),
    // line icons everywhere: Material Symbols Outlined (index.html) is the
    // default glyph set for <mat-icon>
    provideAppInitializer(() => { inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined'); })
  ]
});
