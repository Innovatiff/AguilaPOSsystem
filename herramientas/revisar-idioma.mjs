// Revisa que todo lo que ve el usuario tenga su traducción al inglés.
//   node herramientas/revisar-idioma.mjs            → todo el sitio
//   node herramientas/revisar-idioma.mjs js/caja.js caja/index.html   → solo esos archivos
// Busca:
//   - las claves de t('…') y tc('contexto', '…') del código sin traducción;
//   - los textos y atributos (placeholder, title, aria-label, alt) de las
//     páginas sin traducción (lo marcado con data-sin-traducir no cuenta);
//   - traducciones con otros {valores} que su clave;
//   - una misma clave traducida distinto en dos áreas (js/i18n/en-*.js);
//   - y, como aviso, textos en español del código que no pasan por t().
// Sale con error si hay algo de lo primero. pruebas/unitarias/idioma.test.mjs lo usa.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/** Textos que no se traducen: marcas, siglas y símbolos. */
export const SIN_TRADUCCION = new Set([
  'Águila POS', 'Águila', 'POS', 'Águila Marketplace', 'Águila Catálogo', 'PLU', 'UPC', 'HST', 'CSV', 'kg', 'NIP', 'OK',
  'Moneris', 'Netlify', 'Firebase', 'Chrome', 'Edge', 'BestPOS', 'Code 128', 'EAN-13', 'UPC-A', 'UPC-E', 'Tx', '+Tx', 'T',
  '×', '—', '–', '·', '/', '%', '$', '#', '…', '+', '-', '−', '=', '?', '¿', '¡', ':', 'A', 'B', 'C', 'D', 'E', 'X', 'Z', '←', '→', '↑', '↓', '⌫', 'C',
  'Esc', 'Enter', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Supr', 'Ctrl', 'Alt', 'Tab',
]);
const VACIOS = (texto) => !/\p{L}/u.test(texto) || SIN_TRADUCCION.has(texto);

const juntar = (texto) => texto.replace(/\s+/g, ' ').trim();

function decodificar(texto) {
  return texto
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Literal de JavaScript → texto (comillas simples, dobles o invertidas sin ${}). */
function desescapar(cuerpo) {
  return cuerpo.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, s) => {
    if (s[0] === 'u') return String.fromCodePoint(parseInt(s.replace(/[u{}]/g, ''), 16));
    if (s[0] === 'x') return String.fromCharCode(parseInt(s.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[s] ?? s;
  });
}

const LITERAL = String.raw`(['"\x60])((?:\\[\s\S]|(?!\1)[^\\])*)\1`;
// t() o su alias tx() (en archivos que ya usan «t» para otra cosa, como el ticket en la caja).
const RE_T = new RegExp(String.raw`(?<![\w.$])tx?\(\s*${LITERAL}`, 'g');
const RE_TC = new RegExp(String.raw`(?<![\w.$])tc\(\s*${LITERAL}\s*,\s*${LITERAL.replace('\\1', '\\3')}`, 'g');

/** Claves pedidas en un archivo de código: [{ clave, alternativa?, linea }]. */
export function clavesDeCodigo(codigo) {
  const claves = [];
  const linea = (indice) => codigo.slice(0, indice).split('\n').length;
  for (const m of codigo.matchAll(RE_T)) {
    if (m[1] === '`' && m[2].includes('${')) claves.push({ error: 't() con ${…}: usa {valores}', linea: linea(m.index) });
    else claves.push({ clave: desescapar(m[2]), linea: linea(m.index) });
  }
  for (const m of codigo.matchAll(RE_TC)) {
    const texto = desescapar(m[4]);
    claves.push({ clave: `${desescapar(m[2])}|${texto}`, alternativa: texto, linea: linea(m.index) });
  }
  return claves;
}

const VACIAS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const OMITIDAS = new Set(['script', 'style', 'svg', 'code', 'pre']);

/** Textos y atributos traducibles de una página: [{ texto, linea }]. */
export function textosDePagina(html) {
  const textos = [];
  const pila = []; // { nombre, omitir }
  const omitiendo = () => pila.some((e) => e.omitir);
  const linea = (indice) => html.slice(0, indice).split('\n').length;
  const sinComentarios = html.replace(/<!--[\s\S]*?-->|<![^>]*>/g, (c) => c.replace(/[^\n]/g, ' '));
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let titulo = false;
  for (const m of sinComentarios.matchAll(re)) {
    if (m[5] !== undefined) {
      if (omitiendo()) continue;
      const texto = juntar(decodificar(m[5]));
      if (!texto || VACIOS(texto)) continue;
      if (titulo) for (const parte of texto.split(' · ').filter((p) => !VACIOS(p))) textos.push({ texto: parte, linea: linea(m.index) });
      else textos.push({ texto, linea: linea(m.index) });
      continue;
    }
    const [, cierre, nombreCrudo, atributos, autocierre] = m;
    const nombre = nombreCrudo.toLowerCase();
    if (cierre) {
      const i = pila.map((e) => e.nombre).lastIndexOf(nombre);
      if (i >= 0) pila.length = i;
      if (nombre === 'title') titulo = false;
      continue;
    }
    const omitir = OMITIDAS.has(nombre) || /\bdata-sin-traducir\b/.test(atributos);
    if (!omitiendo() && !omitir) {
      for (const a of atributos.matchAll(/\b(placeholder|title|aria-label|alt)\s*=\s*"([^"]*)"/g)) {
        const texto = juntar(decodificar(a[2]));
        if (texto && !VACIOS(texto)) textos.push({ texto, linea: linea(m.index) });
      }
    }
    if (nombre === 'title') titulo = true;
    if (!VACIAS.has(nombre) && !autocierre) pila.push({ nombre, omitir });
  }
  return textos;
}

const PALABRAS_ES = /\b(el|la|los|las|de|del|para|con|sin|por|una|un|que|en|es|no|se|su|sus|al|lo|y|o|ya|hay|más|aquí|esta|este|cada|todo|todos)\b/i;

/** Aviso: literales que parecen texto en español y no pasan por t()/tc()/tEs(). */
export function sospechosos(codigoCompleto) {
  const salida = [];
  // Lo que va entre «// i18n:sin-revisar-inicio» y «// i18n:sin-revisar-fin» son datos o plantillas guardadas: no se avisa.
  const codigo = codigoCompleto.replace(/\/\/ i18n:sin-revisar-inicio[\s\S]*?\/\/ i18n:sin-revisar-fin/g, (c) => c.replace(/[^\n]/g, ' '));
  const sinComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (c, previo) => previo + c.slice(previo.length).replace(/[^\n]/g, ' '));
  const re = new RegExp(LITERAL, 'g');
  for (const m of sinComentarios.matchAll(re)) {
    const texto = m[2];
    if (texto.length < 4 || !/\s/.test(texto.trim())) continue;
    if (!(/[áéíóúñ¿¡]/i.test(texto) || PALABRAS_ES.test(texto))) continue;
    const antes = sinComentarios.slice(Math.max(0, m.index - 40), m.index);
    if (/(?<![\w.$])(t|tx|tc|tEs)\(\s*$|tc\(\s*(['"])[^'"]*\2\s*,\s*$/.test(antes)) continue;
    if (/console\.\w+\(\s*$|throw new TypeError\(\s*$|from\s*$|import\(\s*$|querySelector(All)?\(\s*$|closest\(\s*$|matches\(\s*$/.test(antes)) continue;
    salida.push({ texto: texto.slice(0, 90), linea: sinComentarios.slice(0, m.index).split('\n').length });
  }
  return salida;
}

function archivosDelSitio() {
  const js = readdirSync(join(RAIZ, 'js')).filter((n) => n.endsWith('.js') && !['config.js', 'config.example.js'].includes(n)).map((n) => `js/${n}`);
  const html = [
    ...readdirSync(RAIZ).filter((n) => n.endsWith('.html')),
    ...['gestion', 'caja', 'catalogo'].flatMap((c) => readdirSync(join(RAIZ, c)).filter((n) => n.endsWith('.html')).map((n) => `${c}/${n}`)),
  ];
  return [...js, ...html];
}

const valoresDe = (texto) => [...String(texto).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Revisión completa (o de los archivos dados). */
export async function revisar(archivos = archivosDelSitio()) {
  const { EN, AREAS } = await import(pathToFileURL(join(RAIZ, 'js/i18n/en.js')).href);
  const faltan = [];
  const errores = [];
  const avisos = [];
  const usadas = new Set();
  for (const ruta of archivos) {
    const contenido = readFileSync(join(RAIZ, ruta), 'utf8');
    if (ruta.endsWith('.js')) {
      for (const c of clavesDeCodigo(contenido)) {
        if (c.error) {
          errores.push(`${ruta}:${c.linea} ${c.error}`);
          continue;
        }
        usadas.add(c.clave);
        if (c.alternativa) usadas.add(c.alternativa);
        if (!(c.clave in EN) && !(c.alternativa && c.alternativa in EN)) faltan.push(`${ruta}:${c.linea} ${JSON.stringify(c.clave)}`);
      }
      for (const s of sospechosos(contenido)) avisos.push(`${ruta}:${s.linea} ${JSON.stringify(s.texto)}`);
    } else {
      for (const { texto, linea } of textosDePagina(contenido)) {
        usadas.add(texto);
        if (!(texto in EN)) faltan.push(`${ruta}:${linea} ${JSON.stringify(texto)}`);
      }
    }
  }
  for (const [clave, valor] of Object.entries(EN)) {
    if (typeof valor !== 'string' || !valor.trim()) errores.push(`traducción vacía: ${JSON.stringify(clave)}`);
    const sinContexto = clave.includes('|') ? clave.slice(clave.indexOf('|') + 1) : clave;
    if (valoresDe(sinContexto) !== valoresDe(valor)) errores.push(`{valores} distintos: ${JSON.stringify(clave)} → ${JSON.stringify(valor)}`);
  }
  const vistas = new Map();
  for (const [area, dic] of Object.entries(AREAS)) {
    for (const [clave, valor] of Object.entries(dic)) {
      const previa = vistas.get(clave);
      if (previa && previa.valor !== valor) errores.push(`«${clave}» se traduce distinto en ${previa.area} («${previa.valor}») y en ${area} («${valor}»)`);
      else vistas.set(clave, { area, valor });
    }
  }
  const sinUso = Object.keys(EN).filter((k) => !usadas.has(k) && !usadas.has(k.slice(k.indexOf('|') + 1)));
  return { faltan, errores, avisos, sinUso };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentos = process.argv.slice(2).filter((a) => existsSync(join(RAIZ, a)));
  const { faltan, errores, avisos, sinUso } = await revisar(argumentos.length ? argumentos : undefined);
  if (faltan.length) console.log(`\nSin traducción (${faltan.length}):\n${faltan.join('\n')}`);
  if (errores.length) console.log(`\nErrores (${errores.length}):\n${errores.join('\n')}`);
  if (avisos.length) console.log(`\nRevisar: ¿texto en español que no pasa por t()? (${avisos.length}):\n${avisos.join('\n')}`);
  if (!argumentos.length && sinUso.length) console.log(`\nTraducciones que ya no se usan (${sinUso.length}): ${sinUso.slice(0, 40).map((k) => JSON.stringify(k)).join(', ')}`);
  console.log(`\n${faltan.length + errores.length === 0 ? 'Todo traducido.' : 'Falta trabajo.'}`);
  process.exit(faltan.length + errores.length === 0 ? 0 : 1);
}
