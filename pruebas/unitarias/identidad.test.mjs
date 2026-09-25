import assert from 'node:assert/strict';
import {
  DOMINIO_CODIGOS, normalizarIdentificador, esCodigo, esCorreo, tipoDeIdentificador, correoDeAcceso, usuarioDe, versionDe,
  esCorreoDeCodigo, validarCodigo, validarNIP, validarContrasena, siguienteCodigo, etiquetaUsuario, armarFichaPersonal, validarFichaPersonal,
} from '../../js/identidad.js';

describe('identidad · códigos y correos', () => {
  it('reconoce códigos de 3 a 8 dígitos y correos reales', () => {
    assert.equal(tipoDeIdentificador('1023'), 'codigo');
    assert.equal(tipoDeIdentificador(' 10 23 '), 'codigo');
    assert.equal(tipoDeIdentificador('12'), null);
    assert.equal(tipoDeIdentificador('123456789'), null);
    assert.equal(tipoDeIdentificador('Alan@Ejemplo.com'), 'correo');
    assert.equal(tipoDeIdentificador('sin-arroba'), null);
    assert.ok(esCodigo('007'));
    assert.ok(!esCorreo(`1023@${DOMINIO_CODIGOS}`), 'un correo sintético no cuenta como correo real');
  });
  it('normaliza: correos en minúsculas, códigos sin espacios', () => {
    assert.equal(normalizarIdentificador('  Alan@Ejemplo.COM '), 'alan@ejemplo.com');
    assert.equal(normalizarIdentificador('1 0 2 3'), '1023');
  });
  it('el correo de acceso de un código es sintético y versionado; el de un correo es él mismo', () => {
    assert.equal(correoDeAcceso('1023'), `1023@${DOMINIO_CODIGOS}`);
    assert.equal(correoDeAcceso('1023', 1), `1023@${DOMINIO_CODIGOS}`);
    assert.equal(correoDeAcceso('1023', 3), `1023.3@${DOMINIO_CODIGOS}`);
    assert.equal(correoDeAcceso('Alan@Ejemplo.com'), 'alan@ejemplo.com');
    assert.throws(() => correoDeAcceso('12'), /código de empleado/);
    assert.throws(() => correoDeAcceso('1023', 0), /Versión/);
  });
  it('usuarioDe deshace el mapeo, con o sin versión, y deja los correos reales intactos', () => {
    assert.equal(usuarioDe(`1023@${DOMINIO_CODIGOS}`), '1023');
    assert.equal(usuarioDe(`1023.7@${DOMINIO_CODIGOS}`), '1023');
    assert.equal(usuarioDe('Alan.F@Ejemplo.com'), 'alan.f@ejemplo.com');
    assert.equal(versionDe(`1023@${DOMINIO_CODIGOS}`), 1);
    assert.equal(versionDe(`1023.7@${DOMINIO_CODIGOS}`), 7);
    assert.equal(versionDe('alan@ejemplo.com'), 1);
    assert.ok(esCorreoDeCodigo(`1023@${DOMINIO_CODIGOS}`));
    assert.ok(!esCorreoDeCodigo('1023@otro.com'));
  });
});

describe('identidad · validación', () => {
  it('códigos', () => {
    assert.equal(validarCodigo('1023'), null);
    assert.match(validarCodigo(''), /Escribe/);
    assert.match(validarCodigo('12'), /3 a 8/);
    assert.match(validarCodigo('a123'), /3 a 8/);
  });
  it('NIP: 6 a 10 dígitos, ni repetido ni secuencia', () => {
    assert.equal(validarNIP('482913'), null);
    assert.equal(validarNIP('4829130071'), null);
    assert.match(validarNIP('12345'), /6 a 10/);
    assert.match(validarNIP('12345678901'), /6 a 10/);
    assert.match(validarNIP('12a456'), /6 a 10/);
    assert.match(validarNIP('111111'), /repetido/);
    assert.match(validarNIP('123456'), /secuencia/);
    assert.match(validarNIP('654321'), /secuencia/);
    assert.match(validarNIP('0123456'), /secuencia/);
  });
  it('contraseñas de al menos 8 caracteres', () => {
    assert.equal(validarContrasena('abcdefgh'), null);
    assert.match(validarContrasena('abc'), /8 caracteres/);
  });
  it('sugiere el siguiente código libre', () => {
    assert.equal(siguienteCodigo([]), '1001');
    assert.equal(siguienteCodigo(['1001', '1002', 'alan@ejemplo.com']), '1003');
    assert.equal(siguienteCodigo(['007']), '1001');
    assert.equal(siguienteCodigo(['20999']), '21000');
  });
  it('etiqueta de usuario para mostrar', () => {
    assert.equal(etiquetaUsuario('1023', 'María'), 'María (1023)');
    assert.equal(etiquetaUsuario('1023', ''), '1023');
    assert.equal(etiquetaUsuario('alan@ejemplo.com', 'alan@ejemplo.com'), 'alan@ejemplo.com');
  });
});

describe('identidad · ficha de personal', () => {
  it('arma una ficha de código con su correo sintético', () => {
    const ficha = armarFichaPersonal({ usuario: ' 1023 ', nombre: ' María ', rol: 'empleado', tienda: 'talbot' }, 'admin@aguila.test');
    assert.deepEqual(ficha, {
      usuario: '1023', tipo: 'codigo', correoAuth: `1023@${DOMINIO_CODIGOS}`, nombre: 'María', rol: 'empleado', activo: true, tienda: 'talbot',
      actualizadoPor: 'admin@aguila.test', cuentaVersion: 1,
    });
    assert.deepEqual(validarFichaPersonal(ficha), []);
  });
  it('arma una ficha de correo y una de código con versión', () => {
    const correo = armarFichaPersonal({ usuario: 'Gerente@Aguila.test', nombre: 'Gerente', rol: 'admin', tienda: '' }, '1001');
    assert.equal(correo.tipo, 'correo');
    assert.equal(correo.correoAuth, 'gerente@aguila.test');
    assert.equal(correo.tienda, null);
    assert.deepEqual(validarFichaPersonal(correo), []);
    const renovada = armarFichaPersonal({ usuario: '1023', nombre: 'María', rol: 'empleado', cuentaVersion: 2 }, '1001');
    assert.equal(renovada.correoAuth, `1023.2@${DOMINIO_CODIGOS}`);
    assert.deepEqual(validarFichaPersonal(renovada), []);
  });
  it('detecta incoherencias', () => {
    const base = armarFichaPersonal({ usuario: '1023', nombre: 'María', rol: 'empleado' }, '1001');
    assert.ok(validarFichaPersonal({ ...base, correoAuth: `1024@${DOMINIO_CODIGOS}` }).some((e) => /no corresponde/.test(e)));
    assert.ok(validarFichaPersonal({ ...base, rol: 'jefe' }).some((e) => /rol/.test(e)));
    assert.ok(validarFichaPersonal({ ...base, tienda: 'Talbot St' }).some((e) => /tienda/.test(e)));
    assert.ok(validarFichaPersonal({ ...base, nombre: '' }).some((e) => /nombre/.test(e)));
    const correo = armarFichaPersonal({ usuario: 'gerente@aguila.test', nombre: 'G', rol: 'admin' }, '1001');
    assert.ok(validarFichaPersonal({ ...correo, cuentaVersion: 2 }).some((e) => /versión/.test(e)));
  });
});
