# Catálogo Águila · Data model

Firestore, project `aguilapos`. Everything below is enforced by `firestore.rules`
and mirrored in `js/esquema.js`. Field names are exact: a document with an extra
field is rejected. Money is always **integer cents** (`499` = $4.99), never a float.

## Collections

### `stores/{storeId}`
`storeId` is a slug (`^[a-z0-9-]{2,40}$`), chosen once, referenced from `products.tiendas`.

| field | type | notes |
|---|---|---|
| nombre | string, 1–80 | |
| direccion | string, ≤160 | may be empty |
| activo | boolean | |

Written by admins only. Never deleted.

### `staff/{usuario}`
Document ID is the person's stable **usuario**: their employee code (3–8 digits)
or, for email accounts, the email in lowercase. **Required for access**: a
Firebase Authentication account with no active record cannot read or write
anything. Records are created from Gestión (the manager app), which also
creates the Authentication account behind them.

Code accounts are backed by a synthetic email `<code>@codigo.aguilapos.firebaseapp.com`
(constant `DOMINIO_CODIGOS` in `js/identidad.js`, mirrored in the rules) whose
password is the employee's NIP. Resetting a NIP creates a new account
`<code>.<n>@…` and points `correoAuth` at it; the old account loses access.

| field | type | notes |
|---|---|---|
| usuario | string | equals the document ID |
| tipo | `"codigo"` \| `"correo"` | |
| correoAuth | string | the Authentication email currently allowed for this record; for `correo` it equals `usuario` |
| nombre | string, 1–80 | |
| rol | `"admin"` \| `"empleado"` | admin uses Gestión (staff, stores, CSV); empleado works the catalog |
| activo | boolean | access is denied the moment this is false |
| tienda | storeId \| null | informational |
| creadoEn | timestamp | immutable |
| actualizadoEn | timestamp | |
| actualizadoPor | string | usuario of the admin who wrote it |
| cuentaVersion | integer ≥ 1 | 1 for `correo`; increments on each NIP reset for `codigo` |

Written by admins only. An admin cannot deactivate or demote their own record,
nor change their own `correoAuth`. Each signed-in account may read its own
record even when inactive (so the app can explain why access was refused).
Records created before Gestión (only `nombre`, `rol`, `activo`) keep working
and are completed on their next update.

**Identity in writes.** `products.actualizadoPor` and `priceHistory.usuario`
must equal the writer's `usuario`, derived in the rules from the token email:
the code for a synthetic email, the lowercase email otherwise.

### `accesos/{codigo}`
Tiny public lookup written together with `staff/{codigo}`: `{ version: <int> }`,
the account version currently valid for that employee code. The login screen
reads it (a single `get`, allowed without authentication; listing is not) to
build the synthetic email before signing in. The rules require the value to
equal `staff/{codigo}.cuentaVersion` after the same batch. Never deleted.

### `products/{productId}`
`productId` is an auto ID, **never** the UPC.

| field | type | rule |
|---|---|---|
| upc | string \| null | exactly 12 digits (UPC-A) |
| plu | string \| null | 4–5 digits |
| nombre | string, 1–80 | main tag line (reversed bar) |
| marca | string \| null, ≤60 | tag line 1 |
| descriptor | string \| null, ≤80 | optional small line, not uppercased |
| presentacion | string, ≤30 | "142g", "240mL" |
| precioCentavos | integer, 0–9 999 999 | > 0 when unidadVenta is `pieza` |
| unidadVenta | `"pieza"` \| `"peso"` | |
| precioPorKgCentavos | integer \| null | required > 0 for `peso`, must be null for `pieza` |
| claseFiscal | `"gravado"` \| `"tasaCero"` | tag indicator derives from this: `+Tx` / `c` |
| tiendas | array of storeId, ≤20 | |
| existencias | integer \| null | POS-owned; catalog leaves null and cannot change it |
| costoCentavos | integer \| null | POS-owned; same |
| proveedor | string \| null, ≤80 | |
| activo | boolean | products are deactivated, never deleted |
| ultimoPrecioImpresoCentavos | integer \| null | set by batch print |
| fechaUltimaImpresion | `"YYYY-MM-DD"` \| null | local date of the station |
| tokensBusqueda | array of string, ≤400 | see Search |
| creadoEn | timestamp | equal to actualizadoEn on create, immutable afterwards |
| actualizadoEn | timestamp | client `Timestamp.fromMillis(Date.now())` |
| actualizadoPor | string | must equal the writer's usuario (employee code or email) |

### `priceHistory/{entradaId}`
Immutable. `entradaId` = `${productId}_${fecha.toMillis()}`.

| field | type |
|---|---|
| productId | string |
| precioAnteriorCentavos | integer |
| precioNuevoCentavos | integer |
| fecha | timestamp |
| usuario | string (employee code or email) |

## Invariants the rules enforce

**Every price change carries its history entry, atomically.** A product update
that changes `precioCentavos` is accepted only if a `priceHistory` document with
ID `${productId}_${actualizadoEn.toMillis()}` exists after the write. The history
entry is accepted only if:

- `precioAnteriorCentavos` equals the price stored **before** the batch (`get()`),
- `precioNuevoCentavos` equals the price stored **after** it (`getAfter()`),
- `fecha` equals the product's new `actualizadoEn`, and `usuario` is the writer.

So the client must write both in one `writeBatch` (a transaction would also
work, but transactions need connectivity and batches queue offline). If another
station changed the price first, the batch is rejected server-side and the app
must reload the product and retry. History can never be written on its own,
edited, or deleted.

**Timestamps are client-side, whole milliseconds.** `Timestamp.fromMillis(Date.now())`
gives `toMillis()` an exact integer on both client and rules, and works while offline.

## Search

Firestore has no substring search. On every write the client computes
`tokensBusqueda` = every prefix of length ≥ 3 of every word of `nombre` and
`marca`, after lowercasing and stripping accents (`ñ` → `n`). Queries run
`where('tokensBusqueda', 'array-contains', term)` with the longest normalized
term of what was typed, ordered by `nombre`, and filter the remaining terms on
the client. UPC lookup is a separate exact match on `upc`.

## Indexes

`firestore.indexes.json` declares the composite indexes the screens need:
`tokensBusqueda` + `nombre`, `tokensBusqueda` + `activo` + `nombre`, `activo` +
`nombre`, `tiendas` + `activo` + `nombre`, and `priceHistory` by `productId` +
`fecha` desc. Deploy with `npm run reglas:desplegar`.
