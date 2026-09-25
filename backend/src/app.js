// backend/src/app.js
// Construye la aplicación Express: seguridad de red (proxy/CORS), JSON,
// landing comercial, archivos estáticos del frontend, API y SPA.
// No abre el puerto: eso lo hace backend/server.js.
const express = require('express');
const cors = require('cors');
const path = require('path');
const { montarRutasApi } = require('./rutas');

// Carpeta del frontend (HTML, CSS, JS e imágenes que se sirven tal cual).
// Se sirve como raíz estática, así que sus URLs públicas son /css/..., /js/..., /img/...
const DIR_FRONTEND = path.join(__dirname, '..', '..', 'frontend');

const app = express();

// Detrás de un reverse proxy (Nginx), confiar en la cabecera X-Forwarded-*
// para obtener el IP real del cliente y el protocolo (http/https).
app.set('trust proxy', 1);

// CORS: en producción se puede restringir a un dominio con la variable
// CORS_ORIGIN (ej. "https://erp.midominio.com"). Si no se define, se
// permite cualquier origen (útil en desarrollo).
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()) }));

app.use(express.json());

// Landing comercial en la raíz (debe registrarse ANTES de express.static,
// que de lo contrario serviría index.html en '/'). El sistema vive en /app.
app.get('/', (req, res) => {
  res.sendFile(path.join(DIR_FRONTEND, 'landing.html'));
});

app.use(express.static(DIR_FRONTEND));

// API REST (/api/*)
montarRutasApi(app);

// SPA para cualquier otra ruta
app.get('*', (req, res) => {
  res.sendFile(path.join(DIR_FRONTEND, 'index.html'));
});

module.exports = app;
