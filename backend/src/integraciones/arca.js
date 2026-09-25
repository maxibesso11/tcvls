// backend/src/integraciones/arca.js
// Integración con ARCA (ex-AFIP) para la factura electrónica (WSFEv1).
//
// Usa @afipsdk/afip.js, que abstrae la autenticación (WSAA) y el web service de
// facturación (WSFEv1). Por cada empresa se recupera su certificado y clave
// (guardados cifrados) y se pide el CAE en tiempo real.
//
// Variables de entorno:
//   ARCA_HABILITADO=1   activa la emisión real (si no, la factura queda borrador)
//   ARCA_PRODUCCION=1   usa el entorno de PRODUCCIÓN de ARCA (comprobantes
//                       reales). Sin esta variable, usa HOMOLOGACIÓN (prueba).
//
// La función solicitarCAE() devuelve { numero, cae, cae_vencimiento } — el
// número lo determina ARCA (último autorizado + 1), no un contador interno.

const ARCA_HABILITADO = process.env.ARCA_HABILITADO === '1';
const ARCA_PRODUCCION = process.env.ARCA_PRODUCCION === '1';
const pool = require('../config/db');
const cifrado = require('../lib/seguridad/cifrado');

// Carga tolerante del SDK: si no está instalado, se avisa al usarse.
let Afip = null;
try { Afip = require('@afipsdk/afip.js'); } catch (e) { /* se avisa en solicitarCAE */ }

// Tipos de comprobante de ARCA (Factura A / Nota de Crédito A).
const CBTE_TIPO = { FACTURA: 1, NOTA_CREDITO: 3 };

// Alícuota de IVA 21% → Id 5 en la tabla de ARCA.
const IVA_ID_21 = 5;

// Mapea la condición de IVA del receptor al código que exige ARCA
// (CondicionIVAReceptorId, obligatorio desde 2025). Para Factura A el receptor
// es responsable inscripto por defecto.
function condicionIVAReceptor(condicion) {
  const c = String(condicion || '').toUpperCase();
  if (c.includes('MONOTRIBUT')) return 6;   // Responsable Monotributo
  if (c.includes('EXENTO')) return 4;        // Sujeto Exento
  if (c.includes('CONSUMIDOR')) return 5;    // Consumidor Final
  return 1;                                  // IVA Responsable Inscripto
}

// Fecha a formato YYYYMMDD que espera ARCA.
function fechaAAAAMMDD(d) {
  const f = d ? new Date(d) : new Date();
  return `${f.getFullYear()}${String(f.getMonth() + 1).padStart(2, '0')}${String(f.getDate()).padStart(2, '0')}`;
}

// Convierte una fecha YYYYMMDD de ARCA a YYYY-MM-DD.
function deAAAAMMDD(s) {
  const t = String(s || '');
  return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
}

/**
 * Recupera el certificado y la clave privada (descifrada) de una empresa.
 * Devuelve { cert, key } listos para el SDK, o null si no hay certificado
 * activo. La clave se descifra en memoria solo para el llamado a ARCA.
 */
async function obtenerCredenciales(idEmpresa) {
  const [[fila]] = await pool.query(
    `SELECT clave_privada_cifrada, certificado_pem, estado, fecha_vencimiento
       FROM CERTIFICADOS_ARCA
      WHERE id_empresa = ? AND estado = 'ACTIVO' AND certificado_pem IS NOT NULL
      ORDER BY id_certificado DESC LIMIT 1`,
    [idEmpresa]
  );
  if (!fila) return null;
  if (fila.fecha_vencimiento && new Date(fila.fecha_vencimiento) < new Date()) {
    throw new Error('El certificado de la empresa está vencido. Generá y cargá uno nuevo desde la configuración de la empresa.');
  }
  return {
    cert: fila.certificado_pem,
    key: cifrado.descifrar(fila.clave_privada_cifrada)
  };
}

/**
 * Solicita el CAE a ARCA para una factura.
 * @param {object} f  Datos del comprobante:
 *   { id_empresa, emisor_cuit, punto_venta, clase, receptor_cuit,
 *     receptor_condicion_iva, neto_gravado, iva, total, fecha }
 * @returns {Promise<{numero:number, cae:string, cae_vencimiento:string}|null>}
 *   Devuelve null si ARCA no está habilitado (la factura queda borrador).
 */
async function solicitarCAE(f) {
  if (!ARCA_HABILITADO) return null;

  if (!Afip) {
    throw new Error('Falta la dependencia @afipsdk/afip.js en el servidor. Instalá con: npm install @afipsdk/afip.js');
  }

  const credenciales = await obtenerCredenciales(f.id_empresa);
  if (!credenciales) {
    throw new Error('La empresa no tiene un certificado de facturación activo. Generalo y cargá el .crt de ARCA en la configuración de la empresa.');
  }

  const cuit = Number(String(f.emisor_cuit || '').replace(/\D/g, ''));
  if (!cuit) throw new Error('La empresa no tiene un CUIT válido para facturar.');

  const afip = new Afip({
    CUIT: cuit,
    cert: credenciales.cert,
    key: credenciales.key,
    production: ARCA_PRODUCCION,
    // Las versiones actuales del SDK requieren un access_token de app.afipsdk.com.
    // Se toma de la variable de entorno si está definida.
    ...(process.env.AFIPSDK_ACCESS_TOKEN ? { access_token: process.env.AFIPSDK_ACCESS_TOKEN } : {})
  });

  const cbteTipo = CBTE_TIPO[f.clase] || CBTE_TIPO.FACTURA;
  const puntoVenta = Number(f.punto_venta) || 1;

  // 1. El número lo determina ARCA: último autorizado + 1.
  let numero;
  try {
    const ultimo = await afip.ElectronicBilling.getLastVoucher(puntoVenta, cbteTipo);
    numero = Number(ultimo) + 1;
  } catch (e) {
    throw new Error(`No se pudo consultar el último comprobante en ARCA (punto de venta ${puntoVenta}). ${detalleError(e)}`);
  }

  // 2. Armar el comprobante y solicitar el CAE.
  const neto = Number(f.neto_gravado);
  const iva = Number(f.iva);
  const total = Number(f.total);
  const datos = {
    CantReg: 1,
    PtoVta: puntoVenta,
    CbteTipo: cbteTipo,
    Concepto: 1,                 // 1 = Productos (el flete se factura como tal)
    DocTipo: 80,                 // 80 = CUIT
    DocNro: Number(String(f.receptor_cuit || '').replace(/\D/g, '')),
    CbteDesde: numero,
    CbteHasta: numero,
    CbteFch: fechaAAAAMMDD(f.fecha),
    ImpTotal: total,
    ImpTotConc: 0,               // neto no gravado
    ImpNeto: neto,
    ImpOpEx: 0,
    ImpIVA: iva,
    ImpTrib: 0,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIVAReceptor(f.receptor_condicion_iva),
    Iva: [{ Id: IVA_ID_21, BaseImp: neto, Importe: iva }]
  };

  let res;
  try {
    res = await afip.ElectronicBilling.createVoucher(datos);
  } catch (e) {
    throw new Error(`ARCA rechazó el comprobante. ${detalleError(e)}`);
  }
  if (!res || !res.CAE) {
    throw new Error('ARCA no devolvió un CAE. Revisá los datos del comprobante y el estado del servicio.');
  }
  return {
    numero,
    cae: String(res.CAE),
    cae_vencimiento: deAAAAMMDD(res.CAEFchVto)
  };
}

// Extrae el mensaje de error útil de una excepción del SDK/axios. El detalle
// real de ARCA viene en la respuesta HTTP (error.response.data), no en el
// mensaje genérico "Request failed with status code 400".
function detalleError(e) {
  const r = e && e.response;
  if (r && r.data) {
    const d = r.data;
    if (typeof d === 'string') return d.slice(0, 400);
    // El SDK suele devolver { error, message, ... } o el detalle de ARCA.
    const msg = d.error || d.message || d.Errors || d.detail || JSON.stringify(d);
    return (typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 400);
  }
  return (e && e.message) ? e.message : 'Error desconocido.';
}

module.exports = { solicitarCAE, obtenerCredenciales, ARCA_HABILITADO, ARCA_PRODUCCION };
