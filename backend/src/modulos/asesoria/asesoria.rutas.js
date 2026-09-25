// backend/src/modulos/asesoria/asesoria.rutas.js
// Endpoint público (sin autenticación) que recibe las solicitudes de asesoría
// del formulario de la landing y las envía por correo al destinatario
// configurado. La dirección de destino NUNCA se expone al frontend: vive solo
// en variables de entorno del servidor.
//
// Configuración por entorno (.env):
//   ASESORIA_DESTINO   Dirección que recibe las solicitudes (ej. dueño).
//   SMTP_HOST          Servidor SMTP (ej. smtp.gmail.com).
//   SMTP_PORT          Puerto (587 con STARTTLS, 465 con SSL).
//   SMTP_USER          Usuario/casilla que envía.
//   SMTP_PASS          Contraseña o "contraseña de aplicación".
//   SMTP_DESDE         (opcional) remitente mostrado; por defecto SMTP_USER.
//
// Si el SMTP no está configurado, el endpoint responde 503 con un mensaje
// claro en vez de fallar silenciosamente.
const express = require('express');
const router = express.Router();

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* se avisa al usarse */ }

// Límite simple de tasa en memoria: máx. 5 solicitudes por IP cada 10 min,
// para evitar abuso del formulario público.
const ventana = 10 * 60 * 1000;
const maxPorVentana = 5;
const registros = new Map();
function limitado(ip) {
  const ahora = Date.now();
  const previos = (registros.get(ip) || []).filter(t => ahora - t < ventana);
  previos.push(ahora);
  registros.set(ip, previos);
  return previos.length > maxPorVentana;
}

const limpiar = s => String(s == null ? '' : s).trim();
const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

router.post('/', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'desconocida';
    if (limitado(ip)) {
      return res.status(429).json({ error: 'Recibimos varias solicitudes desde tu conexión. Probá de nuevo en unos minutos.' });
    }

    const nombre = limpiar(req.body.nombre).slice(0, 120);
    const empresa = limpiar(req.body.empresa).slice(0, 120);
    const email = limpiar(req.body.email).slice(0, 150);
    const telefono = limpiar(req.body.telefono).slice(0, 40);
    const mensaje = limpiar(req.body.mensaje).slice(0, 1000);

    // Validación de los campos obligatorios
    if (!nombre || !empresa || !email || !telefono) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, empresa, email y teléfono).' });
    }
    if (!emailValido(email)) {
      return res.status(400).json({ error: 'El email no tiene un formato válido.' });
    }

    const destino = process.env.ASESORIA_DESTINO;
    const smtpConfigurado = destino && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && nodemailer;
    if (!smtpConfigurado) {
      // No está configurado el envío: se registra en el log del servidor para
      // no perder el contacto, y se informa sin exponer la casilla.
      console.warn('[asesoria] SMTP no configurado. Solicitud recibida y NO enviada por correo:',
        { nombre, empresa, email, telefono, mensaje });
      return res.status(503).json({
        error: 'El envío de solicitudes no está disponible en este momento. Escribinos por los canales de contacto habituales.'
      });
    }

    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    await transporte.sendMail({
      from: process.env.SMTP_DESDE || `TCV LogiSuite <${process.env.SMTP_USER}>`,
      to: destino,
      replyTo: `${nombre} <${email}>`,
      subject: `Solicitud de asesoría — ${empresa}`,
      text:
        `Nueva solicitud de asesoría desde la web.\n\n` +
        `Nombre: ${nombre}\nEmpresa: ${empresa}\nEmail: ${email}\nTeléfono: ${telefono}\n` +
        (mensaje ? `\nMensaje:\n${mensaje}\n` : ''),
      html:
        `<h2 style="color:#16386b;font-family:Arial,sans-serif">Nueva solicitud de asesoría</h2>` +
        `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7d">Nombre</td><td style="padding:4px 0"><strong>${esc(nombre)}</strong></td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7d">Empresa</td><td style="padding:4px 0"><strong>${esc(empresa)}</strong></td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7d">Email</td><td style="padding:4px 0">${esc(email)}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7d">Teléfono</td><td style="padding:4px 0">${esc(telefono)}</td></tr>` +
        `</table>` +
        (mensaje ? `<p style="font-family:Arial,sans-serif;font-size:14px"><strong>Mensaje:</strong><br>${esc(mensaje).replace(/\n/g, '<br>')}</p>` : '')
    });

    res.json({ ok: true, mensaje: 'Solicitud enviada. Te vamos a contactar a la brevedad.' });
  } catch (err) {
    console.error('[asesoria] Error al enviar la solicitud:', err.message);
    res.status(500).json({ error: 'No pudimos enviar la solicitud. Intentá de nuevo en unos minutos.' });
  }
});

module.exports = router;
