import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

// Every chart in the app's font. ApexCharts reads its defaults from
// window.Apex; a chart that sets its own fontFamily ('inherit') still wins.
(window as any).Apex = { chart: { fontFamily: 'Ubuntu, system-ui, sans-serif' } };

bootstrapApplication(App, appConfig);
