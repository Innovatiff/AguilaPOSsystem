/**
 * App Catálogo · Mis solicitudes: altas y bajas que pidió la persona, con su
 * estado (pendiente, agregado, quitado o rechazada, con la nota del admin).
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { chip, mostrarMensaje, fechaCorta, hora } from './bo.js';
import { observarMisSolicitudes } from './solicitudes.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'catalogo/solicitudes.html' });

const $ = (id) => document.getElementById(id);
const cuando = (marca) => (marca?.toMillis ? `${fechaCorta(marca)}, ${hora(marca)}` : 'enviando…');

function estadoDe(s) {
  if (s.estado === 'pendiente') return chip('Pendiente', 'aviso');
  if (s.estado === 'rechazada') return chip('Rechazada', 'neutro');
  return chip(s.tipo === 'alta' ? 'Agregado al catálogo' : 'Quitado del catálogo', 'abierto');
}

observarMisSolicitudes(personal.usuario, (lista) => {
  $('tabla-mias').tBodies[0].replaceChildren(...lista.map((s) => h('tr', {},
    h('td', { text: cuando(s.creadaEn) }),
    h('td', { text: s.tipo === 'alta' ? 'Alta (producto nuevo)' : 'Baja (quitar)' }),
    h('td', {}, h('strong', { text: s.productoNombre }), s.producto?.upc ? h('span', { class: 'secundario monoespaciada', text: s.producto.upc }) : null),
    h('td', {}, estadoDe(s)),
    h('td', { text: s.nota ?? (s.estado === 'pendiente' && s.tipo === 'alta' ? 'Falta el precio del administrador' : '') }))));
  $('sin-solicitudes').hidden = lista.length > 0;
  $('contenido').hidden = false;
}, (error) => {
  mostrarMensaje($('mensaje'), 'error', `No se pudieron cargar tus solicitudes: ${mensajeError(error)}`);
  $('contenido').hidden = false;
});
