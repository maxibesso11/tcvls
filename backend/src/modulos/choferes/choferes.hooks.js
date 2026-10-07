// backend/src/modulos/choferes/choferes.hooks.js
// Validación de la remuneración mixta del chofer (migración 029): sueldo
// fijo mensual y/o variable por viaje (porcentaje o por km), cada una
// opcional, pero se exige al menos una de las dos.
function valorEfectivo(campo, data, anterior) {
  if (data[campo] !== undefined) return data[campo] === '' ? null : data[campo];
  return anterior ? anterior[campo] : null;
}

function validarRemuneracion(data, anterior) {
  const fijo = valorEfectivo('sueldo_fijo_mensual', data, anterior);
  const tipoVariable = valorEfectivo('variable_tipo', data, anterior);
  const valorVariable = valorEfectivo('variable_valor', data, anterior);

  if ((tipoVariable && (valorVariable === null || valorVariable === undefined)) ||
      (!tipoVariable && valorVariable !== null && valorVariable !== undefined)) {
    return 'La remuneración variable necesita el tipo y el valor completos.';
  }

  const tieneFijo = fijo !== null && fijo !== undefined && Number(fijo) > 0;
  const tieneVariable = !!tipoVariable && Number(valorVariable) > 0;
  if (!tieneFijo && !tieneVariable) {
    return 'Cargá al menos una parte de la remuneración: sueldo fijo mensual o variable por viaje.';
  }
  return null;
}

function antesDeCrearChofer(data) {
  return validarRemuneracion(data, null);
}

function antesDeActualizarChofer(id, data, anterior) {
  return validarRemuneracion(data, anterior);
}

module.exports = { antesDeCrearChofer, antesDeActualizarChofer };
