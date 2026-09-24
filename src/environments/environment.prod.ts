import { deploymentConfig } from './runtime-config';

// Web deployments default to a same-origin API/socket reverse proxy.
// Desktop builds must set their hosted service URLs in public/config.js.
const origin = typeof location !== 'undefined' ? location.origin : '';
export const environment = {
  production: true,
  ...deploymentConfig({ apiUrl: '/api', frontendUrl: origin, socketUrl: origin })
};
