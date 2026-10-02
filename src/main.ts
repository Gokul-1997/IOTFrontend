import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { AuthInterceptor } from './app/core/interceptors/auth.interceptor'; 

// Every chart in the app's font. ApexCharts reads its defaults from
// window.Apex; a chart that sets its own fontFamily ('inherit') still wins.
(window as any).Apex = { chart: { fontFamily: 'Ubuntu, system-ui, sans-serif' } };

bootstrapApplication(App, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([AuthInterceptor]))
  ]
});
