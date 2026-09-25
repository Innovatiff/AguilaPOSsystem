/**
 * Barra de navegación (gris oscuro) de las dos apps: Catálogo y Gestión.
 * En pantallas angostas las secciones y el usuario se pliegan tras un botón de menú.
 */
import { cerrarSesion, RAIZ } from './auth.js';

const SECCIONES = {
  catalogo: [
    { href: 'index.html', texto: 'Inicio' },
    { href: 'productos.html', texto: 'Productos' },
    { href: 'captura.html', texto: 'Captura rápida' },
    { href: 'imprimir.html', texto: 'Imprimir etiquetas' },
    { href: 'prueba-etiquetas.html', texto: 'Prueba de etiquetas' },
    { href: 'gestion/index.html', texto: 'Gestión', soloAdmin: true, destacada: true },
  ],
  gestion: [
    { href: 'gestion/index.html', texto: 'Resumen' },
    { href: 'gestion/empleados.html', texto: 'Empleados' },
    { href: 'gestion/tiendas.html', texto: 'Tiendas' },
    { href: 'gestion/datos.html', texto: 'Importar / exportar' },
    { href: 'index.html', texto: 'Catálogo', destacada: true },
  ],
};

const MARCA = {
  catalogo: { href: 'index.html', texto: 'Catálogo Águila' },
  gestion: { href: 'gestion/index.html', texto: 'Águila Gestión' },
};

const NOMBRE_ROL = { admin: 'administrador', empleado: 'empleado' };

function enlace(href, texto, clase) {
  const a = document.createElement('a');
  a.href = RAIZ + href;
  a.textContent = texto;
  if (clase) a.className = clase;
  return a;
}

/**
 * @param {{ personal: {nombre: string, rol: string, usuario: string, tipo?: string}, activa: string, app?: 'catalogo'|'gestion' }} opciones
 *   `activa` es la página relativa a la raíz ("productos.html", "gestion/empleados.html").
 */
export function pintarNavegacion({ personal, activa, app = 'catalogo' }) {
  const encabezado = document.getElementById('navegacion');
  if (!encabezado) return;
  encabezado.replaceChildren();
  encabezado.classList.toggle('encabezado--gestion', app === 'gestion');

  const marca = enlace(MARCA[app].href, MARCA[app].texto, 'marca');

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
  for (const seccion of SECCIONES[app]) {
    if (seccion.soloAdmin && personal.rol !== 'admin') continue;
    const a = enlace(seccion.href, seccion.texto, seccion.destacada ? 'destacada' : '');
    if (seccion.href === activa) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }

  const usuario = document.createElement('div');
  usuario.className = 'usuario';
  const cuenta = enlace('cuenta.html', `${personal.nombre} · ${NOMBRE_ROL[personal.rol] ?? personal.rol}`, 'usuario__nombre');
  cuenta.title = `${personal.tipo === 'codigo' ? 'Código ' : ''}${personal.usuario} · Mi cuenta`;
  if (activa === 'cuenta.html') cuenta.setAttribute('aria-current', 'page');
  const salir = document.createElement('button');
  salir.type = 'button';
  salir.className = 'boton boton--secundario';
  salir.textContent = 'Cerrar sesión';
  salir.addEventListener('click', () => cerrarSesion());
  usuario.append(cuenta, salir);

  panel.append(nav, usuario);

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
