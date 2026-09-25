// backend/src/lib/errores.js
// Respuestas de error de la API.
//   - ErrorNegocio: situaciones esperables con un mensaje para el usuario
//     ("La cuenta no tiene CUIT cargado", "ARCA rechazó el comprobante…").
//     Se responden tal cual, con su código HTTP.
//   - Errores de validación de MySQL (campo obligatorio vacío, valor
//     duplicado o demasiado largo…): se traducen a un mensaje entendible.
//   - Cualquier otro error: el detalle técnico queda SOLO en el log del
//     servidor, junto a un código de referencia; el navegador recibe un
//     mensaje genérico con ese código (nunca nombres de tablas ni consultas).
const crypto = require('crypto');

class ErrorNegocio extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.estado = estado;
  }
}

// "id_unidad_principal" → "id unidad principal"
const nombreCampo = columna => String(columna || '').replace(/_/g, ' ');

// Extrae el nombre de columna entre comillas del mensaje de MySQL.
function columnaDelMensaje(mensaje) {
  const m = /(?:column|Field|Column) '([^']+)'/.exec(mensaje || '');
  return m ? m[1] : null;
}

// Traduce los errores de validación de MySQL. Devuelve { estado, mensaje } o null.
function traducirErrorBD(err) {
  if (!err || !err.code) return null;
  const campo = nombreCampo(columnaDelMensaje(err.sqlMessage || err.message));
  switch (err.code) {
    case 'ER_NO_DEFAULT_FOR_FIELD':
    case 'ER_BAD_NULL_ERROR':
      return { estado: 400, mensaje: `Falta completar el campo obligatorio "${campo}".` };
    case 'ER_DATA_TOO_LONG':
      return { estado: 400, mensaje: `El valor del campo "${campo}" es demasiado largo.` };
    case 'ER_WARN_DATA_OUT_OF_RANGE':
      return { estado: 400, mensaje: `El valor del campo "${campo}" está fuera del rango permitido.` };
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD':
    case 'WARN_DATA_TRUNCATED':
    case 'ER_WRONG_VALUE':
      return { estado: 400, mensaje: campo ? `El valor del campo "${campo}" no es válido.` : 'Uno de los valores enviados no es válido.' };
    case 'ER_DUP_ENTRY':
      return { estado: 409, mensaje: 'Ya existe un registro con ese valor. Revisá los datos que deben ser únicos (CUIT, patente, nombre…).' };
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return { estado: 400, mensaje: 'Uno de los datos seleccionados ya no existe. Actualizá la pantalla y volvé a intentar.' };
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return { estado: 409, mensaje: 'No se puede eliminar: el registro está siendo utilizado por otra tabla' };
    default:
      return null;
  }
}

// Registra el error inesperado con un código y devuelve ese código.
function registrarErrorInterno(err, req) {
  const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
  const donde = req ? `${req.method} ${req.originalUrl}` : '';
  console.error(`[${new Date().toISOString()}] Error interno ${codigo} ${donde}:`, err && err.stack ? err.stack : err);
  return codigo;
}

// Responde el error según su tipo (ver encabezado).
function responderError(res, err, req) {
  if (err instanceof ErrorNegocio) {
    return res.status(err.estado).json({ error: err.message });
  }
  const traducido = traducirErrorBD(err);
  if (traducido) return res.status(traducido.estado).json({ error: traducido.mensaje });
  const codigo = registrarErrorInterno(err, req || res.req);
  return res.status(500).json({
    error: `Ocurrió un error interno. Si se repite, informá este código a soporte: ${codigo}`
  });
}

module.exports = { ErrorNegocio, traducirErrorBD, registrarErrorInterno, responderError };
