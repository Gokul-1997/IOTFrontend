import { deploymentConfig } from './runtime-config';

export const environment = {
  production: false,
  ...deploymentConfig({
    apiUrl: 'http://localhost:8000/api',
    frontendUrl: 'http://localhost:4200',
    socketUrl: 'http://localhost:8000'
  })
};
