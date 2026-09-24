# Catálogo Águila

Product catalog and shelf-tag printing for Águila Marketplace (Leamington, ON),
and the source of truth for the coming POS. Plain HTML, CSS and JavaScript with
native ES modules. No framework, no bundler, no build step: the repo root is the
site. Firebase (Firestore + Auth) for data and staff login. UI in Spanish,
prices in CAD cents.

## Layout

| path | what |
|---|---|
| `index.html`, `login.html`, `administracion.html` | app pages (staff login required) |
| `prueba-etiquetas.html` | step 1: both tag templates at physical size, print test |
| `css/etiquetas.css` | the tag: every physical size is a `:root` variable in mm |
| `js/upca.js`, `js/precios.js`, `js/etiquetas.js` | UPC-A → SVG, cents formatting, tag rendering |
| `js/esquema.js` | schema constants, `tokensBusqueda`, validation (pure, shared with tests) |
| `js/firebase.js`, `js/auth.js`, `js/nav.js` | SDK init with offline cache, login guard, nav bar |
| `vendor/firebase/<version>/` | Firebase SDK vendored as ESM (no CDN at runtime) |
| `firestore.rules`, `firestore.indexes.json` | security rules and composite indexes |
| `pruebas/` | rules tests (emulator) and unit tests |
| `docs/esquema.md` | data model and invariants |

## Local setup

1. `npm install` (dev tooling only: emulator, test runner, esbuild).
2. Copy `js/config.example.js` to `js/config.js` and paste the web app config
   from the Firebase console. `js/config.js` is git-ignored.
3. `npm run servir` and open <http://localhost:5500/>. ES modules need HTTP; a
   `file://` URL will not work.

Against the emulators instead of the real project: `npm run emuladores`, and in
`js/config.js` set `export const emuladores = { host: '127.0.0.1' };`.

## Tests

- `npm test` starts the Firestore emulator and runs everything under `pruebas/`
  (Java 21 required for the emulator).
- `npm run test:unitarias` runs only the pure unit tests.

## First admin (one-time bootstrap)

Rules only let admins write `staff`, so the first admin is created by hand:

1. Firebase console → Authentication → Sign-in method → enable **Email/Password**.
2. Authentication → Users → **Add user** with your email and a password.
3. Firestore → collection `staff` → document ID = that email in lowercase, fields
   `nombre` (string), `rol` = `admin` (string), `activo` = `true` (boolean).
4. Deploy rules and indexes: `npx firebase login`, then `npm run reglas:desplegar`.
5. Sign in at `login.html`. Add the rest of the staff and the two stores in
   **Administración**; it creates their login accounts too.

## Deploy (Netlify)

Auto-deploys on push; publish directory `.`. The only build command writes
`js/config.js` from the environment variable **`FIREBASE_WEB_CONFIG`**, so no
key lives in git. Set it once in Netlify → Site configuration → Environment
variables, with the value being the config object exactly as the console shows
it, e.g. `{ apiKey: "…", authDomain: "…", projectId: "aguilapos", … }`.
`NPM_FLAGS = "--version"` in `netlify.toml` stops Netlify from installing the
dev dependencies on every deploy.

## Updating the vendored Firebase SDK

Bump `firebase` in `package.json`, run `npm install && npm run vendorizar`, then
point the three imports in `js/firebase.js` at the new `vendor/firebase/<version>/`.
The old version directory can be deleted once nothing references it.

## Printing

Brother QL-820NWB on 62 mm continuous tape, driver length 32 mm. The tag is
designed for the printable area (59 × 29 mm). In Chrome: paper `62mm`, layout
Landscape (set by the page), margins None, scale 100 %.
