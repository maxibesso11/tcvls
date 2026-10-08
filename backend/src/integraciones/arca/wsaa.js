// backend/src/integraciones/arca/wsaa.js
// Autenticación ante ARCA (WSAA): se arma el "ticket de pedido de acceso"
// (TRA), se firma con el certificado y la clave privada de la empresa (CMS /
// PKCS#7) y se cambia por un ticket de acceso (TA: token + sign) que dura
// unas 12 horas.
//
// ⚠ ARCA rechaza un pedido nuevo mientras exista un TA vigente para el mismo
// certificado y servicio ("El CEE ya posee un TA valido"). Por eso este
// módulo NUNCA se usa directo: el TA se pide a través de tickets.js, que lo
// guarda apenas llega y lo reutiliza hasta que vence.
const forge = require('node-forge');
const { url, llamar, parser, ErrorArca } = require('./soap');

// Fecha ISO 8601 con la zona de Argentina (-03:00), como la espera el WSAA.
function isoArgentina(fecha) {
  const local = new Date(fecha.getTime() - 3 * 3600 * 1000);
  return local.toISOString().slice(0, 19) + '-03:00';
}

// Ticket de pedido de acceso para un servicio (ej. "wsfe").
function crearTRA(servicio, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - 10 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 10 * 60 * 1000);
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${isoArgentina(desde)}</generationTime>` +
    `<expirationTime>${isoArgentina(hasta)}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`;
}

// Firma el TRA (CMS SignedData con el contenido incluido) y lo devuelve en base64.
function firmarTRA(tra, certificadoPem, clavePrivadaPem) {
  const certificado = forge.pki.certificateFromPem(certificadoPem);
  const clave = forge.pki.privateKeyFromPem(clavePrivadaPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(certificado);
  p7.addSigner({
    key: clave,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ]
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// Huella SHA-256 del certificado: identifica qué certificado obtuvo cada TA.
function huellaCertificado(certificadoPem) {
  const cert = forge.pki.certificateFromPem(certificadoPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
}

// Pide un TA nuevo al WSAA. Devuelve { token, sign, generado, expira } (Date).
// Lanza ErrorArca con yaTieneTicket = true si ARCA dice que hay uno vigente.
async function pedirTicket({ servicio, certificadoPem, clavePrivadaPem, entorno }) {
  const cms = firmarTRA(crearTRA(servicio), certificadoPem, clavePrivadaPem);
  let cuerpo;
  try {
    cuerpo = await llamar({
      direccion: url('wsaa', entorno),
      accion: '',
      espacios: ' xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"',
      cuerpo: `<wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>`
    });
  } catch (err) {
    if (err instanceof ErrorArca && /alreadyAuthenticated|ya posee un TA/i.test(err.codigo + ' ' + err.message)) {
      err.yaTieneTicket = true;
    }
    throw err;
  }
  const xmlTicket = cuerpo.loginCmsResponse && cuerpo.loginCmsResponse.loginCmsReturn;
  if (!xmlTicket) throw new ErrorArca('El WSAA de ARCA no devolvió el ticket de acceso.');
  const ticket = parser.parse(xmlTicket).loginTicketResponse;
  const token = ticket && ticket.credentials && ticket.credentials.token;
  const sign = ticket && ticket.credentials && ticket.credentials.sign;
  if (!token || !sign) throw new ErrorArca('El ticket de acceso de ARCA vino incompleto.');
  return {
    token,
    sign,
    generado: new Date(ticket.header.generationTime),
    expira: new Date(ticket.header.expirationTime)
  };
}

module.exports = { crearTRA, firmarTRA, huellaCertificado, pedirTicket, isoArgentina };
