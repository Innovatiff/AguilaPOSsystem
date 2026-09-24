# Catálogo Águila

Product catalog and shelf-tag printing for Águila Marketplace (Leamington, ON),
and the source of truth for the coming POS. Plain HTML, CSS and JavaScript with
native ES modules. No framework, no bundler, no build step: the repo root is the
site. Firebase (Firestore + Auth) for data and staff login. UI in Spanish,
prices in CAD cents.

## Layout

| path | what |
|---|---|
| `index.html`, `login.html`, `productos.html`, `administracion.html` | app pages (staff login required) |
| `prueba-etiquetas.html` | step 1: both tag templates at physical size, print test |
| `css/etiquetas.css` | the tag: every physical size is a `:root` variable in mm |
| `js/upca.js`, `js/precios.js`, `js/etiquetas.js` | UPC-A → SVG, cents formatting, tag rendering |
| `js/esquema.js` | schema constants, `tokensBusqueda`, validation (pure, shared with tests) |
| `js/firebase.js`, `js/auth.js`, `js/nav.js` | SDK init with offline cache, login guard, nav bar |
| `js/productos.js`, `js/pantalla-productos.js` | product data layer (batched price history) and the product screen |
| `imprimir.html`, `js/pantalla-imprimir.js` | pending tags by store, preview, one print, mark as printed |
| `captura.html`, `js/pantalla-captura.js` | scan-and-add loop for loading the catalog shelf by shelf |
| `datos.html`, `js/pantalla-datos.js`, `js/csv.js` | CSV export and validated import of the full catalog |
| `sw.js`, `manifest.webmanifest`, `icons/` | installable PWA; app shell cached, versioned per deploy |
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

## Access model and bootstrap

**Every account in Firebase Authentication can sign in**, with the `empleado`
role. The `staff/{email}` record is optional: it gives a display name, grants
the `admin` role, or cuts access with `activo = false`. Because an account is
all it takes, accounts must be created only from the console:

1. Firebase console → Authentication → Sign-in method → enable **Email/Password**.
2. Authentication → Settings → **User actions** → untick **Enable create (sign-up)**.
   This is mandatory: with sign-up on, anyone could create an account and get in.
3. Authentication → Users → **Add user** for yourself and each employee.
4. Firestore → collection `staff` → document ID = your email in lowercase, fields
   `nombre` (string), `rol` = `admin` (string), `activo` = `true` (boolean).
   Employees need no record unless you want to name them, promote them or
   deactivate them, which you can do from **Administración** once signed in.
5. Deploy rules and indexes: `npx firebase login`, then `npm run reglas:desplegar`,
   or paste `firestore.rules` into the console's Rules tab.
6. Sign in at `login.html` and add the two stores in **Administración**.

To remove someone's access: disable the account in Authentication, or set
`activo = false` in Administración. Both work; the rules check the second.

## Deploy (Netlify)

Auto-deploys on push; publish directory `.`. The only build command writes
`js/config.js` from the environment variable **`FIREBASE_WEB_CONFIG`**, so no
key lives in git. Set it once in Netlify → Site configuration → Environment
variables, with the value being the config object exactly as the console shows
it, e.g. `{ apiKey: "…", authDomain: "…", projectId: "aguilapos", … }`.
`NPM_FLAGS = "--version"` in `netlify.toml` stops Netlify from installing the
dev dependencies on every deploy.

## Product screen (step 3)

`productos.html` keeps the search box focused: the USB scanner types the UPC
and sends Enter. A known UPC opens the product; an unknown one offers to
create it with the UPC prefilled; a bad check digit is reported. Text search
matches prefixes of any word of nombre or marca (accents ignored) and UPC or
PLU prefixes. The whole catalog is synced once into Firestore's persistent
cache and kept live, so search is instant, works without signal, and reflects
other stations' edits. Saves send only the fields that changed; a price change
is written in one batch with its `priceHistory` entry. Without signal the write
is queued locally and the screen says so; a later server rejection (for
example a price changed first on another station) shows up as an alert.

Keyboard: `Enter` opens, `↓`/`↑` move through results, `/` returns to the
search box, `Alt+N` new product, `Esc` closes. In the editor `Enter` saves and
`Enter` inside the UPC field just moves on, so a scan there does not save.

## CSV import and export (step 6)

`datos.html` (admins) exports the whole catalog and imports a CSV back.

**Export**: UTF-8 with BOM, comma separated, CRLF, one row per product, the
columns in this order: `id, upc, plu, nombre, marca, descriptor, presentacion,
precioCentavos, unidadVenta, precioPorKgCentavos, claseFiscal, tiendas,
existencias, costoCentavos, proveedor, activo, ultimoPrecioImpresoCentavos,
fechaUltimaImpresion, creadoEn, actualizadoEn, actualizadoPor`. Money is
integer cents, `tiendas` are joined with `|`, timestamps are ISO 8601,
`tokensBusqueda` is derived and not exported. Excel turns UPCs into numbers
and drops leading zeros: import the file there as text, or accept that the
importer pads 11-digit UPCs back to 12 and refuses scientific notation.

**Import**: delimiter auto-detected (`,` `;` tab). With an `id` column the
row updates that product; without it, a row whose `upc` exists updates that
product and any other row creates one (columns `nombre`, `precioCentavos`
and `claseFiscal` required for creating). A column that is absent leaves the
field untouched; an empty cell means null (`presentacion`: empty string),
except `activo` and `upc`, which are left as they are: a UPC is never
cleared from a CSV. `existencias`, `costoCentavos`,
`tokensBusqueda` and the timestamps are never imported. Every row is
validated with the same rules as the app; the page shows what would be
created, updated, left unchanged or rejected, and nothing is written until
you confirm. Writes go in batches of 12 products (a price change costs one
rule read and Firestore allows 20 per batch, see
`pruebas/reglas/limites.test.mjs`); price changes carry their history entry.

## Scan-and-add (step 5)

`captura.html` is the shelf-walking loop, keyboard only. The UPC field is
focused: scan, Enter. A new code moves the cursor to nombre, then marca,
presentación and precio, Enter between fields (marca and presentación
autocomplete from the catalog). In precio, `4.99+` means gravado and `5.00c`
tasa cero, and Enter saves at once; without a suffix Enter lands on the class
radio, which keeps the last value, so Enter again saves (`G`/`C` switch it).
The save does not wait for the server: the item enters the session log with
a pending mark that turns into a check when Firestore confirms, or red with
an alert if the server rejects it.

"Tienda donde estás" is remembered per laptop; new products get that store
(or all active stores with the checkbox). Scanning a product that already
exists offers, with one Enter, to add it to the current store, to reactivate
it, or simply to move on. Enter on an empty UPC starts a product without
barcode. `F4` reloads the last product touched for correction (a price change
goes to the history), `Esc` clears the form.

## Batch printing (step 4)

`imprimir.html` lists every active product whose `precioCentavos` differs from
`ultimoPrecioImpresoCentavos` (or that was never printed), grouped by store,
with a "Todas" box per store and "Seleccionar todo" (`Alt+A`). A product in two
stores appears under both and prints one tag per store. "Añadir otro producto"
accepts a scan or a name to reprint a tag that is not pending. "Vista previa e
imprimir" (`Alt+P`, also `Ctrl+P`) renders the selected tags in a flow: on the
Brother each tag is one label; on a sheet printer many tags fill each page.
`Imprimir` opens the browser dialog once. Because the browser cannot tell
Print from Cancel, the page then asks whether the tags came out; only on "Sí"
does it write `ultimoPrecioImpresoCentavos` (the price that was actually
printed, taken from the preview snapshot) and `fechaUltimaImpresion` (local
date) for exactly those products, in batches of 400. A price changed on
another station during printing leaves that product pending, as it should.
The print marker is per product, not per store, which is what the schema
allows.

## Offline and the service worker

`sw.js` precaches the app shell (pages, CSS, JS, vendored SDK, font, icons)
with a cache name stamped from the commit on every Netlify deploy
(`herramientas/sellar-sw.mjs`), so old caches are dropped on activation.
Pages, CSS and JS are network-first with cache fallback; `vendor/` and
`fonts/` are cache-first. `js/config.js` is never cached and cross-origin
traffic (Firestore, Auth) is never intercepted. Consequence: an open tab keeps
working when the signal drops, and Firestore queues writes; a *cold* start
with no network fails on the uncached `config.js`, by design.

When you add a file to the app, add it to `CASCARA` in `sw.js`; the unit test
`pruebas/unitarias/sw.test.mjs` checks the list against the repo.

## Updating the vendored Firebase SDK

Bump `firebase` in `package.json`, run `npm install && npm run vendorizar`, then
point the three imports in `js/firebase.js` at the new `vendor/firebase/<version>/`,
and update the four vendor entries in `sw.js`. The old version directory can be
deleted once nothing references it.

## Printing

Brother QL-820NWB on 62 mm continuous tape, driver length 32 mm. The tag is
designed for the printable area (59 × 29 mm). In Chrome: paper `62mm`, layout
Landscape (set by the page), margins None, scale 100 %.
