# Águila POS

Point of sale, back office and product catalog for Águila Marketplace
(Leamington, ON). Plain HTML, CSS and JavaScript with native ES modules. No
framework, no bundler, no build step: the repo root is the site. Firebase
(Firestore + Auth) for data and staff login. UI in Spanish, money in CAD
integer cents, never floats.

Four apps share the site, the data and the service worker:

| app | where | who | what |
|---|---|---|---|
| **Back office** | site root (`index.html`, `ventas.html`, `turnos.html`, `reportes.html`, catalog pages, `solicitudes.html`, `gestion/`) | **admins only** | today's sales live, sales journal and reprints, shifts with hours and cash over/short, reports, products and tags, **requests from the Catálogo app**, employees, registers, stores, POS settings |
| **Caja** (register) | `caja/` | every active staff member | sell: scan, weigh, department keys, discounts and returns with admin approval, cash/debit/credit, receipts; each cashier opens and closes **their own shift with only their 6-digit PIN**, and the close prints their Z report with what they sold and their hours |
| **Catálogo** | `catalogo/` | staff an admin allowed (**Empleados → Puede usar la app Catálogo**) | search and scan products, edit their data (**never the price, unit or tax class**), print shelf tags, and **request** new products (without price) and removals, which an admin resolves in the back office. No way into the back office |
| **Consulta de precios** | `caja/consulta.html` | every active staff member | price check on a phone (camera) or a PC (USB scanner) |

## Layout

| path | what |
|---|---|
| `index.html`, `js/inicio.js` | back office home: sold today, tickets, average ticket, HST, sales by hour, payment methods, registers with an open shift, latest tickets |
| `ventas.html`, `js/bo-ventas.js` | sales journal of a day: filters, search by receipt number (or scan the receipt), ticket detail with reprint, CSV |
| `turnos.html`, `js/bo-turnos.js` | open shifts now and shifts of a period: hours, sales, expected/counted cash, over/short; shift detail with its Z (or X) report, verification against the sales, admin close |
| `reportes.html`, `js/bo-reportes.js` | reports of a period from the shift summaries: totals, tax, by day, payment methods, by person (hours), by register, top products, department sales, control counters; print and CSV |
| `gestion/cajas.html`, `gestion/configuracion.html`, `gestion/tiendas.html`, `gestion/empleados.html`, `gestion/datos.html` | registers, POS settings, stores (receipt header), employees (email, PIN, Catálogo permission), CSV import/export |
| `solicitudes.html`, `js/gestion-solicitudes.js`, `js/solicitudes.js` | requests from the Catálogo app: add a product (the admin sets price and tax class) or remove one; badge with the pending count in the sidebar |
| `catalogo/`, `js/catalogo-solicitudes.js`, `herramientas/paginas-catalogo.mjs` | the staff Catálogo app: `entrar.html` (email + PIN), products, quick capture, tags, my requests. Its products, capture and tags pages are generated from the back office ones (`node herramientas/paginas-catalogo.mjs`; a unit test checks they are up to date); the shared screens switch to staff mode by app and role |
| `js/nip.js`, `js/clave-caja.js` | PIN-only sign-in at the register: HMAC of the PIN with the register key (`secretos/caja`) |
| `productos.html`, `captura.html`, `imprimir.html`, `prueba-etiquetas.html` | catalog: products, scan-and-add, shelf tags, tag test page |
| `caja/index.html`, `js/caja*.js`, `css/caja.css` | the register: screens, ticket, payment, shift dialogs, local storage |
| `caja/consulta.html`, `js/consulta.js` | staff price check and PIN change |
| `js/ticket.js` | ticket math in integer cents: lines, discounts, HST once per ticket, Canadian cash rounding, payments, receipt number (pure, unit tested) |
| `js/turnos.js` | shift summary (X/Z), cash count, summing shifts for reports (pure, unit tested) |
| `js/recibo.js`, `css/recibo.css`, `js/code128.js` | thermal receipts (80/58 mm) and reports printed through the browser; Code 128 barcode of the receipt number |
| `js/pos-datos.js`, `js/config-pos.js`, `js/verificador.js` | POS data in Firestore, POS settings with defaults, offline PIN verifier (PBKDF2 hash) |
| `js/bo.js`, `js/grafica.js`, `js/dom.js`, `js/nav.js` | back office helpers, SVG charts, DOM builder, sidebar navigation |
| `js/identidad.js`, `js/cuentas.js`, `js/personal.js`, `js/auth.js` | code ↔ account mapping and PIN rules, account creation, staff names, login guard |
| `js/esquema.js`, `js/productos.js`, `js/upca.js`, `js/precios.js`, `js/etiquetas.js`, `js/csv.js`, `js/escaner.js` | catalog schema, product data, barcodes, prices, tags, CSV, camera scanner |
| `css/etiquetas.css` | the shelf tag: every physical size is a `:root` variable in mm |
| `sw.js`, `manifest.webmanifest`, `caja/*.webmanifest`, `icons/` | installable PWAs; app shell cached, versioned per deploy. `icons/aguila.svg` is the logo (white eagle on orange); the `icono-*.png` files are rendered from it |
| `vendor/` | Firebase SDK and ZXing decoder vendored as ESM (no CDN at runtime) |
| `firestore.rules`, `firestore.indexes.json` | security rules and indexes |
| `pruebas/` | unit tests, rules tests (emulator) and browser end-to-end tests (`pruebas/e2e/`) |
| `docs/esquema.md` | data model and invariants |

## Local setup

1. `npm install` (dev tooling only: emulator, test runner, esbuild).
2. Copy `js/config.example.js` to `js/config.js` and paste the web app config
   from the Firebase console. `js/config.js` is git-ignored.
3. `npm run servir` and open <http://localhost:5500/> (back office) or
   <http://localhost:5500/caja/> (register). ES modules need HTTP; a `file://`
   URL will not work.

Against the emulators instead of the real project: `npm run emuladores`, and in
`js/config.js` set `export const emuladores = { host: '127.0.0.1' };`.

## Tests

- `npm test` starts the Firestore emulator and runs the unit and rules tests
  (Java 21 required for the emulator). `pruebas/reglas/holgura.test.mjs`
  measures how much evaluation budget each POS rule has left (Firestore stops
  evaluating a request after a fixed number of expressions); keep it green
  when touching the rules.
- `npm run test:unitarias` runs only the pure unit tests (ticket math, cash
  rounding, shift summary, Code 128 decoded back with ZXing, barcodes, CSV…).
- `npm run test:e2e` runs the browser scenarios in `pruebas/e2e/` against the
  Auth and Firestore emulators: `caja` (assign a computer, open a shift, sell,
  approvals, return, cash drop, lock, close with Z), `backoffice` (dashboard,
  journal, shifts, reports, registers, settings), plus access, employees,
  products, capture, printing and phone. It serves a temporary copy of the site
  with `js/config.js` pointing at the emulators, so your real config is
  untouched. `npm run test:e2e -- caja` runs a single scenario. Screenshots land
  in `pruebas/e2e/salida/`. Needs `npx playwright install chromium` once (or
  set `CHROMIUM_E2E` to a Chromium binary).

## Access model

**Only registered staff can sign in.** A Firebase Authentication account gets
in only if `staff/{usuario}` exists, is `activo`, and points at that account.
Admins register everyone in **Back office → Empleados**, which creates the
Authentication account and the record together. Nobody is deleted: people are
deactivated, and access ends the moment that happens.

Every staff member is registered with their **email** and a **6-digit PIN
(NIP de colaborador) that nobody else has**. Empleados assigns an internal
number (6 digits, nobody types it) and creates the Authentication account
behind it, with the synthetic email `<number>@codigo.aguilapos.firebaseapp.com`
(`DOMINIO_CODIGOS` in `js/identidad.js`, mirrored in `firestore.rules`) and the
PIN as its password.

- **Register: only the PIN.** On a register computer that an admin set up, the
  cashier types just the 6 digits. The register computes
  `HMAC-SHA-256(register key, PIN)` and reads `nips/<that hash>` = `{ codigo,
  version }` to know whose PIN it is, then signs in to that account with the
  PIN. The register key lives in `secretos/caja` (only admins read it) and is
  saved on each register when an admin sets it up; without it nobody can turn a
  PIN into a lookup, so the index cannot be probed from outside a register.
  Admin approvals at the register are the admin's PIN too.
- **Price check, Catálogo and back office: email + PIN.** `correos/<email>` =
  `{ codigo }` (one public document, no listing) tells which account the email
  belongs to. Admins with an email + password account keep using their password
  (a password has at least 8 characters, so it is never mistaken for a PIN).
- **Back office: admins only.** Anyone else who signs in at `login.html` is told
  to use the register, the price check or the Catálogo app, and is signed out.
- **Catálogo: admins and staff with the Catálogo permission** (a checkbox in
  Empleados). The Catálogo app has its own session and its own pages; nothing
  in it links to the back office.
- **PINs are set by admins** (Empleados → **Cambiar NIP**; an admin changes
  their own in Mi cuenta). A PIN change creates a fresh account for the same
  number (`<number>.2@…`), moves the `nips/` entry and cuts the old PIN off at
  once. The login screens learn the current version from `accesos/<number>`.
- Records from before email + PIN keep working where they can; Empleados lists
  who still needs an email and a 6-digit PIN.

Every write is signed with the person's stable **usuario** (the code, or the
email); the rules verify it. The register, the price check and the back office
each keep their own Firebase session, so on one computer a cashier can have
their shift open while an admin uses the back office in another window.

**Prices belong to the admins.** Only an admin creates products, changes a
price, the unit, the tax class, or deactivates a product; price changes are
written together with their `priceHistory` entry. Staff with the Catálogo
permission may edit everything else (names, codes, size, stores, supplier) and
mark tags as printed; a new product or a removal is a **request**
(`solicitudes/`) that an admin resolves in the same batch that writes the
product. The rules enforce all of it, not just the screens.

## First-time setup

Once per Firebase project:

1. Firebase console → Authentication → Sign-in method → enable **Email/Password**.
2. Authentication → Settings → **User actions** → keep **Enable create (sign-up)**
   ON. Empleados needs it to create accounts from the browser. It is safe: an
   account without an active record cannot read or write anything.
3. Create your own admin account: Authentication → Users → **Add user**
   (email + password). Then Firestore → collection `staff` → document ID = your
   email in lowercase with `nombre` (string), `rol` = `admin` (string),
   `activo` = `true` (boolean). The back office completes the rest of the record
   the first time you open it.
4. Publish the rules: paste `firestore.rules` into the console's Rules tab, or
   `npx firebase login` and `npm run reglas:desplegar`.
5. Sign in at `login.html` and, in this order:
   - **Tiendas**: each store with its name, address, phone, email and HST number
     (they print at the top of every receipt).
   - **Empleados**: everyone, with their email and a 6-digit PIN (admins too, if
     they will use the register), and tick **Puede usar la app Catálogo** for
     whoever may edit the catalog.
   - **Cajas**: one per register (number 1–99; it appears in receipt numbers).
   - **Configuración**: tax name and rate (HST 13 %), suggested opening float,
     open-price limit, blind count, receipt width (80/58 mm) and footer, and the
     department keys of the register.
6. On each register computer, open `https://<site>/caja/` in Chrome: an admin
   signs in with their email and PIN (or password) and picks which register
   that computer is. Done once per computer: it stores the register and the
   register key, and from then on cashiers type only their PIN.
7. Staff with the Catálogo permission open `https://<site>/catalogo/` on their
   phone or PC and sign in with their email and PIN (installable on the phone).

## Back office

A sidebar (folding into a menu button on narrow screens) groups the pages:

- **Inicio**: sold today (all registers, with tax), tickets and returns, average
  ticket, HST collected, sales by hour (chart with its table), payment methods,
  which registers have a shift open and how much they sold, the latest tickets.
  Live, and it rolls over to the new day at midnight.
- **Ventas**: every ticket of a day, live, with totals; filters by register,
  person, type (sales, returns, approved, discounted) and payment method. Search
  by receipt number, or scan the barcode printed on the receipt, to open any
  ticket of any day: lines, payments, change, who approved, the receipt as it
  printed, **Reimprimir** (marked COPIA). CSV export of the day.
- **Turnos**: shifts open right now, and the shifts of a period with hours at
  the register, tickets, sales, expected cash, counted cash and the difference
  (over/short). The detail shows the Z report (X if still open), the tickets and
  cash movements of the shift, **Imprimir corte**, **Verificar contra las
  ventas** (recomputes the stored summary from the tickets), and for a shift left
  open, **Cerrar este turno** (an admin closes it, optionally with the counted
  cash; it is recorded as closed by that admin). Hours per person as CSV.
- **Reportes**: any date range, from the summary every shift stores when it
  closes: total, net sales, tax base and HST for the accountant, sales by day,
  payment methods, per person (shifts, hours, tickets, sales, average, cash
  over/short), per register, top products, department (open-price) sales and
  control counters (voided lines, cancelled tickets, discounts, price changes,
  approvals, drawer openings, cash drops, payouts). Print or CSV. Shifts still
  open are listed and join the report when they close.
- **Catálogo**: Productos, Captura rápida, Etiquetas, Prueba de etiquetas,
  Importar / exportar (unchanged, see below).
- **Empleados**, **Cajas**, **Tiendas**, **Configuración** (see setup).

## The register (`/caja/`)

Designed for a 1024 × 768 touch screen and up, with keyboard and USB scanner.

**Hardware per register**

- Windows PC with Google Chrome, the store's network, a touch screen or mouse.
- **USB barcode scanner** in keyboard mode (it types the code and Enter). No
  driver or API: the register listens to the keyboard.
- **Thermal receipt printer** (80 mm, or 58 mm in Configuración) set as the
  Windows default printer. Receipts print through Chrome's normal print
  pipeline (`@media print`, `css/recibo.css`); no ESC/POS. For receipts without
  a dialog, launch Chrome with `--kiosk-printing` (see *Direct printing* below)
  and print once from the dialog with the receipt printer, margins None.
- **Cash drawer** connected to the receipt printer: enable "open cash drawer"
  (Cash drawer / Peripheral device) in the printer driver, so every printed
  receipt or slip opens it. "Abrir cajón" prints a small slip for that reason.
- Card terminal (Moneris or similar) stand-alone: the cashier charges on the
  terminal and records the approved payment in the register.
- Scales are not integrated: weighed items ask for the weight (kg), and
  price-embedded scale labels (UPC starting with 2) are read automatically.

**A cashier's day**

1. **Open the shift**: only the 6-digit PIN on the register's start screen, then the
   opening float (suggested amount from Configuración). An opening slip prints.
2. **Sell**: scan; or type a PLU (4–5 digits; weighed items ask for kilos); or
   type letters to search by name; `3×` (or `3*`) then scan adds three; type a
   price and touch a department key for items without a code (`499` = $4.99).
   An unknown barcode offers to sell it by department. Lines can be changed:
   quantity, weight, price, discount, void. **Cobrar** (F10): cash with quick
   bills and the change in big digits (cash totals round to 5 ¢, Canada has no
   pennies), debit, credit or other, split payments. The receipt prints by
   itself.
3. **Needs an admin**: discounts (line or ticket), price changes, returns, and
   open-price sales above the limit. An admin types their own PIN on
   the register (a separate session; the cashier stays signed in). One approval
   covers the ticket. Admins selling at the register need no approval.
4. **Returns** (F8): scan the original receipt (or type its number, or "Sin
   recibo"), get the approval, scan the items, refund in cash or to the card.
5. **Other functions** (F9): reprint, tickets of the shift, open drawer, cash
   drop to the safe, cash in, payout from the drawer, X report (mid-shift),
   lock, close shift, full screen, keyboard shortcuts. **En espera** (F6) holds
   up to 6 tickets. Cancelled tickets and voided lines are recorded.
6. **Lock** when stepping away (button or Ctrl+B); the PIN unlocks it.
   Reloading the page or a power cut keeps the shift and the ticket in progress,
   and the register comes back locked.
7. **Close the shift**: count the drawer by bills and coins (blind count: the
   expected amount is not shown), confirm with the PIN. The **Z report** prints:
   tickets, gross/net sales, discounts, returns, HST, payment methods, opening
   float, cash sales, drops, expected vs counted and the difference, voids,
   cancellations, drawer openings, approvals, first/last receipt and the
   **hours at the register**. The register returns to its start screen.

Keyboard: F1 shortcuts, F2 price check, F3 search, F4/Supr void line, F5
quantity, F6 hold, F7 ticket discount, F8 return, F9 more, F10 pay, ↑/↓ select
a line, +/− one more/less, Esc clear.

**Rules that keep the money right** (`js/ticket.js`, `firestore.rules`):
integer cents everywhere; catalog prices are before tax; HST is computed once
per ticket on the taxable base after discounts, rounded half up; cash totals
round to 5 ¢ and the rounding is stored; a ticket is either a sale or a return
(all negative); sales and cash movements are immutable; the rules check that
the totals add up, that the payments cover the total, that the ticket belongs
to the cashier's own shift, the server time of each ticket, and that discounts,
price changes and returns carry an admin approval for that shift.

**Receipt numbers** look like `261102-01-0042`: date, register number and the
day's sequence on that register. The receipt prints it with a Code 128 barcode,
so scanning a receipt finds it in the back office or in a return.

**Without internet** the register keeps selling: tickets queue on the computer
and are sent when the connection comes back (the status pill in the top bar
shows how many are pending), the PIN unlocks against a local hash (never the
PIN itself), and the shift can be closed. Opening a shift, admin approvals and
signing in need the internet.

## Price check (`/caja/consulta.html`)

For every staff member, on a phone or at a PC. Sign in with email and PIN;
search by name, type a code or PLU, scan with the USB scanner, or tap
**Escanear** to use the phone camera (native `BarcodeDetector` or the vendored
ZXing). Shows the price, per kg for weighed items, the tax mark and the codes.
Read-only. Installable on the phone's home screen.

## Catálogo (`/catalogo/`)

For staff an admin allowed. Sign in with email and PIN. Same screens as the
back office catalog, in staff mode:

- **Productos**: search, scan, open a product and edit its data. Price, unit
  and tax class are locked. **Pedir que se quite** sends a removal request.
  An unknown barcode offers **Pedir alta con este UPC**: the form has no price;
  the product enters the catalog when an admin sets its price.
- **Captura rápida**: scan, name, brand, size, Enter: the request is sent.
- **Etiquetas**: print pending shelf tags (the printed price is recorded).
- **Mis solicitudes**: each request with its status and the admin's note.

In the back office, **Solicitudes** (with a badge in the sidebar) lists the
pending requests: for a new product the admin types the price (and price per
kg for weighed items), picks the tax class and **Agregar al catálogo**; for a
removal, **Quitar del catálogo** (the product becomes inactive: it disappears
from the register, the price check, searches and tags; it can be reactivated in
Productos) or **Rechazar** with a note.

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
UPC-E (8 digits starting with 0 or 1) is expanded to its UPC-A; EAN-8 is not
supported yet and is refused with a clear message.

## CSV import and export (step 6)

`gestion/datos.html` (back office → Importar / exportar) exports the whole catalog and imports a CSV back.

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
that Back office → Importar / exportar accepts, plus a review file with every
decision. No dependencies: it reuses `js/upca.js` and `js/csv.js`.

```
node herramientas/convertir-bestpos.mjs Rapport.csv --tienda=<store id> --salida=migracion
```

`--tienda` is the store identifier as shown in Back office → Tiendas (without it
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

### Loading a newer report on top of an existing catalog

A second export from BestPOS (new products, changed prices) should not be
imported as is: rows without a UPC would be created again, and every
imported column would overwrite what the staff already corrected by hand
(brand, name, tax class, stores). `herramientas/actualizar-desde-bestpos.mjs`
splits the new conversion into what is safe to import:

```
node herramientas/actualizar-desde-bestpos.mjs --anterior=<catalog csv> --nuevo=migracion/importar-bestpos-<store>.csv --salida=migracion --nombre=<store>
```

`--anterior` is what the catalog holds today: the export from Back office →
Importar / exportar (it carries `id`, so products are recognised by UPC, by
PLU and by name, and updated by id), or, failing that, the CSV that was
imported last time (no ids: only UPC matches count). It writes
`crear-<store>.csv` (products missing from the catalog, all columns),
`precios-<store>.csv` (`id` or `upc` plus `precioCentavos` for the products
whose price changed; the import records each change in `priceHistory`) and
`pendientes-<store>.txt` (price changes on products it could only recognise
by PLU or name without an id, and catalog products that no longer appear in
the report). Both CSVs are validated with `planificarImportacion` before
being written.

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

## Phones: installable apps and camera scanning

Staff use **Consulta de precios** (`caja/consulta.html`) on their phones: it
installs on the home screen and scans with the camera. Admins can also run the
back office on a phone or tablet: the sidebar folds behind a menu button,
product results render as cards, dialogs take the whole screen, and tapping a
product opens a **ficha de consulta** (big price, tax indicator, UPC, stores,
the tag as it prints, pending-tag status, price history) with an **Editar**
button. **Escanear** opens the camera: detection uses the browser's native
`BarcodeDetector` when it supports UPC/EAN (Chrome on Android) and otherwise
the vendored ZXing decoder (`vendor/zxing/`), loaded only when the scanner
opens, which is the path iPhones use. The camera needs HTTPS (Netlify) or
localhost, and the person must allow it once. USB scanners always work: they
type into whatever field has the focus.

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

**Shelf tags**: Brother QL-820NWB on 62 mm continuous tape, driver length
32 mm. The tag is designed for the printable area (59 × 29 mm). In Chrome:
paper `62mm`, layout Landscape (set by the page), margins None, scale 100 %.

**Receipts**: thermal roll printer, 80 mm by default (72 mm printable) or
58 mm (Configuración → Recibo). Physical sizes are CSS variables at the top of
`css/recibo.css`. Print once from Chrome's dialog with the receipt printer,
paper = the roll, margins None, headers and footers off; with
`--kiosk-printing` every later receipt goes straight to it. In the printer
driver choose the roll paper size (e.g. 80 × 3276 mm) and turn on cutting at the
end of the document / skipping blank space, so the paper is cut right after
the receipt; and turn on "open cash drawer" so the drawer opens with each
receipt.

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
default printer, so use it only on the cart laptops and the registers. To change printer or
settings later, launch Chrome once without the flag, print from the dialog,
then relaunch with it. To leave normal browsing untouched, a separate user
data directory runs as its own Chrome process with its own flags:
`chrome.exe --user-data-dir="C:\AguilaChrome" --kiosk-printing --app=https://<site>/`
(that profile needs its own login and builds its own offline cache).
The same steps are shown on the print screen under "Imprimir directo".
