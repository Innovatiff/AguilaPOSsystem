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

### `staff/{email}`
Document ID is the login email, lowercase. **Optional**: every account in
Firebase Authentication has access as `empleado` without a record. The record
adds a name, grants `admin`, or revokes access. Client sign-up must therefore be
disabled in Authentication settings; accounts are created from the console.

| field | type | notes |
|---|---|---|
| nombre | string, 1–80 | |
| rol | `"admin"` \| `"empleado"` | admin manages staff and stores; empleado works the catalog |
| activo | boolean | access is denied the moment this is false |

Written by admins only. An admin cannot deactivate or demote their own record.
Each signed-in user may read their own record even when inactive (so the app can
explain why access was refused).

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
| actualizadoPor | string | must equal the writer's email |

### `priceHistory/{entradaId}`
Immutable. `entradaId` = `${productId}_${fecha.toMillis()}`.

| field | type |
|---|---|
| productId | string |
| precioAnteriorCentavos | integer |
| precioNuevoCentavos | integer |
| fecha | timestamp |
| usuario | string (email) |

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
