# FrontendIOT

Angular web dashboard and Electron desktop shell for CNC machine monitoring.
Use the Node version in `.nvmrc` and install the locked dependencies with `npm ci`.

## Develop and verify

```sh
npm start
npm run test:ci
npm run build
npm run e2e
```

The development server uses `proxy.conf.json`. Configure the API URL in
`src/environments/environment.ts` and `environment.prod.ts` for the target host.
Browser integration checks use mocked API fixtures; see the isolated Playwright
configurations before running checks against a live environment.

## Desktop packages

```sh
npm run electron:dev
npm run package:win
npm run package:mac
```

The Electron shell loads the same Angular production assets. Signed release
packages and real-device acceptance are separate deployment steps.

## Assets and guides

`public/` contains the referenced application images, icons, licensed local fonts
and the Program Transfer API guide downloaded from the transfer screen. The
build copies this directory, so keep source archives and operator-only documents
out of it. Server storage and image migration instructions live in the backend
repository at `docs/LOCAL_FILE_STORAGE.md`.

Production output is generated under `dist/`; it is not source code. Uploaded
machine images are served by the authenticated backend file API and are not
stored in this frontend repository.
