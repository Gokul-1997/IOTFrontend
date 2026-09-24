# Gokul — Industrial Intelligence

A manufacturing operations workspace for live machine monitoring, production, OEE, maintenance, energy, and reporting. Built with Angular and packaged for the web or Electron desktop.

## Development

```sh
npm ci
npm start
```

Open http://localhost:4200. If another project already uses that port, run `npm start -- --port 4201` and open http://localhost:4201. Development connects to the existing local backend at http://localhost:8000. The backend must implement the existing API and Socket.IO contracts.

## Gokul product identity

The dashboard preserves the original monitoring workflow: the top navigation and Dashboard title bar lead directly to six machine cards per page. Each card keeps the machine image, operator, part, component, utilization, target, achieved quantity, and run/idle times together, subject to the existing widget permissions. The full card opens the existing live-detail route; all permitted live readings remain visible together on that page.

Green Running, amber Idle, gray Offline, and red Alarm labels and card accents make states easy to distinguish. Status counts filter the cards in the original API order. An active alarm receives a red card while its underlying operating state remains labeled, so an alarmed running machine can still appear in the Running filter. The original automatic pagination is retained with a pause control. Failed image loads use a neutral machine placeholder, and failed API refreshes retain prior readings with a notice.

The Gokul name, existing authentication, permissions, routes, APIs, polling, and sockets remain integrated. Chart appearance improvements on the existing analytics pages are retained. New visitors see light mode by default; the theme toggle preserves their chosen appearance. Shared styling is in `src/styles/_gokul.scss`, `src/styles/_operations.scss`, and `src/styles/_workspace.scss`.

Product metadata and desktop identifiers are in `package.json`, the browser title and favicon are in `src/index.html` and `public/favicon.svg`, and desktop window metadata is in `electron/main.js`.

## Independent deployment

```sh
npm run build
```

Publish `dist/FrontendIOT/browser`. Configure your server to return `index.html` for frontend routes. Production defaults to the current origin: proxy `/api` to your backend and `/socket.io` to your Socket.IO server, including WebSocket upgrades.

For separate hosts, edit `public/config.js` before building (or the deployed `config.js` afterward):

```js
window.GOKUL_CONFIG = {
  apiUrl: 'https://api.your-domain.com/api',
  frontendUrl: 'https://your-domain.com',
  socketUrl: 'https://api.your-domain.com'
};
```

This configuration is public; it must not contain credentials or secrets. Configure the backend's allowed origins and password-reset links for your own domain. Production no longer points to the prior brand's servers.

For a fully separate running product, provision your own backend and database, configure device/MQTT connections, email delivery, storage and credentials, and deploy to your own domain. Those services are outside this frontend repository. Existing backend role identifiers remain unchanged to preserve access control.

## Desktop

Set all three hosted service URLs in `public/config.js` before packaging; same-origin API defaults apply to web hosting only. The Electron app uses a local `app://` origin and requires its own hosted backend configuration.

```sh
npm run package:mac
npm run package:win
```

The app name is **Gokul** and its application ID is `com.gokul.industrialintelligence`.

## Verification

```sh
npm run test:ci
npm run e2e
```

Playwright starts a local server automatically unless `BASE_URL` is supplied. Most browser tests stub the API and do not need a running backend. Browser installation: `npm run e2e:install`.
