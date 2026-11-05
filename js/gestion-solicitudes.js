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
import { t } from './idioma.js';
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
  tiendas = new Map(lista.map((tienda) => [tienda.id, tienda.nombre]));
  // Las tarjetas ya pintadas muestran las tiendas: se rehacen, salvo si el admin está escribiendo en una.
  const contenedor = $('lista-pendientes');
  if (!contenedor.contains(document.activeElement)) contenedor.replaceChildren();
  pintar(ultima);
}, () => {});

const cuando = (marca) => (marca?.toMillis ? `${fechaCorta(marca)}, ${hora(marca)}` : t('ahora'));
const nombreTiendas = (ids) => (ids?.length ? ids.map((id) => tiendas.get(id) ?? id).join(', ') : t('Sin tienda'));

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
    solicitud.tipo === 'alta' ? chip(t('Alta'), 'info') : chip(t('Baja'), 'alerta'),
    h('h3', { text: solicitud.productoNombre }),
    h('span', { class: 'solicitud__quien', text: t('Pidió {nombre} · {cuando}', { nombre: solicitud.creadaPorNombre, cuando: cuando(solicitud.creadaEn) }) }));
}

function tarjetaAlta(solicitud) {
  const p = solicitud.producto ?? {};
  const porPeso = p.unidadVenta === 'peso';
  const precio = h('input', { id: `precio-${solicitud.id}`, inputmode: 'decimal', autocomplete: 'off', placeholder: '4.99' });
  const precioKg = h('input', { id: `kilo-${solicitud.id}`, inputmode: 'decimal', autocomplete: 'off', placeholder: '15.99' });
  const fiscal = h('fieldset', { class: 'solicitud__fiscal' },
    h('legend', { text: t('Clase fiscal *') }),
    h('label', {}, h('input', { type: 'radio', name: `fiscal-${solicitud.id}`, value: 'gravado' }), ' ' + t('Gravado (+HST, etiqueta +Tx)')),
    h('label', {}, h('input', { type: 'radio', name: `fiscal-${solicitud.id}`, value: 'tasaCero' }), ' ' + t('Tasa cero (sin impuesto, etiqueta c)')));
  const aviso = h('p', { class: 'mensaje mensaje--error solicitud__aviso', role: 'alert', hidden: true });
  const duplicado = h('p', { class: 'mensaje mensaje--aviso', hidden: true });
  const agregar = h('button', { class: 'boton', type: 'button', text: t('Agregar al catálogo') });
  const tarjeta = h('article', { class: 'solicitud', 'data-id': solicitud.id },
    cabecera(solicitud),
    h('dl', { class: 'ficha ficha--compacta solicitud__datos' },
      ...dato(t('Código'), [p.upc, p.plu ? `PLU ${p.plu}` : null].filter(Boolean).join(' · ') || t('Sin código')),
      ...dato(t('Presentación'), p.presentacion),
      ...dato(t('Se vende'), porPeso ? t('Por peso') : t('Por pieza')),
      ...dato(t('Tiendas'), nombreTiendas(p.tiendas)),
      ...dato(t('Descriptor'), p.descriptor),
      ...dato(t('Proveedor'), p.proveedor),
      ...(solicitud.motivo ? dato(t('Nota'), solicitud.motivo) : [])),
    duplicado,
    h('div', { class: 'solicitud__precio' },
      h('div', { class: 'campo' }, h('label', { for: precio.id, text: porPeso ? t('Precio en la etiqueta ($) *') : t('Precio ($) *') }), precio),
      porPeso ? h('div', { class: 'campo' }, h('label', { for: precioKg.id, text: t('Precio por kilo ($) *') }), precioKg) : null,
      fiscal),
    aviso,
    h('div', { class: 'solicitud__acciones' },
      agregar,
      h('button', { class: 'boton boton--secundario', type: 'button', text: t('Rechazar'), onclick: () => pedirRechazo(solicitud, tarjeta) })));

  if (p.upc) {
    buscarPorUPC(p.upc).then((encontrados) => {
      if (encontrados.length === 0) return;
      const otro = encontrados[0];
      duplicado.hidden = false;
      const valores = { nombre: [otro.marca, otro.nombre, otro.presentacion].filter(Boolean).join(' '), codigo: p.upc };
      duplicado.textContent = otro.activo
        ? t('Ya existe «{nombre}» con el código {codigo}. Rechaza esta solicitud o cambia el código del producto existente.', valores)
        : t('Ya existe «{nombre}» con el código {codigo} (inactivo). Rechaza esta solicitud o cambia el código del producto existente.', valores);
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
      throw Object.assign(new Error(t('Precio: {error}', { error: error.message })), { campo: precio });
    }
    if (precioCentavos <= 0 && !porPeso) throw Object.assign(new Error(t('El precio debe ser mayor que cero.')), { campo: precio });
    if (porPeso) {
      try {
        precioPorKgCentavos = centavosDesdeTexto(precioKg.value);
      } catch (error) {
        throw Object.assign(new Error(t('Precio por kilo: {error}', { error: error.message })), { campo: precioKg });
      }
      if (precioPorKgCentavos <= 0) throw Object.assign(new Error(t('El precio por kilo debe ser mayor que cero.')), { campo: precioKg });
    }
    const claseFiscal = tarjeta.querySelector(`input[name="fiscal-${solicitud.id}"]:checked`)?.value;
    if (!claseFiscal) throw Object.assign(new Error(t('Elige la clase fiscal: gravado o tasa cero.')), { campo: fiscal.querySelector('input') });
    const { producto, promesa } = aprobarAlta(solicitud, { precioCentavos, precioPorKgCentavos, claseFiscal }, personal);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa, 8000);
    avisar(t('«{nombre}» agregado al catálogo a {precio}{pendiente}.', {
      nombre: solicitud.productoNombre,
      precio: `${formatearPrecio(producto.precioCentavos)} ${indicadorFiscal(claseFiscal)}`,
      pendiente: resultado === 'pendiente' ? ' ' + t('(se enviará al recuperar la señal)') : '',
    }), 'ok');
  }));
  return tarjeta;
}

function tarjetaBaja(solicitud) {
  const aviso = h('p', { class: 'mensaje mensaje--error solicitud__aviso', role: 'alert', hidden: true });
  const datos = h('dl', { class: 'ficha ficha--compacta solicitud__datos' }, ...dato(t('Motivo'), solicitud.motivo || t('Sin motivo')));
  const quitar = h('button', { class: 'boton boton--peligro', type: 'button', text: t('Quitar del catálogo') });
  const tarjeta = h('article', { class: 'solicitud solicitud--baja', 'data-id': solicitud.id },
    cabecera(solicitud),
    datos,
    aviso,
    h('div', { class: 'solicitud__acciones' },
      quitar,
      h('button', { class: 'boton boton--secundario', type: 'button', text: t('Rechazar'), onclick: () => pedirRechazo(solicitud, tarjeta) })));

  obtenerProducto(solicitud.productoId).then((producto) => {
    if (!producto) return;
    const porPeso = producto.unidadVenta === 'peso' && producto.precioPorKgCentavos;
    datos.prepend(
      ...dato(t('Precio'), `${porPeso ? `${formatearPrecio(producto.precioPorKgCentavos)}/kg` : formatearPrecio(producto.precioCentavos)} ${indicadorFiscal(producto.claseFiscal)}`),
      ...dato(t('Código'), [producto.upc, producto.plu ? `PLU ${producto.plu}` : null].filter(Boolean).join(' · ') || t('Sin código')),
      ...dato(t('Tiendas'), nombreTiendas(producto.tiendas)),
    );
    if (!producto.activo) {
      aviso.hidden = false;
      aviso.className = 'mensaje mensaje--aviso solicitud__aviso';
      aviso.textContent = t('Este producto ya está inactivo: al aprobar solo se cierra la solicitud.');
    }
  }).catch(() => {});

  quitar.addEventListener('click', () => conBloqueo(solicitud, tarjeta, async () => {
    if (!window.confirm(t('¿Quitar «{nombre}» del catálogo? Queda inactivo: deja de salir en la caja, la consulta, las búsquedas y las etiquetas. Se puede reactivar desde Productos.', { nombre: solicitud.productoNombre }))) return;
    const promesa = aprobarBaja(solicitud, personal);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa, 8000);
    avisar(t('«{nombre}» quitado del catálogo{pendiente}.', {
      nombre: solicitud.productoNombre,
      pendiente: resultado === 'pendiente' ? ' ' + t('(se enviará al recuperar la señal)') : '',
    }), 'info');
  }));
  return tarjeta;
}

function pedirRechazo(solicitud, tarjeta) {
  const nota = window.prompt(t('Rechazar «{nombre}». Nota para {persona} (opcional):', { nombre: solicitud.productoNombre, persona: solicitud.creadaPorNombre }), '');
  if (nota === null) return;
  conBloqueo(solicitud, tarjeta, async () => {
    const promesa = rechazar(solicitud, nota, personal);
    promesa.catch(() => {});
    await esperarConfirmacion(promesa, 8000);
    avisar(t('Solicitud rechazada.'), 'info');
  });
}

function pintar(lista) {
  ultima = lista;
  const pendientes = lista.filter((s) => s.estado === 'pendiente')
    .sort((a, b) => (a.creadaEn?.toMillis?.() ?? Date.now()) - (b.creadaEn?.toMillis?.() ?? Date.now()));
  const contenedor = $('lista-pendientes');
  // No se repintan las tarjetas que ya están (el admin puede estar escribiendo un precio).
  const visibles = new Map([...contenedor.children].map((tarjeta) => [tarjeta.dataset.id, tarjeta]));
  const nuevas = pendientes.map((s) => visibles.get(s.id) ?? (s.tipo === 'alta' ? tarjetaAlta(s) : tarjetaBaja(s)));
  contenedor.replaceChildren(...nuevas);
  $('sin-pendientes').hidden = pendientes.length > 0;
  $('cuenta-pendientes').textContent = pendientes.length === 1 ? t('1 pendiente') : t('{n} pendientes', { n: pendientes.length });

  const resueltas = lista.filter((s) => s.estado !== 'pendiente')
    .sort((a, b) => (b.resueltaEn?.toMillis?.() ?? Date.now()) - (a.resueltaEn?.toMillis?.() ?? Date.now()))
    .slice(0, 50);
  $('tabla-resueltas').tBodies[0].replaceChildren(...resueltas.map((s) => h('tr', {},
    h('td', { text: cuando(s.resueltaEn) }),
    h('td', { text: s.creadaPorNombre }),
    h('td', { text: s.tipo === 'alta' ? t('Alta') : t('Baja') }),
    h('td', { text: s.productoNombre }),
    h('td', {}, s.estado === 'aprobada' ? chip(s.tipo === 'alta' ? t('Agregado') : t('Quitado'), 'abierto') : chip(t('Rechazada'), 'neutro'),
      h('span', { class: 'secundario', text: ' ' + t('por {nombre}', { nombre: nombreDeUsuario(s.resueltaPor) }) })),
    h('td', { text: s.nota ?? '' }))));
  $('sin-resueltas').hidden = resueltas.length > 0;
  $('contenido').hidden = false;
}

observarTodas(pintar, (error) => {
  mostrarMensaje(mensaje, 'error', t('No se pudieron cargar las solicitudes: {error}', { error: mensajeError(error) }));
  $('contenido').hidden = false;
});
