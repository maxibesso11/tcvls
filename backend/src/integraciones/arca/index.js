// backend/src/integraciones/arca/index.js
// Acceso a ARCA (ex-AFIP) para la factura electrónica, por empresa:
//   - credenciales: el certificado activo de la empresa y su clave privada
//     (guardada cifrada; se descifra solo en memoria para firmar);
//   - acceso: ticket del WSAA, SIEMPRE a través de tickets.js (reutiliza el
//     vigente; pedir dos seguidos bloquea el certificado hasta 12 horas);
//   - operaciones del WSFEv1 con el CUIT de la empresa.
// Conexión directa con los servicios oficiales: la clave nunca sale del servidor.
//
// Variables de entorno:
//   ARCA_PRODUCCION=1   usa PRODUCCIÓN (comprobantes reales); si no, HOMOLOGACIÓN.
//   ARCA_TIEMPO_LIMITE_MS   tiempo máximo de espera de cada pedido (30 s).
const pool = require('../../config/db');
const cifrado = require('../../lib/seguridad/cifrado');
const { ErrorNegocio } = require('../../lib/errores');
const { entornoActual, ErrorArca } = require('./soap');
const { obtenerTicket, estadoTicket } = require('./tickets');
const wsfe = require('./wsfe');

const soloDigitos = v => String(v || '').replace(/\D/g, '');

// Certificado activo y clave de la empresa. Lanza ErrorNegocio si falta algo.
async function credenciales(idEmpresa) {
  const [[empresa]] = await pool.query('SELECT cuit FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  if (!empresa) throw new ErrorNegocio('Empresa no encontrada.', 404);
  const cuit = soloDigitos(empresa.cuit);
  if (cuit.length !== 11) throw new ErrorNegocio('La empresa no tiene un CUIT válido de 11 dígitos: corregilo en los datos fiscales.');
  const [[cert]] = await pool.query(
    `SELECT clave_privada_cifrada, certificado_pem, fecha_vencimiento
       FROM CERTIFICADOS_ARCA
      WHERE id_empresa = ? AND estado = 'ACTIVO' AND certificado_pem IS NOT NULL
      ORDER BY id_certificado DESC LIMIT 1`, [idEmpresa]);
  if (!cert) throw new ErrorNegocio('La empresa no tiene un certificado de ARCA activo. Cargalo en Mi empresa → Certificado ARCA.');
  if (cert.fecha_vencimiento && String(cert.fecha_vencimiento).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    throw new ErrorNegocio('El certificado de ARCA de la empresa está vencido. Generá y cargá uno nuevo.');
  }
  return { cuit, certificadoPem: cert.certificado_pem, clavePrivadaPem: cifrado.descifrar(cert.clave_privada_cifrada) };
}

// Cliente de ARCA para una empresa: todas las operaciones usan su CUIT,
// su certificado y el ticket guardado.
async function clienteEmpresa(idEmpresa) {
  const entorno = entornoActual();
  const cred = await credenciales(idEmpresa);
  const acceso = async () => {
    const ta = await obtenerTicket({ cuit: cred.cuit, entorno, servicio: 'wsfe',
      certificadoPem: cred.certificadoPem, clavePrivadaPem: cred.clavePrivadaPem });
    return { token: ta.token, sign: ta.sign, cuit: cred.cuit };
  };
  return {
    cuit: cred.cuit,
    entorno,
    ultimoAutorizado: async (puntoVenta, tipo) => wsfe.ultimoAutorizado(await acceso(), { puntoVenta, tipo }, entorno),
    solicitarCAE: async detalle => wsfe.solicitarCAE(await acceso(), detalle, entorno),
    consultar: async (puntoVenta, tipo, numero) => wsfe.consultarComprobante(await acceso(), { puntoVenta, tipo, numero }, entorno),
    puntosDeVenta: async () => wsfe.puntosDeVenta(await acceso(), entorno),
    condicionesIvaReceptor: async clase => wsfe.condicionesIvaReceptor(await acceso(), clase, entorno),
    estadoTicket: () => estadoTicket({ cuit: cred.cuit, entorno, servicio: 'wsfe', certificadoPem: cred.certificadoPem })
  };
}

module.exports = { clienteEmpresa, credenciales, entornoActual, ErrorArca, dummy: () => wsfe.dummy(entornoActual()) };
