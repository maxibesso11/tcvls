// backend/src/middleware/seguridad.js
// Cabeceras de seguridad HTTP para todas las respuestas.
//
// Política de contenido (CSP): el sistema no carga nada de otros dominios, así
// que todo se limita al propio sitio. Se permiten scripts y estilos en línea
// porque el frontend usa onclick="…" y style="…" en el HTML generado; aun así
// la política impide cargar scripts externos, embeber el sistema en otro sitio
// y enviar datos a otros dominios.
//
// HSTS (obligar HTTPS) se envía solo cuando el pedido llegó por HTTPS: con
// Nginx delante, req.secure depende de X-Forwarded-Proto (trust proxy).
const POLITICA_CONTENIDO = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function cabecerasSeguridad(req, res, next) {
  res.setHeader('Content-Security-Policy', POLITICA_CONTENIDO);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure) {
    // 180 días, sin subdominios: fácil de revertir si hiciera falta.
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  next();
}

module.exports = { cabecerasSeguridad };
