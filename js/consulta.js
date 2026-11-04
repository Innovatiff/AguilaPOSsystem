/**
 * Consulta de precios (/caja/consulta.html), para todo el personal: en el
 * teléfono con la cámara, o en una computadora con el escáner USB (escribe
 * como teclado). Solo lectura. Tiene su propia sesión de Firebase, aparte de
 * la caja y del back office. Se entra con el correo y el NIP de 6 dígitos; el
 * NIP lo cambia un administrador (Empleados), porque en la caja identifica a
 * la persona y no puede repetirse.
 */
import { iniciarSesion, usuarioActual, fichaEfectiva, cerrarSesionSilenciosa, mensajeError } from './auth.js';
import { observarCatalogo, buscarPorUPC } from './productos.js';
import { coincideBusqueda } from './esquema.js';
import { normalizarUPC, tipoDeCodigo } from './upca.js';
import { formatearPrecio, indicadorFiscal } from './precios.js';
import { interpretarCodigoBalanza } from './ticket.js';
import { camaraDisponible, abrirEscaner, mensajeCamara, confirmarLectura } from './escaner.js';
import { h } from './dom.js';

const $ = (id) => document.getElementById(id);
const MAXIMO_RESULTADOS = 40;

let personal = null;
let catalogo = new Map();
let catalogoListo = false;
let dejarCatalogo = null;
let productoMostrado = null; // id del producto de la ficha en pantalla

// ------------------------------------------------------------- sesión

function mostrarAcceso(mensaje = null) {
  dejarCatalogo?.();
  dejarCatalogo = null;
  personal = null;
  $('cargando').hidden = true;
  $('vista-consulta').hidden = true;
  $('form-acceso').hidden = false;
  $('usuario').hidden = true;
  $('btn-salir').hidden = true;
  const m = $('mensaje-acceso');
  m.hidden = !mensaje;
  m.textContent = mensaje ?? '';
  m.className = 'mensaje mensaje--error';
  $('nip').value = '';
  $('correo').focus();
}

function mostrarConsulta() {
  $('cargando').hidden = true;
  $('form-acceso').hidden = true;
  $('vista-consulta').hidden = false;
  $('usuario').hidden = false;
  $('usuario').textContent = personal.nombre;
  $('btn-salir').hidden = false;
  $('btn-camara').hidden = !camaraDisponible();
  $('estado-catalogo').textContent = 'Cargando el catálogo…';
  dejarCatalogo = observarCatalogo(({ catalogo: actual, desdeCache }) => {
    catalogo = actual;
    if (!desdeCache || actual.size > 0) catalogoListo = true;
    const activos = [...actual.values()].filter((p) => p.activo).length;
    $('estado-catalogo').textContent = desdeCache
      ? `Sin conexión: ${activos.toLocaleString('en-CA')} productos guardados en este equipo`
      : `Catálogo al día · ${activos.toLocaleString('en-CA')} productos`;
    // Si cambia el producto que está en pantalla (precio, nombre…), la ficha se
    // actualiza sola; si no hay ficha, la lista de resultados se vuelve a pintar.
    if (!$('tarjeta').hidden && productoMostrado) {
      const actualizado = actual.get(productoMostrado);
      if (actualizado) mostrarProducto(actualizado, { desplazar: false });
    } else if ($('buscar').value.trim()) {
      pintarResultados();
    }
  }, (error) => {
    $('estado-catalogo').textContent = `No se pudo cargar el catálogo: ${mensajeError(error)}`;
  });
  if (!window.matchMedia('(pointer: coarse)').matches) $('buscar').focus();
}

$('form-acceso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = $('btn-entrar');
  boton.disabled = true;
  boton.textContent = 'Entrando…';
  try {
    ({ personal } = await iniciarSesion($('correo').value, $('nip').value));
    mostrarConsulta();
  } catch (error) {
    const codigo = String(error?.code ?? '');
    mostrarAcceso(['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(codigo)
      ? 'Correo o NIP incorrectos.'
      : mensajeError(error));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

$('btn-salir').addEventListener('click', async () => {
  await cerrarSesionSilenciosa().catch(() => {});
  mostrarAcceso();
});

// ------------------------------------------------------------- búsqueda

/** Entre varios productos con el mismo código: el activo y de la tienda de quien consulta. */
function preferido(lista) {
  if (!lista.length) return null;
  const tienda = personal?.tienda;
  const deTienda = (p) => !p.tiendas?.length || !tienda || p.tiendas.includes(tienda);
  return [...lista].sort((a, b) => (a.activo === false) - (b.activo === false) || deTienda(b) - deTienda(a))[0];
}

async function porCodigo(texto) {
  const limpio = texto.replace(/\s+/g, '');
  if (/^\d{4,5}$/.test(limpio)) return preferido([...catalogo.values()].filter((p) => p.plu === limpio));
  let upc;
  try {
    upc = normalizarUPC(limpio);
  } catch {
    return null;
  }
  let encontrado = preferido([...catalogo.values()].filter((p) => p.upc === upc));
  if (!encontrado && !catalogoListo) encontrado = preferido(await buscarPorUPC(upc).catch(() => []));
  if (!encontrado) {
    const balanza = interpretarCodigoBalanza(upc);
    for (const plu of balanza?.plus ?? []) {
      encontrado = preferido([...catalogo.values()].filter((p) => p.plu === plu));
      if (encontrado) break;
    }
  }
  return encontrado;
}

function buscarTexto(texto) {
  const lista = [...catalogo.values()].filter((p) => coincideBusqueda(p, texto));
  return lista.sort((a, b) => (a.activo === false) - (b.activo === false) || String(a.nombre).localeCompare(String(b.nombre), 'es')).slice(0, MAXIMO_RESULTADOS);
}

const precioDe = (p) => (p.unidadVenta === 'peso' ? `${formatearPrecio(p.precioPorKgCentavos ?? 0)}/kg` : formatearPrecio(p.precioCentavos ?? 0));

function pintarResultados() {
  const texto = $('buscar').value.trim();
  const lista = texto.length >= 2 && !/^\d{6,}$/.test(texto) ? buscarTexto(texto) : [];
  $('resultados').replaceChildren(...lista.map((p) => h('li', null, h('button', { type: 'button', dataset: { id: p.id } },
    h('span', { class: 'consulta__nombre' }, [p.marca, p.nombre].filter(Boolean).join(' '), p.activo === false ? h('span', { class: 'chip chip--aviso', text: 'Inactivo' }) : null),
    h('small', { text: [p.presentacion, p.upc ?? (p.plu ? `PLU ${p.plu}` : '')].filter(Boolean).join(' · ') || ' ' }),
    h('strong', { text: precioDe(p) })))));
}

function mostrarProducto(p, { desplazar = true } = {}) {
  productoMostrado = p.id ?? null;
  $('no-encontrado').hidden = true;
  const porPeso = p.unidadVenta === 'peso';
  $('t-nombre').textContent = [p.marca, p.nombre].filter(Boolean).join(' ');
  $('t-sub').textContent = [p.presentacion, p.descriptor].filter(Boolean).join(' · ') || ' ';
  $('t-precio').textContent = formatearPrecio((porPeso ? p.precioPorKgCentavos : p.precioCentavos) ?? 0);
  $('t-unidad').textContent = porPeso ? 'por kg' : 'c/u';
  $('t-fiscal').textContent = p.claseFiscal === 'gravado' ? `${indicadorFiscal(p.claseFiscal)} · se le suma el HST al cobrar` : 'Sin impuesto';
  $('t-inactivo').hidden = p.activo !== false;
  const datos = [];
  if (p.upc) {
    let tipo = '';
    try {
      tipo = ` · ${tipoDeCodigo(p.upc)}`;
    } catch {
      tipo = '';
    }
    datos.push(['Código', `${p.upc}${tipo}`]);
  }
  if (p.plu) datos.push(['PLU', p.plu]);
  if (porPeso && p.precioCentavos) datos.push(['Etiqueta de referencia', formatearPrecio(p.precioCentavos)]);
  $('t-datos').replaceChildren(...datos.flatMap(([dt, dd]) => [h('dt', { text: dt }), h('dd', { text: dd })]));
  $('tarjeta').hidden = false;
  $('resultados').replaceChildren();
  if (desplazar) $('tarjeta').scrollIntoView({ block: 'nearest' });
}

function noEncontrado(texto) {
  productoMostrado = null;
  $('tarjeta').hidden = true;
  $('no-encontrado').hidden = false;
  $('no-encontrado').textContent = `No hay ningún producto con «${texto}». Avisa al administrador.`;
}

async function consultar(texto) {
  const limpio = String(texto ?? '').trim();
  if (!limpio) return;
  if (/^\d+$/.test(limpio)) {
    const encontrado = await porCodigo(limpio);
    if (encontrado) mostrarProducto(encontrado);
    else noEncontrado(limpio);
    return;
  }
  const lista = buscarTexto(limpio);
  if (lista.length === 1) mostrarProducto(lista[0]);
  else if (lista.length === 0) noEncontrado(limpio);
  else pintarResultados();
}

$('buscar').addEventListener('input', () => {
  $('no-encontrado').hidden = true;
  if ($('buscar').value.trim().length >= 2) $('tarjeta').hidden = true;
  pintarResultados();
});
$('form-buscar').addEventListener('submit', async (e) => {
  e.preventDefault();
  await consultar($('buscar').value);
  $('buscar').select();
});
$('resultados').addEventListener('click', (e) => {
  const boton = e.target.closest('button[data-id]');
  const producto = boton && catalogo.get(boton.dataset.id);
  if (producto) mostrarProducto(producto);
});

// ------------------------------------------------------------- cámara

const escaner = $('escaner');
const estadoCamara = { controles: null, abriendo: false, linterna: false };

function estadoDelEscaner(texto, tipo = '') {
  $('escaner-estado').textContent = texto;
  $('escaner-estado').className = `escaner__estado${tipo ? ` escaner__estado--${tipo}` : ''}`;
}

$('btn-camara').addEventListener('click', async () => {
  if (estadoCamara.abriendo) return;
  estadoCamara.abriendo = true;
  $('escaner-linterna').hidden = true;
  estadoDelEscaner('Iniciando cámara…');
  if (!escaner.open) escaner.showModal();
  try {
    estadoCamara.controles = await abrirEscaner($('escaner-video'), {
      alDetectar: async ({ texto }) => {
        estadoCamara.controles?.pausar();
        confirmarLectura();
        const encontrado = await porCodigo(texto);
        escaner.close();
        $('buscar').value = texto;
        if (encontrado) mostrarProducto(encontrado);
        else noEncontrado(texto);
      },
      alError: (error) => estadoDelEscaner(mensajeCamara(error), 'error'),
    });
    estadoDelEscaner('Apunta al código de barras');
    $('escaner-linterna').hidden = !estadoCamara.controles.tieneLinterna;
  } catch (error) {
    estadoDelEscaner(mensajeCamara(error), 'error');
  } finally {
    estadoCamara.abriendo = false;
  }
});

$('escaner-cerrar').addEventListener('click', () => escaner.close());
escaner.addEventListener('close', () => {
  estadoCamara.controles?.detener();
  estadoCamara.controles = null;
  estadoCamara.linterna = false;
  $('escaner-linterna').setAttribute('aria-pressed', 'false');
});
$('escaner-linterna').addEventListener('click', async () => {
  estadoCamara.linterna = !estadoCamara.linterna;
  const ok = await estadoCamara.controles?.linterna(estadoCamara.linterna);
  $('escaner-linterna').setAttribute('aria-pressed', String(!!ok && estadoCamara.linterna));
});

// ------------------------------------------------------------- arranque

const usuario = await usuarioActual();
if (usuario) {
  try {
    personal = await fichaEfectiva(usuario);
    mostrarConsulta();
  } catch (error) {
    if (String(error?.code ?? '').startsWith('catalogo/')) await cerrarSesionSilenciosa().catch(() => {});
    mostrarAcceso(String(error?.code ?? '').startsWith('catalogo/') ? mensajeError(error) : null);
  }
} else {
  mostrarAcceso();
}
