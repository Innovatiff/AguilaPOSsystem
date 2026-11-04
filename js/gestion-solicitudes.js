/**
 * Back office · Solicitudes del Catálogo (solo administradores).
 *  - Alta: el admin revisa lo propuesto, pone el precio (y el precio por kilo
 *    si se vende por peso) y la clase fiscal, y el producto entra al catálogo.
 *  - Baja: el admin quita el producto (queda inactivo: deja de salir en la
 *    caja, la consulta, las búsquedas y las etiquetas) o la rechaza.
 * Las pendientes van de la más antigua a la más nueva.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { h } from './dom.js';
import { chip, mostrarMensaje, fechaCorta, hora } from './bo.js';
import { observarTodas, aprobarAlta, aprobarBaja, rechazar } from './solicitudes.js';
import { obtenerProducto, buscarPorUPC, observarTiendas, esperarConfirmacion } from './productos.js';
import { centavosDesdeTexto, formatearPrecio, indicadorFiscal } from './precios.js';
import { cargarNombres, nombreDeUsuario } from './personal.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'solicitudes.html' });
cargarNombres().catch(() => {});

const $ = (id) => document.getElementById(id);
const mensaje = $('mensaje');
let tiendas = new Map();
let ultima = [];
const ocupadas = new Set(); // solicitudes con una acción en curso

observarTiendas((lista) => {
  tiendas = new Map(lista.map((t) => [t.id, t.nombre]));
  // Las tarjetas ya pintadas muestran las tiendas: se rehacen, salvo si el admin está escribiendo en una.
  const contenedor = $('lista-pendientes');
  if (!contenedor.contains(document.activeElement)) contenedor.replaceChildren();
  pintar(ultima);
}, () => {});

const cuando = (marca) => (marca?.toMillis ? `${fechaCorta(marca)}, ${hora(marca)}` : 'ahora');
const nombreTiendas = (ids) => (ids?.length ? ids.map((id) => tiendas.get(id) ?? id).join(', ') : 'Sin tienda');

function dato(termino, valor) {
  return [h('dt', { text: termino }), h('dd', { text: valor || '—' })];
}

async function conBloqueo(solicitud, tarjeta, accion) {
  if (ocupadas.has(solicitud.id)) return;
  ocupadas.add(solicitud.id);
  for (const b of tarjeta.querySelectorAll('button, input')) b.disabled = true;
  try {
    await accion();
  } catch (error) {
    const aviso = tarjeta.querySelector('.solicitud__aviso');
    aviso.hidden = false;
    aviso.textContent = error?.campo ? error.message : mensajeError(error);
    error?.campo?.focus();
  } finally {
    ocupadas.delete(solicitud.id);
    if (tarjeta.isConnected) for (const b of tarjeta.querySelectorAll('button, input')) b.disabled = false;
  }
}

function cabecera(solicitud) {
  return h('header', { class: 'solicitud__cabecera' },
    solicitud.tipo === 'alta' ? chip('Alta', 'info') : chip('Baja', 'alerta'),
    h('h3', { text: solicitud.productoNombre }),
    h('span', { class: 'solicitud__quien', text: `Pidió ${solicitud.creadaPorNombre} · ${cuando(solicitud.creadaEn)}` }));
}

function tarjetaAlta(solicitud) {
  const p = solicitud.producto ?? {};
  const porPeso = p.unidadVenta === 'peso';
  const precio = h('input', { id: `precio-${solicitud.id}`, inputmode: 'decimal', autocomplete: 'off', placeholder: '4.99' });
  const precioKg = h('input', { id: `kilo-${solicitud.id}`, inputmode: 'decimal', autocomplete: 'off', placeholder: '15.99' });
  const fiscal = h('fieldset', { class: 'solicitud__fiscal' },
    h('legend', { text: 'Clase fiscal *' }),
    h('label', {}, h('input', { type: 'radio', name: `fiscal-${solicitud.id}`, value: 'gravado' }), ' Gravado (+HST, etiqueta +Tx)'),
    h('label', {}, h('input', { type: 'radio', name: `fiscal-${solicitud.id}`, value: 'tasaCero' }), ' Tasa cero (sin impuesto, etiqueta c)'));
  const aviso = h('p', { class: 'mensaje mensaje--error solicitud__aviso', role: 'alert', hidden: true });
  const duplicado = h('p', { class: 'mensaje mensaje--aviso', hidden: true });
  const agregar = h('button', { class: 'boton', type: 'button', text: 'Agregar al catálogo' });
  const tarjeta = h('article', { class: 'solicitud', 'data-id': solicitud.id },
    cabecera(solicitud),
    h('dl', { class: 'ficha ficha--compacta solicitud__datos' },
      ...dato('Código', [p.upc, p.plu ? `PLU ${p.plu}` : null].filter(Boolean).join(' · ') || 'Sin código'),
      ...dato('Presentación', p.presentacion),
      ...dato('Se vende', porPeso ? 'Por peso' : 'Por pieza'),
      ...dato('Tiendas', nombreTiendas(p.tiendas)),
      ...dato('Descriptor', p.descriptor),
      ...dato('Proveedor', p.proveedor),
      ...(solicitud.motivo ? dato('Nota', solicitud.motivo) : [])),
    duplicado,
    h('div', { class: 'solicitud__precio' },
      h('div', { class: 'campo' }, h('label', { for: precio.id, text: porPeso ? 'Precio en la etiqueta ($) *' : 'Precio ($) *' }), precio),
      porPeso ? h('div', { class: 'campo' }, h('label', { for: precioKg.id, text: 'Precio por kilo ($) *' }), precioKg) : null,
      fiscal),
    aviso,
    h('div', { class: 'solicitud__acciones' },
      agregar,
      h('button', { class: 'boton boton--secundario', type: 'button', text: 'Rechazar', onclick: () => pedirRechazo(solicitud, tarjeta) })));

  if (p.upc) {
    buscarPorUPC(p.upc).then((encontrados) => {
      if (encontrados.length === 0) return;
      const otro = encontrados[0];
      duplicado.hidden = false;
      duplicado.textContent = `Ya existe «${[otro.marca, otro.nombre, otro.presentacion].filter(Boolean).join(' ')}» con el código ${p.upc}${otro.activo ? '' : ' (inactivo)'}. Rechaza esta solicitud o cambia el código del producto existente.`;
      agregar.disabled = true;
    }).catch(() => {});
  }

  agregar.addEventListener('click', () => conBloqueo(solicitud, tarjeta, async () => {
    if (!duplicado.hidden) throw Object.assign(new Error(duplicado.textContent), { campo: agregar });
    let precioCentavos;
    let precioPorKgCentavos = null;
    try {
      precioCentavos = centavosDesdeTexto(precio.value);
    } catch (error) {
      throw Object.assign(new Error(`Precio: ${error.message}`), { campo: precio });
    }
    if (precioCentavos <= 0 && !porPeso) throw Object.assign(new Error('El precio debe ser mayor que cero.'), { campo: precio });
    if (porPeso) {
      try {
        precioPorKgCentavos = centavosDesdeTexto(precioKg.value);
      } catch (error) {
        throw Object.assign(new Error(`Precio por kilo: ${error.message}`), { campo: precioKg });
      }
      if (precioPorKgCentavos <= 0) throw Object.assign(new Error('El precio por kilo debe ser mayor que cero.'), { campo: precioKg });
    }
    const claseFiscal = tarjeta.querySelector(`input[name="fiscal-${solicitud.id}"]:checked`)?.value;
    if (!claseFiscal) throw Object.assign(new Error('Elige la clase fiscal: gravado o tasa cero.'), { campo: fiscal.querySelector('input') });
    const { producto, promesa } = aprobarAlta(solicitud, { precioCentavos, precioPorKgCentavos, claseFiscal }, personal);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa, 8000);
    avisar(`«${solicitud.productoNombre}» agregado al catálogo a ${formatearPrecio(producto.precioCentavos)} ${indicadorFiscal(claseFiscal)}${resultado === 'pendiente' ? ' (se enviará al recuperar la señal)' : ''}.`, 'ok');
  }));
  return tarjeta;
}

function tarjetaBaja(solicitud) {
  const aviso = h('p', { class: 'mensaje mensaje--error solicitud__aviso', role: 'alert', hidden: true });
  const datos = h('dl', { class: 'ficha ficha--compacta solicitud__datos' }, ...dato('Motivo', solicitud.motivo || 'Sin motivo'));
  const quitar = h('button', { class: 'boton boton--peligro', type: 'button', text: 'Quitar del catálogo' });
  const tarjeta = h('article', { class: 'solicitud solicitud--baja', 'data-id': solicitud.id },
    cabecera(solicitud),
    datos,
    aviso,
    h('div', { class: 'solicitud__acciones' },
      quitar,
      h('button', { class: 'boton boton--secundario', type: 'button', text: 'Rechazar', onclick: () => pedirRechazo(solicitud, tarjeta) })));

  obtenerProducto(solicitud.productoId).then((producto) => {
    if (!producto) return;
    const porPeso = producto.unidadVenta === 'peso' && producto.precioPorKgCentavos;
    datos.prepend(
      ...dato('Precio', `${porPeso ? `${formatearPrecio(producto.precioPorKgCentavos)}/kg` : formatearPrecio(producto.precioCentavos)} ${indicadorFiscal(producto.claseFiscal)}`),
      ...dato('Código', [producto.upc, producto.plu ? `PLU ${producto.plu}` : null].filter(Boolean).join(' · ') || 'Sin código'),
      ...dato('Tiendas', nombreTiendas(producto.tiendas)),
    );
    if (!producto.activo) {
      aviso.hidden = false;
      aviso.className = 'mensaje mensaje--aviso solicitud__aviso';
      aviso.textContent = 'Este producto ya está inactivo: al aprobar solo se cierra la solicitud.';
    }
  }).catch(() => {});

  quitar.addEventListener('click', () => conBloqueo(solicitud, tarjeta, async () => {
    if (!window.confirm(`¿Quitar «${solicitud.productoNombre}» del catálogo? Queda inactivo: deja de salir en la caja, la consulta, las búsquedas y las etiquetas. Se puede reactivar desde Productos.`)) return;
    const promesa = aprobarBaja(solicitud, personal);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa, 8000);
    avisar(`«${solicitud.productoNombre}» quitado del catálogo${resultado === 'pendiente' ? ' (se enviará al recuperar la señal)' : ''}.`, 'info');
  }));
  return tarjeta;
}

function pedirRechazo(solicitud, tarjeta) {
  const nota = window.prompt(`Rechazar «${solicitud.productoNombre}». Nota para ${solicitud.creadaPorNombre} (opcional):`, '');
  if (nota === null) return;
  conBloqueo(solicitud, tarjeta, async () => {
    const promesa = rechazar(solicitud, nota, personal);
    promesa.catch(() => {});
    await esperarConfirmacion(promesa, 8000);
    avisar('Solicitud rechazada.', 'info');
  });
}

function pintar(lista) {
  ultima = lista;
  const pendientes = lista.filter((s) => s.estado === 'pendiente')
    .sort((a, b) => (a.creadaEn?.toMillis?.() ?? Date.now()) - (b.creadaEn?.toMillis?.() ?? Date.now()));
  const contenedor = $('lista-pendientes');
  // No se repintan las tarjetas que ya están (el admin puede estar escribiendo un precio).
  const visibles = new Map([...contenedor.children].map((t) => [t.dataset.id, t]));
  const nuevas = pendientes.map((s) => visibles.get(s.id) ?? (s.tipo === 'alta' ? tarjetaAlta(s) : tarjetaBaja(s)));
  contenedor.replaceChildren(...nuevas);
  $('sin-pendientes').hidden = pendientes.length > 0;
  $('cuenta-pendientes').textContent = pendientes.length === 1 ? '1 pendiente' : `${pendientes.length} pendientes`;

  const resueltas = lista.filter((s) => s.estado !== 'pendiente')
    .sort((a, b) => (b.resueltaEn?.toMillis?.() ?? Date.now()) - (a.resueltaEn?.toMillis?.() ?? Date.now()))
    .slice(0, 50);
  $('tabla-resueltas').tBodies[0].replaceChildren(...resueltas.map((s) => h('tr', {},
    h('td', { text: cuando(s.resueltaEn) }),
    h('td', { text: s.creadaPorNombre }),
    h('td', { text: s.tipo === 'alta' ? 'Alta' : 'Baja' }),
    h('td', { text: s.productoNombre }),
    h('td', {}, s.estado === 'aprobada' ? chip(s.tipo === 'alta' ? 'Agregado' : 'Quitado', 'abierto') : chip('Rechazada', 'neutro'),
      h('span', { class: 'secundario', text: ` por ${nombreDeUsuario(s.resueltaPor)}` })),
    h('td', { text: s.nota ?? '' }))));
  $('sin-resueltas').hidden = resueltas.length > 0;
  $('contenido').hidden = false;
}

observarTodas(pintar, (error) => {
  mostrarMensaje(mensaje, 'error', `No se pudieron cargar las solicitudes: ${mensajeError(error)}`);
  $('contenido').hidden = false;
});
