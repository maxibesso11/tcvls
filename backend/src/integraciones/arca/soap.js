// backend/src/integraciones/arca/soap.js
// Transporte SOAP 1.1 hacia los web services de ARCA (WSAA y WSFEv1), sin
// librerías intermedias: arma el sobre, hace el POST con tiempo límite y
// devuelve el cuerpo ya convertido a objeto. Nunca registra en el log el
// contenido de los pedidos (llevan el token y la firma de acceso).
const { XMLParser } = require('fast-xml-parser');

const ENTORNOS = {
  HOMOLOGACION: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'
  },
  PRODUCCION: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
  }
};

// Entorno de ARCA del servidor: PRODUCCION solo con ARCA_PRODUCCION=1.
function entornoActual() {
  return process.env.ARCA_PRODUCCION === '1' ? 'PRODUCCION' : 'HOMOLOGACION';
}

// Las direcciones se pueden redirigir (ARCA_WSAA_URL / ARCA_WSFE_URL) para los
// tests, que usan un ARCA simulado. En producción no se definen.
function url(servicio, entorno = entornoActual()) {
  const forzada = servicio === 'wsaa' ? process.env.ARCA_WSAA_URL : process.env.ARCA_WSFE_URL;
  return forzada || ENTORNOS[entorno][servicio];
}

const TIEMPO_LIMITE_MS = Number(process.env.ARCA_TIEMPO_LIMITE_MS) || 30000;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,        // todo como texto: números de CUIT, CAE, etc. sin perder ceros
  trimValues: true
});

// Error de comunicación con ARCA. incierto = true cuando no se sabe si ARCA
// llegó a procesar el pedido (se cortó la conexión o venció el tiempo):
// quien llama debe consultar el resultado antes de reintentar.
class ErrorArca extends Error {
  constructor(mensaje, { incierto = false, codigo = null, detalle = null } = {}) {
    super(mensaje);
    this.name = 'ErrorArca';
    this.incierto = incierto;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

function escaparXml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// POST de un sobre SOAP. Devuelve el objeto del Body.
async function llamar({ direccion, accion, cuerpo, espacios = '' }) {
  const sobre = '<?xml version="1.0" encoding="utf-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"${espacios}>` +
    `<soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
  let respuesta, texto;
  try {
    respuesta = await fetch(direccion, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${accion}"` },
      body: sobre,
      signal: control.signal
    });
    texto = await respuesta.text();
  } catch (err) {
    // Sin respuesta: no se sabe si ARCA recibió el pedido.
    const vencio = err.name === 'AbortError';
    throw new ErrorArca(vencio
      ? 'ARCA no respondió a tiempo.'
      : 'No se pudo conectar con ARCA (' + (err.cause && err.cause.code || err.message) + ').', { incierto: true });
  } finally {
    clearTimeout(temporizador);
  }

  let objeto;
  try {
    objeto = parser.parse(texto);
  } catch (e) {
    throw new ErrorArca(`ARCA devolvió una respuesta ilegible (HTTP ${respuesta.status}).`, { incierto: respuesta.status >= 500 });
  }
  const cuerpoResp = objeto && objeto.Envelope && objeto.Envelope.Body;
  if (!cuerpoResp) {
    throw new ErrorArca(`ARCA devolvió una respuesta inesperada (HTTP ${respuesta.status}).`, { incierto: respuesta.status >= 500 });
  }
  if (cuerpoResp.Fault) {
    const f = cuerpoResp.Fault;
    throw new ErrorArca(`ARCA: ${f.faultstring || 'error sin detalle'}`, { codigo: String(f.faultcode || '') });
  }
  return cuerpoResp;
}

// Siempre un array (fast-xml-parser devuelve objeto si hay un solo elemento).
const comoLista = v => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);

module.exports = { ENTORNOS, entornoActual, url, llamar, escaparXml, comoLista, parser, ErrorArca };
