// Staged Phase 3 web artifact; serve HTTPS assets/API/socket on one origin.
// This is not an activation switch. The on-prem API always checks its license.
export const environment = {
  production: true,
  phase3Licensing: false,
  apiUrl: '/api',
  frontendUrl: '',
  socketUrl: ''
};
