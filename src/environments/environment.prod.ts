export const environment = {
  production: true,
  // TODO: replace with your actual production domain before deploying
  apiUrl: 'http://13.205.238.163:8000/api',
  frontendUrl: 'http://13.205.238.163',
  // FIX: was 'http://localhost:8000' — WebSocket from prod users would always fail
  socketUrl: 'http://13.205.238.163:8000'
};
