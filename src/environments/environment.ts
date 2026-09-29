import { deploymentConfig } from './runtime-config';

export const environment = {
  production: false,
  // apiUrl: 'http://localhost:8000/api',
  // frontendUrl: 'http://localhost:4200',
  // socketUrl: 'http://localhost:8000'
  ...deploymentConfig({
    apiUrl: 'https://stmapi.stmcnc.com/api',
    frontendUrl: 'https://stmmexa.stmcnc.com',
    socketUrl: 'https://stmapi.stmcnc.com'
  })
};
