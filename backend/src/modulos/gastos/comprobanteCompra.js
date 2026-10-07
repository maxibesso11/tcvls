// backend/src/modulos/gastos/comprobanteCompra.js
// Bloque 7 · IVA en compras: funciones puras (sin base de datos) para el
// comprobante del proveedor que se agrega a un consumo o gasto. `monto`
// sigue siendo el total que se le debe al proveedor; estos campos solo
// discriminan ese total en neto, IVA y el resto de los conceptos del
// comprobante, para el futuro Libro IVA Compras.
const TOLERANCIA = 0.01;

// Letra B, C o un ticket no discriminan IVA: no dan crédito fiscal.
const LETRAS_SIN_CREDITO_FISCAL = new Set(['B', 'C']);
const TIPOS_SIN_CREDITO_FISCAL = new Set(['TICKET']);

// Tipos de comprobante que no identifican una factura concreta (no se
// controla duplicado ni se exige desglose contra el total).
const TIPOS_SIN_DATOS_FISCALES = new Set(['SIN_COMPROBANTE', 'NO_INFORMADO']);

function num(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

// Redondeo a 2 decimales: evita que un residuo de punto flotante
// (ej. 0.0000000001) rompa la comparación con el total.
function r2(n) {
  return Math.round(n * 100) / 100;
}

function sinCreditoFiscal(datos) {
  return LETRAS_SIN_CREDITO_FISCAL.has(datos.comprobante_letra) ||
    TIPOS_SIN_CREDITO_FISCAL.has(datos.comprobante_tipo);
}

// IVA a partir del neto gravado y la alícuota (%).
function calcularIva(netoGravado, alicuota) {
  return r2(num(netoGravado) * num(alicuota) / 100);
}

// Valida que neto_gravado + iva + no_gravado + exento + percepciones sea
// igual al total del registro (con tolerancia de un centavo), y que con
// letra B, C o ticket no haya IVA cargado. Devuelve el mensaje de error o
// null. No se exige para NO_INFORMADO/SIN_COMPROBANTE (no hay desglose).
function validarComprobante(datos, total) {
  if (TIPOS_SIN_DATOS_FISCALES.has(datos.comprobante_tipo)) return null;

  if (sinCreditoFiscal(datos) && num(datos.iva) !== 0) {
    return 'Con letra B, C o ticket el comprobante no discrimina IVA: no puede cargar crédito fiscal.';
  }
  const suma = num(datos.neto_gravado) + num(datos.iva) + num(datos.no_gravado) +
    num(datos.exento) + num(datos.percepciones);
  if (Math.abs(r2(suma) - r2(num(total))) > TOLERANCIA) {
    return `El desglose del comprobante ($ ${r2(suma).toFixed(2)}) no coincide con el total ($ ${r2(num(total)).toFixed(2)}).`;
  }
  return null;
}

// Junta lo que llega en `data` (puede ser parcial, en una edición) con lo que
// ya tenía el registro (`anterior`, null al crear).
function valorEfectivo(campo, data, anterior) {
  if (data[campo] !== undefined) return data[campo] === '' ? null : data[campo];
  return anterior ? anterior[campo] : undefined;
}

// Prepara los campos del comprobante para guardar: sin datos del comprobante
// (nunca se cargó un tipo), queda NO_INFORMADO con el total en neto_gravado y
// sin IVA — no se inventa un crédito fiscal que no se cargó. Con datos, arma
// el registro completo (mezclando con `anterior` en una edición parcial),
// calcula el IVA si falta y valida. Devuelve { datos, error }: si hay error,
// `datos` es null.
function prepararComprobante(data, anterior, total) {
  const tipo = valorEfectivo('comprobante_tipo', data, anterior) || null;

  if (!tipo) {
    return {
      error: null,
      datos: {
        comprobante_tipo: 'NO_INFORMADO', comprobante_letra: null,
        comprobante_punto_venta: null, comprobante_numero: null,
        neto_gravado: r2(num(total)), iva: 0, iva_alicuota: null,
        no_gravado: 0, exento: 0, percepciones: 0
      }
    };
  }

  const datos = {
    comprobante_tipo: tipo,
    comprobante_letra: valorEfectivo('comprobante_letra', data, anterior) ?? null,
    comprobante_punto_venta: valorEfectivo('comprobante_punto_venta', data, anterior) ?? null,
    comprobante_numero: valorEfectivo('comprobante_numero', data, anterior) ?? null,
    neto_gravado: num(valorEfectivo('neto_gravado', data, anterior)),
    iva_alicuota: valorEfectivo('iva_alicuota', data, anterior) ?? null,
    iva: valorEfectivo('iva', data, anterior),
    no_gravado: num(valorEfectivo('no_gravado', data, anterior)),
    exento: num(valorEfectivo('exento', data, anterior)),
    percepciones: num(valorEfectivo('percepciones', data, anterior))
  };

  const ivaSinCargar = datos.iva === undefined || datos.iva === null || datos.iva === '';
  if (sinCreditoFiscal(datos)) {
    // Con letra B, C o ticket: si no se cargó IVA, queda en cero (no
    // discrimina). Si se cargó uno explícito y no es cero, se deja pasar
    // para que validarComprobante lo rechace: mejor un error claro que
    // descartarlo en silencio.
    datos.iva = ivaSinCargar ? 0 : num(datos.iva);
  } else if (ivaSinCargar) {
    datos.iva = calcularIva(datos.neto_gravado, datos.iva_alicuota);
  } else {
    datos.iva = num(datos.iva);
  }

  const error = validarComprobante(datos, total);
  return { datos: error ? null : datos, error };
}

module.exports = {
  sinCreditoFiscal,
  calcularIva,
  validarComprobante,
  prepararComprobante,
  TIPOS_SIN_DATOS_FISCALES
};
