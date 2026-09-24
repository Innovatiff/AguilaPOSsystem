/**
 * Avisos flotantes (esquina inferior derecha). Un solo contenedor por página.
 * Duración 0 = permanece hasta cerrarlo.
 */
let contenedor = null;

function asegurarContenedor() {
  if (contenedor && contenedor.isConnected) return contenedor;
  contenedor = document.createElement('div');
  contenedor.className = 'avisos';
  document.body.append(contenedor);
  return contenedor;
}

/**
 * @param {string} texto
 * @param {'ok'|'error'|'info'} [tipo]
 * @param {number} [duracionMs]
 */
export function avisar(texto, tipo = 'ok', duracionMs = 4000) {
  const aviso = document.createElement('div');
  aviso.className = `aviso aviso--${tipo}`;
  aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  const contenido = document.createElement('span');
  contenido.textContent = texto;
  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.className = 'aviso__cerrar';
  cerrar.setAttribute('aria-label', 'Cerrar aviso');
  cerrar.textContent = '×';
  cerrar.addEventListener('click', () => aviso.remove());
  aviso.append(contenido, cerrar);
  asegurarContenedor().append(aviso);
  if (duracionMs > 0) setTimeout(() => aviso.remove(), duracionMs);
  return aviso;
}
