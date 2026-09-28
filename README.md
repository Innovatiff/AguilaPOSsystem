# Catálogo Águila

Product catalog and shelf-tag printing for Águila Marketplace (Leamington, ON),
and the source of truth for the coming POS. Plain HTML, CSS and JavaScript with
native ES modules. No framework, no bundler, no build step: the repo root is the
site. Firebase (Firestore + Auth) for data and staff login. UI in Spanish,
prices in CAD cents.

Two apps share the site, the data and the service worker:

- **Catálogo** (root): what staff use on the cart laptops and on their phones.
  Products, scan-and-add, tag printing. Staff sign in with their employee
  **code + NIP**; managers can also sign in with email + password.
- **Gestión** (`/gestion/`, admins only): employees and their codes, stores,
  CSV import/export, and a summary.

## Layout

| path | what |
|---|---|
| `index.html`, `login.html`, `productos.html`, `cuenta.html` | catalog pages (staff login required); `cuenta.html` lets each person change their own NIP |
| `gestion/index.html`, `gestion/empleados.html`, `gestion/tiendas.html`, `gestion/datos.html` | Gestión: summary, employee registry, stores, CSV (admins) |
| `js/identidad.js`, `js/cuentas.js`, `js/personal.js` | code ↔ account mapping and NIP rules (pure), account creation from the app, staff names for display |
| `js/gestion-*.js` | scripts of the Gestión pages |
| `prueba-etiquetas.html` | step 1: both tag templates at physical size, print test |
| `css/etiquetas.css` | the tag: every physical size is a `:root` variable in mm |
| `js/upca.js`, `js/precios.js`, `js/etiquetas.js` | UPC-A → SVG, cents formatting, tag rendering |
| `js/esquema.js` | schema constants, `tokensBusqueda`, validation (pure, shared with tests) |
| `js/firebase.js`, `js/auth.js`, `js/nav.js` | SDK init with offline cache, login guard, nav bar |
| `js/productos.js`, `js/pantalla-productos.js` | product data layer (batched price history) and the product screen |
| `imprimir.html`, `js/pantalla-imprimir.js` | pending tags by store, preview, one print, mark as printed |
| `captura.html`, `js/pantalla-captura.js` | scan-and-add loop for loading the catalog shelf by shelf |
| `gestion/datos.html`, `js/gestion-datos.js`, `js/csv.js` | CSV export and validated import of the full catalog |
| `js/escaner.js`, `vendor/zxing/<version>/` | camera barcode scanner for phones (native BarcodeDetector, ZXing fallback vendored) |
| `sw.js`, `manifest.webmanifest`, `icons/` | installable PWA; app shell cached, versioned per deploy |
| `vendor/firebase/<version>/` | Firebase SDK vendored as ESM (no CDN at runtime) |
| `firestore.rules`, `firestore.indexes.json` | security rules and composite indexes |
| `pruebas/` | unit tests, rules tests (emulator) and browser end-to-end tests (`pruebas/e2e/`) |
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

- `npm test` starts the Firestore emulator and runs the unit and rules tests
  (Java 21 required for the emulator).
- `npm run test:unitarias` runs only the pure unit tests.
- `npm run test:e2e` runs the browser scenarios in `pruebas/e2e/` (access,
  Gestión, products, capture, printing, phone with camera) against the Auth and
  Firestore emulators. It serves a temporary copy of the site with
  `js/config.js` pointing at the emulators, so your real config is untouched.
  Needs `npx playwright install chromium` once. `npm run test:e2e -- movil`
  runs a single scenario. Screenshots land in `pruebas/e2e/salida/`.

## Access model and bootstrap

**Only registered staff can sign in.** A Firebase Authentication account gets
in only if `staff/{usuario}` exists, is `activo`, and points at that account.
Managers register everyone from **Gestión → Empleados**, which creates the
Authentication account and the record together. Nobody is deleted: people are
deactivated, and access ends the moment that happens.

Two kinds of access:

- **Employee code + NIP** (the normal case). The code is exactly 6 digits
  (Gestión proposes the next free one, e.g. `100001`); the NIP is 6–10 digits chosen by
  the manager and handed over in person. Behind it is an Authentication
  account with the synthetic email `<code>@codigo.aguilapos.firebaseapp.com`
  (the constant `DOMINIO_CODIGOS` in `js/identidad.js`, mirrored in
  `firestore.rules`). The person can change their NIP in **Mi cuenta**; if they
  forget it, the manager uses **Restablecer NIP**, which creates a fresh account
  for the same code (`<code>.2@…`) and cuts the old one off at once. The login
  screen learns which version is current from the tiny public document
  `accesos/<code>` (`{ version }`), written in the same batch as the record.
- **Email + password** (managers, or anyone who prefers it). Gestión can create
  the account with a temporary password or just register an account that
  already exists in the console. Password recovery is by email.

Whatever the kind, every write is signed with the person's stable **usuario**
(the code, or the email): that is what `actualizadoPor` and the price history
store, and the rules verify it.

First-time setup (once per Firebase project):

1. Firebase console → Authentication → Sign-in method → enable **Email/Password**.
2. Authentication → Settings → **User actions** → keep **Enable create (sign-up)**
   ON. Gestión needs it to create accounts from the browser. It is safe: an
   account without an active record cannot read or write anything.
3. Create your own manager account: Authentication → Users → **Add user**
   (email + password). Then Firestore → collection `staff` → document ID = your
   email in lowercase with `nombre` (string), `rol` = `admin` (string),
   `activo` = `true` (boolean). Gestión completes the rest of the record the
   first time you open it.
4. Publish the rules: paste `firestore.rules` into the console's Rules tab, or
   `npx firebase login` and `npm run reglas:desplegar`.
5. Sign in at `login.html`, open **Gestión**, add the stores, then the employees.

Records created before Gestión (only `nombre`, `rol`, `activo`) keep working and
are completed on their next edit. To remove someone's access, deactivate them
in Gestión; disabling the account in Authentication also works.

## Gestión (manager app)

`/gestion/` is a separate installable app (its own manifest) for `admin`
accounts, with the same look and the same login page.

- **Resumen**: active products, products with a pending tag, people with
  access, active stores.
- **Empleados**: list with search and "Ver inactivos"; `Alt+N` registers a
  person (code + NIP or email + password, name, role, store). Actions per row:
  Editar (name, role, store), Restablecer NIP (code accounts), Enviar enlace de
  contraseña (email accounts), Desactivar / Activar. An admin cannot deactivate,
  demote or reset themselves; another admin must.
- **Tiendas** and **Importar / exportar** moved here from the catalog.

How an employee registration works, so failures are understandable: Gestión
first creates the Authentication account through a throw-away secondary
Firebase app (the web SDK can only create an account by signing in with it),
then writes `staff/{code}` in a transaction that refuses to overwrite an
existing code. If the first step succeeds and the second fails, retrying is
safe: an orphan account for that code is skipped by using the next version.

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

Results come in pages of 50 (25 or 100 selectable; the choice is remembered
on the device). The pager under the table shows the range, the page count and
the page numbers; changing the search or the "Ver inactivos" filter goes back
to page 1, and a catalog update keeps the current page.

Keyboard: `Enter` opens, `↓`/`↑` move through results and cross page edges,
`Av Pág`/`Re Pág` change page, `/` returns to the search box, `Alt+N` new
product, `Esc` closes. In the editor `Enter` saves and `Enter` inside the UPC
field just moves on, so a scan there does not save.

## Barcodes

The `upc` field holds a GTIN in canonical form: 12 digits for UPC-A, 13 digits
for EAN-13 (Mexican and Central American products start with 750, 740–745…).
A 13-digit code starting with 0 is the EAN-13 form of a UPC-A and is stored as
its 12 digits. Check digits are verified everywhere a code enters: the USB
scanner, the phone camera, the editor and the CSV import. Tags render both
symbols with the same 95-module width; the encoder lives in `js/upca.js` and
its output is verified against an independent decoder in the phone scenario.
Eight-digit codes (EAN-8, UPC-E) are not supported yet and are refused with a
clear message.

## CSV import and export (step 6)

`gestion/datos.html` (admins, inside Gestión) exports the whole catalog and imports a CSV back.

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

## Migrating a BestPOS catalog

`herramientas/convertir-bestpos.mjs` turns the BestPOS "Inventory List"
report (open it in Excel, save as CSV: fields separated by `;`) into the CSV
that Gestión → Importar / exportar accepts, plus a review file with every
decision. No dependencies: it reuses `js/upca.js` and `js/csv.js`.

```
node herramientas/convertir-bestpos.mjs Rapport.csv --tienda=<store id> --salida=migracion
```

`--tienda` is the store identifier as shown in Gestión → Tiendas (without it
the products are imported with no store). The output folder `migracion/` is
gitignored because it holds real store data. It writes:

- `importar-bestpos-<store>.csv`: columns `upc, plu, nombre, marca,
  presentacion, precioCentavos, unidadVenta, claseFiscal, tiendas`. It is
  validated with `planificarImportacion` before being written, so the app
  imports it with zero errors. Do not open and re-save it in Excel (leading
  zeros of UPCs are lost); import it as it is.
- `revision-bestpos-<store>.csv`: one row per report line with the original
  code and description, what was made of them, the proposed tax class with
  its reason, and a `revisar` flag for anything worth a human look.
- `resumen-bestpos-<store>.txt`: counts.

What it does with each row:

- **Codes**: UPC-A (12) and EAN-13 (13) with a verified check digit; UPC-E
  (8, starting with 0 or 1) expanded; 4–5 digits become the `plu` (3 digits
  are padded, e.g. `100` → `0100`); a GS1 read `(01)` + GTIN-14 (16 digits
  starting with `01`, produce stickers) yields the EAN-13 inside. Invalid
  codes do not block the product: it is imported without a code and flagged.
  A 15–16 digit code is a scanner double read: when the same product exists
  with its full code the row is dropped as a duplicate; when the description
  belongs to another product, that product is imported without a code and
  flagged to be scanned in the app.
- **Description**: the trailing size becomes `presentacion` (`591ml`,
  `2 Lbs (907g)`, `6packs 406g`…), a known or frequent leading brand becomes
  `marca`, the rest is `nombre`; when the whole name is the brand
  (`Coca Cola 2l`) it stays as the name. A second code glued to a description
  is removed.
- **Price**: `#1 Price` in cents. Rows without a price or at $0.00 are
  excluded and listed. Prices at or above $100 are flagged.
- **Tax class**: the report has no tax data, so it is proposed from keywords
  (non-food, carbonated/energy/sports drinks, candy and snacks, single-serve
  drinks under 600 mL → `gravado`; the rest → `tasaCero`) and every proposal
  shows its reason in the review file. Check the flagged ones before
  importing, or fix them in the app afterwards.
- Everything is imported active, sold by piece, in the given store.

Suggested flow: import a handful of rows first (cut the import file after
the header), print a tag, scan it, then import the rest. The importer
updates a product whose `upc` already exists, so re-running an import is
safe.

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

## Phones: installable app and camera scanning

The catalog is responsive and installs on phones (Add to Home Screen on iOS,
Install app in Chrome). On narrow or touch screens:

- the navigation folds behind a menu button, results render as cards, dialogs
  take the whole screen, and the search box does not grab the keyboard on load;
- tapping a product opens a **ficha de consulta** (big price, tax indicator,
  UPC, stores, the tag as it prints, pending-tag status, price history) with an
  **Editar** button that opens the usual editor;
- **Escanear** opens the camera. Detection uses the browser's native
  `BarcodeDetector` when it supports UPC/EAN (Chrome on Android) and otherwise
  the vendored ZXing decoder (`vendor/zxing/`), loaded only when the scanner
  opens, which is the path iPhones use. A known UPC opens its ficha; an unknown
  one offers to create the product with the UPC prefilled. The camera needs
  HTTPS (Netlify) or localhost, and the person must allow it once.

The USB scanners on the carts are untouched: they still type into the search box.

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

## Updating the vendored barcode decoder

`npm install -D @zxing/browser@<version> @zxing/library@<version>` then
`npm run vendorizar:zxing`; commit `vendor/zxing/<version>/` and update the
path in `js/escaner.js` and `sw.js`.

## Updating the vendored Firebase SDK

Bump `firebase` in `package.json`, run `npm install && npm run vendorizar`, then
point the three imports in `js/firebase.js` at the new `vendor/firebase/<version>/`,
and update the four vendor entries in `sw.js`. The old version directory can be
deleted once nothing references it.

## Printing

Brother QL-820NWB on 62 mm continuous tape, driver length 32 mm. The tag is
designed for the printable area (59 × 29 mm). In Chrome: paper `62mm`, layout
Landscape (set by the page), margins None, scale 100 %.

### Direct printing, no dialog

Page code cannot skip Chrome's print dialog; Chrome's `--kiosk-printing`
launch flag does. With it, `window.print()` sends the job straight to the last
used printer with the last used settings, `afterprint` still fires, and the
print screen goes directly to the "did they come out well?" confirmation. The
app's print path is unchanged (still the browser's `@media print` pipeline).
Per laptop:

1. Print once from the dialog with the right settings (Brother, `62mm`,
   margins None, headers and footers off) and make the Brother the Windows
   default printer. Chrome remembers the last destination and settings and
   reuses them silently.
2. Close Chrome completely. In `chrome://settings/system` turn off "Continue
   running background apps when Google Chrome is closed", otherwise the flag
   never takes effect.
3. Edit every Chrome shortcut staff use (desktop, taskbar): Properties →
   Target → append ` --kiosk-printing` after the closing quote:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing`
4. Relaunch and check `chrome://version`: "Command Line" must include the flag.

Caveats: with the flag, any website that calls print goes straight to the
default printer, so use it only on the cart laptops. To change printer or
settings later, launch Chrome once without the flag, print from the dialog,
then relaunch with it. To leave normal browsing untouched, a separate user
data directory runs as its own Chrome process with its own flags:
`chrome.exe --user-data-dir="C:\AguilaChrome" --kiosk-printing --app=https://<site>/`
(that profile needs its own login and builds its own offline cache).
The same steps are shown on the print screen under "Imprimir directo".
