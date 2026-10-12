// backend/src/integraciones/arca/wsfe.js
// Web service de factura electrónica de ARCA (WSFEv1): pedidos SOAP armados
// a mano, en el orden exacto que exige el WSDL (un elemento fuera de orden
// hace fallar el pedido entero). Las funciones reciben el acceso
// { token, sign, cuit } y el entorno, y devuelven datos ya interpretados.
const { url, llamar, escaparXml, comoLista, ErrorArca } = require('./soap');

const NS = 'http://ar.gov.afip.dif.FEV1/';
const ESPACIOS = ` xmlns:ar="${NS}"`;

// Importe con 2 decimales y punto (formato del web service).
const importe = n => (Math.round(Number(n) * 100) / 100).toFixed(2);

function xmlAuth({ token, sign, cuit }) {
  return `<ar:Auth><ar:Token>${escaparXml(token)}</ar:Token><ar:Sign>${escaparXml(sign)}</ar:Sign>` +
    `<ar:Cuit>${Number(cuit)}</ar:Cuit></ar:Auth>`;
}

// Errores (Errors/Err) y eventos que devuelve cualquier método.
function errores(resultado) {
  return comoLista(resultado && resultado.Errors && resultado.Errors.Err)
    .map(e => ({ codigo: String(e.Code), mensaje: String(e.Msg) }));
}

function lanzarSiHayErrores(resultado, contexto) {
  const errs = errores(resultado);
  if (errs.length) {
    throw new ErrorArca(`${contexto}: ` + errs.map(e => `[${e.codigo}] ${e.mensaje}`).join('; '),
      { codigo: errs[0].codigo, detalle: errs });
  }
}

async function metodo(nombre, cuerpo, entorno) {
  const resp = await llamar({
    direccion: url('wsfe', entorno),
    accion: NS + nombre,
    espacios: ESPACIOS,
    cuerpo: `<ar:${nombre}>${cuerpo}</ar:${nombre}>`
  });
  const r = resp[`${nombre}Response`];
  return r && r[`${nombre}Result`];
}

// Estado de los servidores de ARCA (no requiere autenticación).
async function dummy(entorno) {
  const r = await metodo('FEDummy', '', entorno);
  return { app: r && r.AppServer, db: r && r.DbServer, auth: r && r.AuthServer };
}

// Último número autorizado para un punto de venta y tipo de comprobante.
async function ultimoAutorizado(acceso, { puntoVenta, tipo }, entorno) {
  const r = await metodo('FECompUltimoAutorizado',
    xmlAuth(acceso) + `<ar:PtoVta>${Number(puntoVenta)}</ar:PtoVta><ar:CbteTipo>${Number(tipo)}</ar:CbteTipo>`, entorno);
  lanzarSiHayErrores(r, 'ARCA no informó el último comprobante');
  return Number(r.CbteNro);
}

// Detalle de un comprobante, en el orden del WSDL (FEDetRequest).
function xmlDetalle(d) {
  const partes = [
    `<ar:Concepto>${Number(d.concepto)}</ar:Concepto>`,
    `<ar:DocTipo>${Number(d.docTipo)}</ar:DocTipo>`,
    `<ar:DocNro>${Number(d.docNro) || 0}</ar:DocNro>`,
    `<ar:CbteDesde>${Number(d.numero)}</ar:CbteDesde>`,
    `<ar:CbteHasta>${Number(d.numero)}</ar:CbteHasta>`,
    `<ar:CbteFch>${d.fecha}</ar:CbteFch>`,
    `<ar:ImpTotal>${importe(d.total)}</ar:ImpTotal>`,
    `<ar:ImpTotConc>${importe(d.noGravado || 0)}</ar:ImpTotConc>`,
    `<ar:ImpNeto>${importe(d.neto)}</ar:ImpNeto>`,
    `<ar:ImpOpEx>${importe(d.exento || 0)}</ar:ImpOpEx>`,
    `<ar:ImpTrib>${importe(0)}</ar:ImpTrib>`,
    `<ar:ImpIVA>${importe(d.iva)}</ar:ImpIVA>`
  ];
  // Servicios (2) o productos y servicios (3): período y vencimiento obligatorios.
  if (Number(d.concepto) !== 1) {
    partes.push(`<ar:FchServDesde>${d.servicioDesde}</ar:FchServDesde>`);
    partes.push(`<ar:FchServHasta>${d.servicioHasta}</ar:FchServHasta>`);
    partes.push(`<ar:FchVtoPago>${d.vencimientoPago}</ar:FchVtoPago>`);
  }
  partes.push('<ar:MonId>PES</ar:MonId>', '<ar:MonCotiz>1</ar:MonCotiz>');
  partes.push(`<ar:CondicionIVAReceptorId>${Number(d.condicionIvaReceptor)}</ar:CondicionIVAReceptorId>`);
  if (d.asociado) {
    const a = d.asociado;
    partes.push('<ar:CbtesAsoc><ar:CbteAsoc>' +
      `<ar:Tipo>${Number(a.tipo)}</ar:Tipo><ar:PtoVta>${Number(a.puntoVenta)}</ar:PtoVta>` +
      `<ar:Nro>${Number(a.numero)}</ar:Nro><ar:Cuit>${Number(a.cuit)}</ar:Cuit><ar:CbteFch>${a.fecha}</ar:CbteFch>` +
      '</ar:CbteAsoc></ar:CbtesAsoc>');
  }
  if (Number(d.iva) > 0 || (d.alicuotas && d.alicuotas.length)) {
    partes.push('<ar:Iva>' + (d.alicuotas || []).map(a =>
      `<ar:AlicIva><ar:Id>${Number(a.id)}</ar:Id><ar:BaseImp>${importe(a.base)}</ar:BaseImp><ar:Importe>${importe(a.importe)}</ar:Importe></ar:AlicIva>`
    ).join('') + '</ar:Iva>');
  }
  // Actividad del emisor por la que se factura (va última en el WSDL, después
  // de Iva, Opcionales, Compradores y PeriodoAsoc). Opcional.
  if (d.actividad) {
    partes.push(`<ar:Actividades><ar:Actividad><ar:Id>${Number(d.actividad)}</ar:Id></ar:Actividad></ar:Actividades>`);
  }
  return `<ar:FECAEDetRequest>${partes.join('')}</ar:FECAEDetRequest>`;
}

function xmlPedidoCAE(d) {
  return '<ar:FeCAEReq><ar:FeCabReq>' +
    `<ar:CantReg>1</ar:CantReg><ar:PtoVta>${Number(d.puntoVenta)}</ar:PtoVta><ar:CbteTipo>${Number(d.tipo)}</ar:CbteTipo>` +
    `</ar:FeCabReq><ar:FeDetReq>${xmlDetalle(d)}</ar:FeDetReq></ar:FeCAEReq>`;
}

// Pide el CAE de UN comprobante. Devuelve:
//   { aprobado: true,  cae, caeVencimiento, observaciones }
//   { aprobado: false, errores, observaciones }   (rechazado: el número NO se usó)
// Si la conexión falla, lanza ErrorArca con incierto = true: hay que
// consultar el comprobante (consultarComprobante) antes de reintentar.
async function solicitarCAE(acceso, detalle, entorno) {
  const r = await metodo('FECAESolicitar', xmlAuth(acceso) + xmlPedidoCAE(detalle), entorno);
  const det = r && r.FeDetResp && comoLista(r.FeDetResp.FECAEDetResponse)[0];
  const observaciones = comoLista(det && det.Observaciones && det.Observaciones.Obs)
    .map(o => ({ codigo: String(o.Code), mensaje: String(o.Msg) }));
  const errs = errores(r);
  const resultado = det && det.Resultado || (r && r.FeCabResp && r.FeCabResp.Resultado);
  if (resultado === 'A' && det.CAE) {
    return { aprobado: true, cae: String(det.CAE), caeVencimiento: String(det.CAEFchVto), observaciones };
  }
  return { aprobado: false, errores: errs, observaciones };
}

// Consulta un comprobante ya emitido (o que pudo haberse emitido). Devuelve
// null si ARCA no lo tiene.
async function consultarComprobante(acceso, { puntoVenta, tipo, numero }, entorno) {
  const r = await metodo('FECompConsultar', xmlAuth(acceso) +
    `<ar:FeCompConsReq><ar:CbteTipo>${Number(tipo)}</ar:CbteTipo><ar:CbteNro>${Number(numero)}</ar:CbteNro>` +
    `<ar:PtoVta>${Number(puntoVenta)}</ar:PtoVta></ar:FeCompConsReq>`, entorno);
  const errs = errores(r);
  // 602: "Sin Resultados" (el comprobante no existe en ARCA).
  if (errs.some(e => e.codigo === '602')) return null;
  if (errs.length) lanzarSiHayErrores(r, 'No se pudo consultar el comprobante en ARCA');
  const g = r.ResultGet;
  return {
    resultado: String(g.Resultado), cae: String(g.CodAutorizacion || ''), caeVencimiento: String(g.FchVto || ''),
    fecha: String(g.CbteFch), total: Number(g.ImpTotal), docTipo: Number(g.DocTipo), docNro: String(g.DocNro)
  };
}

// Puntos de venta dados de alta para factura electrónica por web service.
async function puntosDeVenta(acceso, entorno) {
  const r = await metodo('FEParamGetPtosVenta', xmlAuth(acceso), entorno);
  const errs = errores(r);
  // 602: "Sin Resultados" (no tiene ninguno habilitado).
  if (errs.some(e => e.codigo === '602')) return [];
  lanzarSiHayErrores(r, 'ARCA no informó los puntos de venta');
  return comoLista(r.ResultGet && r.ResultGet.PtoVenta).map(p => ({
    numero: Number(p.Nro), tipo: String(p.EmisionTipo), bloqueado: String(p.Bloqueado) === 'S',
    baja: p.FchBaja && String(p.FchBaja) !== 'NULL' ? String(p.FchBaja) : null
  }));
}

// Actividades inscriptas del emisor en ARCA (las que puede indicar en cada
// comprobante). Devuelve [{ id, orden, descripcion }], la principal primero.
async function actividades(acceso, entorno) {
  const r = await metodo('FEParamGetActividades', xmlAuth(acceso), entorno);
  const errs = errores(r);
  if (errs.some(e => e.codigo === '602')) return [];
  lanzarSiHayErrores(r, 'ARCA no informó las actividades');
  return comoLista(r.ResultGet && r.ResultGet.ActividadesTipo)
    .map(a => ({ id: Number(a.Id), orden: Number(a.Orden), descripcion: String(a.Desc || '') }))
    .sort((a, b) => a.orden - b.orden);
}

// Condiciones frente al IVA del receptor aceptadas para una clase (A, B, C).
async function condicionesIvaReceptor(acceso, clase, entorno) {
  const r = await metodo('FEParamGetCondicionIvaReceptor', xmlAuth(acceso) + `<ar:ClaseCmp>${escaparXml(clase)}</ar:ClaseCmp>`, entorno);
  lanzarSiHayErrores(r, 'ARCA no informó las condiciones de IVA');
  return comoLista(r.ResultGet && r.ResultGet.CondicionIvaReceptor)
    .map(c => ({ id: Number(c.Id), descripcion: String(c.Desc), clase: String(c.Cmp_Clase) }));
}

module.exports = {
  dummy, ultimoAutorizado, solicitarCAE, consultarComprobante, puntosDeVenta, condicionesIvaReceptor, actividades,
  xmlDetalle, xmlPedidoCAE, importe
};
