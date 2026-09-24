// Gokul deployment settings. This file is public: never place secrets here.
// Web: empty settings use same-origin /api and /socket.io in production.
// Desktop: set all three URLs to your own hosted services before packaging.
window.GOKUL_CONFIG = {
  // apiUrl: 'https://api.your-domain.com/api',
  // frontendUrl: 'https://your-domain.com',
  // socketUrl: 'https://api.your-domain.com'
};

// Restore the selected appearance before the app's first paint.
try {
  document.documentElement.classList.toggle('dark', localStorage.getItem('theme') === 'dark');
} catch { /* The default theme also works when storage is unavailable. */ }
