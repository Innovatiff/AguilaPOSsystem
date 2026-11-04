/**
 * Navegación del back office (solo administradores) y de la app Catálogo del
 * personal: barra lateral con las secciones agrupadas en pantallas anchas; en
 * pantallas angostas, una barra superior con un botón de menú que despliega
 * las mismas secciones. La app Catálogo solo enlaza sus propias páginas:
 * desde ella no se llega al back office.
 */
import { cerrarSesion, RAIZ, EN_CATALOGO, paginaActual } from './auth.js';
import { db, collection, query, where, onSnapshot } from './firebase.js';

/** Trazos de los íconos (24 × 24, línea de 2 px). */
const ICONOS = {
  inicio: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  ventas: 'M4 4h2l2.4 11h9.2L20 7H7.2M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  turnos: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  reportes: 'M5 20V10M12 20V4M19 20v-7',
  productos: 'M3 7l9-4 9 4-9 4zm0 0v10l9 4 9-4V7M12 11v10',
  captura: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8',
  etiquetas: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  prueba: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3',
  datos: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  empleados: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.87M15.5 4.13a3.5 3.5 0 0 1 0 6.75',
  cajas: 'M3 10h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM6 10l2-6h8l2 6M9 15h6',
  tiendas: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6',
  configuracion: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  caja: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  solicitudes: 'M4 13h4l2 3h4l2-3h4M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
};

/** Secciones del back office, en grupos. */
const GRUPOS = [
  { titulo: null, secciones: [{ href: 'index.html', texto: 'Inicio', icono: 'inicio' }] },
  {
    titulo: 'Ventas',
    secciones: [
      { href: 'ventas.html', texto: 'Ventas', icono: 'ventas' },
      { href: 'turnos.html', texto: 'Turnos', icono: 'turnos' },
      { href: 'reportes.html', texto: 'Reportes', icono: 'reportes' },
    ],
  },
  {
    titulo: 'Catálogo',
    secciones: [
      { href: 'productos.html', texto: 'Productos', icono: 'productos' },
      { href: 'solicitudes.html', texto: 'Solicitudes', icono: 'solicitudes', contador: true },
      { href: 'captura.html', texto: 'Captura rápida', icono: 'captura' },
      { href: 'imprimir.html', texto: 'Etiquetas', icono: 'etiquetas' },
      { href: 'prueba-etiquetas.html', texto: 'Prueba de etiquetas', icono: 'prueba' },
      { href: 'gestion/datos.html', texto: 'Importar / exportar', icono: 'datos' },
    ],
  },
  {
    titulo: 'Administración',
    secciones: [
      { href: 'gestion/empleados.html', texto: 'Empleados', icono: 'empleados' },
      { href: 'gestion/cajas.html', texto: 'Cajas', icono: 'cajas' },
      { href: 'gestion/tiendas.html', texto: 'Tiendas', icono: 'tiendas' },
      { href: 'gestion/configuracion.html', texto: 'Configuración', icono: 'configuracion' },
    ],
  },
];

/** Secciones de la app Catálogo del personal (/catalogo/). */
const GRUPOS_CATALOGO = [
  {
    titulo: 'Catálogo',
    secciones: [
      { href: 'catalogo/index.html', texto: 'Productos', icono: 'productos' },
      { href: 'catalogo/captura.html', texto: 'Captura rápida', icono: 'captura' },
      { href: 'catalogo/etiquetas.html', texto: 'Etiquetas', icono: 'etiquetas' },
      { href: 'catalogo/solicitudes.html', texto: 'Mis solicitudes', icono: 'solicitudes' },
    ],
  },
];

const NOMBRE_ROL = { admin: 'Administrador', empleado: 'Empleado' };
const SVG = 'http://www.w3.org/2000/svg';

function icono(nombre) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'nav-icono');
  svg.setAttribute('aria-hidden', 'true');
  const trazo = document.createElementNS(SVG, 'path');
  trazo.setAttribute('d', ICONOS[nombre] ?? '');
  svg.append(trazo);
  return svg;
}

function enlace(href, texto, clase, nombreIcono) {
  const a = document.createElement('a');
  a.href = RAIZ + href;
  if (clase) a.className = clase;
  if (nombreIcono) a.append(icono(nombreIcono));
  a.append(Object.assign(document.createElement('span'), { textContent: texto }));
  return a;
}

/**
 * @param {{ personal: {nombre: string, rol: string, usuario: string, tipo?: string}, activa: string }} opciones
 *   `activa` es la página relativa a la raíz ("productos.html", "gestion/empleados.html").
 */
export function pintarNavegacion({ personal, activa }) {
  const encabezado = document.getElementById('navegacion');
  if (!encabezado) return;
  document.body.classList.add('con-lateral');
  encabezado.replaceChildren();

  const marca = document.createElement('a');
  marca.href = `${RAIZ}${EN_CATALOGO ? 'catalogo/index.html' : 'index.html'}`;
  marca.className = 'marca';
  marca.append(
    Object.assign(document.createElement('span'), { className: 'marca__logo' }),
    Object.assign(document.createElement('span'), { className: 'marca__texto', textContent: 'Águila POS' }),
    Object.assign(document.createElement('span'), { className: 'marca__sub', textContent: EN_CATALOGO ? 'Catálogo' : 'Back office' }),
  );
  // En el Catálogo las pantallas compartidas pasan el nombre del back office: manda la página real.
  const actual = EN_CATALOGO ? paginaActual().split('?')[0] : activa;

  const botonMenu = document.createElement('button');
  botonMenu.type = 'button';
  botonMenu.className = 'menu-boton';
  botonMenu.setAttribute('aria-label', 'Abrir menú');
  botonMenu.setAttribute('aria-expanded', 'false');
  botonMenu.setAttribute('aria-controls', 'panel-navegacion');
  for (let i = 0; i < 3; i += 1) botonMenu.append(Object.assign(document.createElement('span'), { className: 'menu-boton__barra' }));

  const panel = document.createElement('div');
  panel.className = 'encabezado__panel';
  panel.id = 'panel-navegacion';

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Secciones');
  for (const grupo of EN_CATALOGO ? GRUPOS_CATALOGO : GRUPOS) {
    const bloque = document.createElement('div');
    bloque.className = 'nav-grupo';
    if (grupo.titulo) bloque.append(Object.assign(document.createElement('div'), { className: 'nav-grupo__titulo', textContent: grupo.titulo }));
    for (const seccion of grupo.secciones) {
      const a = enlace(seccion.href, seccion.texto, '', seccion.icono);
      if (seccion.href === actual) a.setAttribute('aria-current', 'page');
      if (seccion.contador) contarPendientes(a);
      bloque.append(a);
    }
    nav.append(bloque);
  }

  const caja = EN_CATALOGO ? null : enlace('caja/', 'Abrir la caja', 'nav-caja', 'caja');
  if (caja) caja.title = 'La caja registradora (para vender)';

  const usuario = document.createElement('div');
  usuario.className = 'usuario';
  const cuenta = document.createElement(EN_CATALOGO ? 'div' : 'a');
  if (!EN_CATALOGO) cuenta.href = `${RAIZ}cuenta.html`;
  cuenta.className = 'usuario__nombre';
  cuenta.append(
    Object.assign(document.createElement('strong'), { textContent: personal.nombre }),
    Object.assign(document.createElement('span'), { textContent: EN_CATALOGO ? (personal.correo ?? NOMBRE_ROL[personal.rol] ?? '') : `${NOMBRE_ROL[personal.rol] ?? personal.rol} · Mi cuenta` }),
  );
  if (!EN_CATALOGO) cuenta.title = `${personal.tipo === 'codigo' ? 'Nº ' : ''}${personal.usuario}`;
  if (actual === 'cuenta.html') cuenta.setAttribute('aria-current', 'page');
  const salir = document.createElement('button');
  salir.type = 'button';
  salir.className = 'boton boton--secundario';
  salir.textContent = 'Cerrar sesión';
  salir.addEventListener('click', () => cerrarSesion());
  usuario.append(cuenta, salir);

  panel.append(...[nav, caja, usuario].filter(Boolean));

  const fijarAbierto = (abierto) => {
    encabezado.classList.toggle('encabezado--abierto', abierto);
    botonMenu.setAttribute('aria-expanded', String(abierto));
    botonMenu.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  };
  botonMenu.addEventListener('click', () => fijarAbierto(!encabezado.classList.contains('encabezado--abierto')));
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && encabezado.classList.contains('encabezado--abierto')) {
      fijarAbierto(false);
      botonMenu.focus();
    }
  });

  encabezado.append(marca, botonMenu, panel);
}

/** Insignia con las solicitudes del Catálogo pendientes (back office). */
function contarPendientes(enlaceSolicitudes) {
  const insignia = Object.assign(document.createElement('span'), { className: 'nav-insignia', hidden: true });
  insignia.setAttribute('aria-label', 'pendientes');
  enlaceSolicitudes.append(insignia);
  onSnapshot(
    query(collection(db, 'solicitudes'), where('estado', '==', 'pendiente')),
    (resultado) => {
      insignia.hidden = resultado.size === 0;
      insignia.textContent = String(resultado.size);
      insignia.setAttribute('aria-label', `${resultado.size} pendientes`);
    },
    () => { insignia.hidden = true; },
  );
}
