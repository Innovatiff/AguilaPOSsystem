# Águila POS · Data model

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
| telefono | string, ≤30 | optional; printed on receipts |
| correo | string, ≤80 | optional; printed on receipts |
| numeroImpuesto | string, ≤30 | optional; HST registration number printed on receipts |

Written by admins only. Never deleted. Stores created before the POS have no
`telefono` / `correo` / `numeroImpuesto` and keep working.

### `staff/{usuario}`
Document ID is the person's stable **usuario**: their internal number (exactly 6
digits, assigned by Empleados; nobody types it) or, for email + password accounts,
the email in lowercase. **Required for access**: a
Firebase Authentication account with no active record cannot read or write
anything. Records are created in Back office → Empleados, which also creates
the Authentication account behind them.

Staff are registered with their **email** and a **6-digit NIP that nobody else
has**. Number accounts are backed by a synthetic email
`<number>@codigo.aguilapos.firebaseapp.com` (constant `DOMINIO_CODIGOS` in
`js/identidad.js`, mirrored in the rules) whose password is the NIP. Changing a
NIP creates a new account `<number>.<n>@…` and points `correoAuth` at it; the
old account loses access. `correos/` and `nips/` (below) let people sign in with
email + NIP, or with only the NIP at a register.

| field | type | notes |
|---|---|---|
| usuario | string | equals the document ID |
| tipo | `"codigo"` \| `"correo"` | |
| correoAuth | string | the Authentication email currently allowed for this record; for `correo` it equals `usuario` |
| nombre | string, 1–80 | |
| rol | `"admin"` \| `"empleado"` | admin: back office, register, price check and Catálogo; empleado: register, price check and, with `catalogo`, the Catálogo app |
| activo | boolean | access is denied the moment this is false |
| tienda | storeId \| null | informational |
| creadoEn | timestamp | immutable |
| actualizadoEn | timestamp | |
| actualizadoPor | string | usuario of the admin who wrote it |
| cuentaVersion | integer ≥ 1 | 1 for `correo`; increments on each NIP change for `codigo` |
| correo | string \| null | the person's real email, lowercase; for `correo` it equals `usuario`. Optional for records from before email + NIP |
| catalogo | boolean | may use the Catálogo app (admins always may). Optional; missing = false |

Written by admins only. An admin cannot deactivate or demote their own record,
nor change their own `correoAuth`. Each signed-in account may read its own
record even when inactive (so the app can explain why access was refused).
Records created before Gestión (only `nombre`, `rol`, `activo`) keep working
and are completed on their next update.

**Identity in writes.** `products.actualizadoPor` and `priceHistory.usuario`
must equal the writer's `usuario`, derived in the rules from the token email:
the code for a synthetic email, the lowercase email otherwise.

### `correos/{correo}`
`{ codigo }`: which number account an email belongs to, so staff sign in with
email + NIP. Public `get` of one document (no listing). Written by an admin in
the same batch as the `staff` record whose `correo` it is (the rules check it
with `getAfter`); never rewritten to point elsewhere, deleted when the email
changes.

### `nips/{huella}`
`{ codigo, version }`: whose NIP this is, for NIP-only sign-in at a register.
`huella = HMAC-SHA-256(register key, "nip:" + NIP)` in hex (`js/nip.js`).
Public `get` (without the key nobody can compute a `huella`), listing only for
admins. Create-only: an existing `huella` cannot be overwritten, so a NIP never
repeats. Written by an admin with `version` equal to the record's
`cuentaVersion`; old entries are deleted when the NIP changes.

### `secretos/caja`
`{ clave, creadaEn, creadaPor }`: the register key (base64 of 32 random bytes).
Only admins read it; it is created once (the first time an admin registers a
NIP or sets up a register) and never changes. Each register computer stores it
when an admin sets it up.

### `solicitudes/{id}`
Requests from the Catálogo app to the admins.

| field | type | notes |
|---|---|---|
| tipo | `"alta"` \| `"baja"` | add a new product, or remove an active one |
| estado | `"pendiente"` \| `"aprobada"` \| `"rechazada"` | |
| producto | map \| null | `alta`: the proposal, exactly `upc, plu, nombre, marca, descriptor, presentacion, unidadVenta, tiendas, proveedor` (same formats as `products`), **no price and no tax class**; `baja`: null |
| productoId | string \| null | `baja`: the product; `alta`: set on approval to the product created |
| productoNombre | string 1–120 | for display |
| motivo | string ≤300 | reason or note from the requester |
| creadaPor / creadaPorNombre | usuario / string | must be the writer |
| creadaEn | timestamp | server time |
| resueltaPor / resueltaEn / nota | usuario / server time / string ≤300 \| null | set once, by an admin |

Created by admins and staff with `catalogo`; read by them; resolved only by an
admin, once. Approving an `alta` must create the product in the same batch
(`existsAfter`); approving a `baja` must leave the product inactive in the same
batch. Never deleted.

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
| upc | string \| null | 12 digits (UPC-A) or 13 digits not starting with 0 (EAN-13); a 13-digit code starting with 0 is stored as its 12-digit UPC-A form |
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

**Only admins set prices.** Creating a product, writing `priceHistory`, and
changing `precioCentavos`, `precioPorKgCentavos`, `unidadVenta`, `claseFiscal`
or `activo` require the writer's `staff` record to have `rol = admin`. Staff with
`catalogo = true` may update an **active** product's `upc`, `plu`, `nombre`,
`marca`, `descriptor`, `presentacion`, `tiendas`, `proveedor`, `tokensBusqueda`,
and mark its tag printed (`ultimoPrecioImpresoCentavos` only to the current
price, `fechaUltimaImpresion`), signed as themselves; new products and removals
go through `solicitudes`. Every active staff member can read products (the
register and the price check need them).

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

## Point of sale

All POS collections are written by the register (`js/pos-datos.js`) or the
back office and checked by the rules in `firestore.rules` (section "POS ·
caja registradora"). Money is integer cents; dates are Firestore timestamps.
Reading: an admin reads everything; a staff member reads only their own
shifts, sales, cash movements and approvals (`cajero` = their usuario).

### `config/pos`
One document, written by admins (Back office → Configuración). Missing fields
fall back to the defaults in `js/config-pos.js`.

| field | type | notes |
|---|---|---|
| impuestoNombre | string, 1–20 | `"HST"` |
| tasaImpuestoBP | integer 0–3000 | basis points: `1300` = 13 % |
| fondoSugeridoCentavos | integer ≥ 0 | proposed opening float |
| limiteVentaLibreCentavos | integer ≥ 0 | above it an open-price (department) sale needs approval; 0 = no limit |
| conteoCiego | boolean | the cashier counts without seeing the expected cash |
| papelRecibo | `58` \| `80` | receipt roll width in mm |
| reciboPie | string ≤300 | receipt footer |
| departamentos | array ≤24 of `{ id, nombre, claseFiscal, color }` | department keys; `id` slug, never changes (sales store it) |
| actualizadoEn / actualizadoPor | timestamp / usuario | |

### `cajas/{cajaId}`
A register. `cajaId` is `<storeId>-<numero>` when created from the back office.

| field | type | notes |
|---|---|---|
| nombre | string 1–40 | "Caja 1" |
| numero | integer 1–99 | in every receipt number |
| tienda | storeId | |
| activo | boolean | an inactive register cannot open shifts |
| turnoActual | turnoId \| null | the open shift; at most one per register |
| turnoCajero / turnoCajeroNombre | usuario / string \| null | who has it open |
| turnoDesde | timestamp \| null | equals the shift's `abiertoEn` |
| actualizadoEn / actualizadoPor | timestamp / usuario | last admin edit |

Admins edit `nombre`, `numero`, `tienda`, `activo`. The `turno*` fields only
change in the same batch that opens or closes a shift (the rules check the
shift with `getAfter`).

### `turnos/{turnoId}`
A cashier's shift on a register.

| field | type | notes |
|---|---|---|
| caja, cajaNombre, numeroCaja, tienda, tiendaNombre | | copied from the register |
| cajero, cajeroNombre | usuario, string | the person; must be the writer when opening |
| estado | `"abierto"` \| `"cerrado"` | |
| abiertoEn | timestamp | **server time** (`request.time`): hours do not depend on the PC clock |
| fondoInicialCentavos | integer ≥ 0 | opening float |
| cerradoEn | timestamp \| null | register clock at close (can be queued offline; never in the future) |
| cierreRegistradoEn | timestamp \| null | server time when the close reached the server |
| cerradoPor | usuario \| null | the cashier, or the admin who closed it |
| cierreForzado | boolean | true when an admin closed someone else's shift |
| efectivoContadoCentavos | integer \| null | cash counted at close |
| conteo | map denomination → count \| null | e.g. `{ "2000": 3, "25": 4 }` |
| diferenciaCentavos | integer \| null | counted − expected (negative = short) |
| resumen | map \| null | the Z summary (`resumirTurno` in `js/turnos.js`): counts, totals, tax bases, payment methods, cash section, voids, cancellations, by hour, by department, by product; reports add these up |
| notaCierre | string \| null | |

Opening and closing are batches together with `cajas/{cajaId}`. Opening
requires the register to be active and free. Closing is allowed to the
cashier or an admin, changes only the closing fields and frees the register.

### `ventas/{ventaId}`
A ticket: a sale or a return (`tipo`), immutable. Fields (exact list in
`CAMPOS_VENTA`, `js/ticket.js`): `folio` (`AAMMDD-CC-NNNN`), `numero`, `dia`
(`AAAA-MM-DD`, local), `tipo`, `turno`, `caja`, `cajaNombre`, `numeroCaja`,
`tienda`, `tiendaNombre`, `cajero`, `cajeroNombre`, `fecha` (register clock),
`registradoEn` (server time), `lineas` (array of `{ productoId, upc, plu,
nombre, presentacion, departamento, claseFiscal, unidad, cantidad, pesoGramos,
precioUnitarioCentavos, precioOriginalCentavos, descuentoCentavos,
descuentoTicketCentavos, importeCentavos, netoCentavos }`), `articulos`,
`brutoCentavos`, `descuentoLineasCentavos`, `subtotalCentavos`,
`descuentoTicketCentavos`, `baseGravadaCentavos`, `baseTasaCeroCentavos`,
`tasaImpuestoBP`, `impuestoCentavos`, `totalCentavos`, `redondeoCentavos`,
`cambioCentavos`, `pagos` (array of `{ metodo, importeCentavos,
recibidoCentavos, cambioCentavos }`), `porMetodo` (`efectivo`, `debito`,
`credito`, `otro`), `lineasAnuladas`, `lineasAnuladasCentavos`,
`cambiosPrecio`, `autorizacion`, `autorizadoPor`, `ventaOriginal`.

The rules check: exact fields; the writer is the `cajero` and owns the
`turno` of that register and store; `registradoEn` is the server time and
`fecha` is not in the future nor before the shift opened; integer cents;
`subtotal = bruto − descuentos de línea`, `total = subtotal − descuento al
ticket + impuesto`, `base gravada + tasa cero = subtotal − descuento al
ticket`, payments by method add up to `total + redondeo`, `|redondeo| ≤ 2`;
a sale is ≥ 0 and a return < 0; discounts, price changes and returns carry an
approval (`autorizaciones`) for that shift and cashier, unless the cashier is
an admin. The rules cannot loop over lines: the register validates every line
(`validarVenta`) before saving. A ticket synced after its shift was closed is
still accepted (offline registers).

### `movimientosCaja/{movimientoId}`
Immutable cash movements of a shift: `tipo` = `retiro` (drop to the safe),
`entrada` (cash in), `pago` (payout from the drawer), `apertura` (no sale,
amount 0) or `cancelacion` (a cancelled ticket and its amount). Fields:
`turno`, `caja`, `tienda`, `cajero`, `cajeroNombre`, `tipo`,
`importeCentavos`, `motivo`, `fecha`, `registradoEn` (server time).

### `autorizaciones/{autorizacionId}`
Written by an admin from the register with their own code and PIN, in a
separate session: `tipo` (`modificacion` for discounts, price changes and
large open-price sales; `devolucion` for returns), `turno`, `caja`, `cajero`,
`admin`, `fecha` (server time), `detalle`. Only for an open shift of that
cashier on that register. Immutable.

### `eventos/{eventoId}`
Live register activity for **Movimientos en vivo** and the audit history of
each transaction. One document per action, written by the cashier's session
(fire and forget: a failed write never blocks a sale) and immutable. Admins
read; nobody updates or deletes. Fields, exactly:

| field | type | notes |
|---|---|---|
| tipo | string | `venta_iniciada`, `articulo`, `cantidad`, `precio`, `descuento`, `articulo_anulado`, `autorizacion`, `espera`, `recuperada`, `venta_cancelada`, `pago`, `venta_completada`, `devolucion_iniciada`, `devolucion_completada`, `efectivo`, `turno_abierto`, `turno_cerrado` |
| turno, caja, cajaNombre, numeroCaja, tienda | | the shift and register |
| cajero, cajeroNombre | string | must be the signed-in user |
| ticket | string \| null | local id of the ticket in progress (links every movement of one sale) |
| folio | string \| null | receipt number, on `pago` and `venta_completada` / `devolucion_completada` |
| texto | string ≤ 200 | what the feed shows: "Venta 261104-01-0001 completada — $17.51 (4 artículos, efectivo), cambio $0.49" |
| importeCentavos | integer \| null | |
| fecha | timestamp | register clock, strictly increasing per register (order within a ticket); not in the future |
| registradoEn | timestamp | server time (`== request.time`); the feed orders by it |

The history of a sale is found by its `folio` (→ `ticket` → every movement of
that ticket); the history of a cancelled ticket (`movimientosCaja` tipo
`cancelacion`) by the `venta_cancelada` movement of the same shift and amount.

## Inventory

### `recepciones/{recepcionId}`
A delivery that came in (**Inventario → Recibir mercancía**, also in the
Catálogo app). Created by an admin or staff with the Catálogo permission;
read by both; only an admin can void it (once); nobody deletes it. It does
**not** change the products' `existencias`. Fields, exactly:

| field | type | notes |
|---|---|---|
| tienda | string \| null | store id |
| proveedor | string \| null, ≤ 80 | supplier |
| referencia | string \| null, ≤ 60 | invoice or delivery note |
| nota | string \| null, ≤ 200 | |
| lineas | list, 1–300 | `{ producto, nombre, upc, plu, cantidad, pesoGramos }`: `producto` is the product id or null for something not in the catalog yet (received with its barcode and a typed name); pieces in `cantidad` (integer 1–99 999, `pesoGramos` null) or weight in `pesoGramos` (integer grams, `cantidad` null). The app validates and merges the lines (`js/inventario.js`); the rules cannot loop over lists |
| productos | integer | `== lineas.size()` |
| piezas, gramos | integer ≥ 0 | totals of the lines |
| recibidoPor, recibidoPorNombre | string | must be the signed-in user |
| fecha | timestamp | server time (`== request.time`) |
| anulada, anuladaPor, anuladaEn | bool, string \| null, timestamp \| null | `false, null, null` on create; an admin sets `true`, themself and server time |

### What stays on the register computer (localStorage)
Which register the computer is, the ticket in progress and held tickets (they
survive a reload or a power cut), the day's receipt counter of that register,
and a PBKDF2-SHA-256 hash of the cashier's PIN to unlock without internet
(never the PIN; deleted when the shift closes).

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

The POS queries need no composite index: they use equality filters only
(`ventas` by `dia`, by `folio`, or by `turno` + `cajero`; `turnos` by
`estado`, or `cajero` + `estado`; `movimientosCaja` by `turno` + `cajero`;
`eventos` by `ticket`, by `folio`, or by `turno` + `tipo`), which Firestore
serves by merging single-field indexes, or a range on a single field
(`turnos` by `abiertoEn`; `ventas` by `dia`; `movimientosCaja` by
`registradoEn`; `eventos` by `registradoEn`, ordered by it; `recepciones` by
`fecha`, ordered by it).
