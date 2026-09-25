// backend/src/modulos/viajes/viajes.calculos.js
// Cálculos puros (sin base de datos) de los importes de un viaje.
// Se usan en viajes.hooks.js y están cubiertos por backend/test/viajes.calculos.test.js.
//
//   Monto del viaje   = tarifa (UNICA) o tarifa × resultado (o cantidad cargada)
//   Neto con comisión = monto × (1 − comisión%)
//   Cuenta cliente    = neto (SIN_FACTURAR) o neto + IVA 21% (resto de los modos)
//   Liquidación chofer: PORCENTAJE del monto, POR KM × km (solo tarifa POR KM), FIJA = 0
const { IVA_ALICUOTA: IVA } = require('../../config/constantes');

function calcularMontoViaje(viaje) {
  if (viaje.tipo_tarifa === 'UNICA') return Number(viaje.tarifa) || 0;
  const cantidad = Number(viaje.resultado ?? viaje.cantidad_cargada) || 0;
  return (Number(viaje.tarifa) || 0) * cantidad;
}

function calcularMontoFacturado(viaje) {
  // Monto con IVA (comportamiento histórico / líquido producto).
  return calcularNetoConComision(viaje) * (1 + IVA);
}

// Neto del viaje ya descontada la comisión (lo que efectivamente se le cobra
// al cliente antes de IVA). La comisión reduce lo que paga el cliente.
function calcularNetoConComision(viaje) {
  const base = calcularMontoViaje(viaje);
  const comision = Number(viaje.comision) || 0;
  return base * (1 - comision / 100);
}

// Monto a imputar en la cuenta del cliente según el modo de facturación.
//   SIN_FACTURAR      → neto sin IVA
//   LIQUIDO_PRODUCTO  → neto + IVA
//   FACTURA           → neto + IVA (además se emite el comprobante formal)
//   (NULL/otro)       → neto + IVA (compatibilidad con viajes previos)
function calcularMontoCuentaCliente(viaje) {
  const neto = calcularNetoConComision(viaje);
  if (viaje.modo_facturacion === 'SIN_FACTURAR') return neto;
  return neto * (1 + IVA);
}

function calcularLiquidacionChofer(viaje, chofer) {
  if (!chofer || !chofer.tipo_remuneracion || chofer.remuneracion == null) {
    return { monto: 0, incompleto: false };
  }
  const remu = Number(chofer.remuneracion);
  if (!Number.isFinite(remu) || remu <= 0) return { monto: 0, incompleto: false };

  switch (chofer.tipo_remuneracion) {
    case 'PORCENTAJE':
      return { monto: calcularMontoViaje(viaje) * (remu / 100), incompleto: false };
    case 'POR KM':
      if (viaje.tipo_tarifa === 'POR KM') {
        const km = Number(viaje.resultado) || 0;
        return { monto: km * remu, incompleto: false };
      }
      return { monto: 0, incompleto: true };
    case 'FIJA':
    default:
      return { monto: 0, incompleto: false };
  }
}

module.exports = {
  calcularMontoViaje,
  calcularMontoFacturado,
  calcularNetoConComision,
  calcularMontoCuentaCliente,
  calcularLiquidacionChofer
};
