// server.js - Lanzador del ERP.
// El servidor real está en backend/server.js. Este archivo se mantiene en la
// raíz para que PM2 (ecosystem.config.js), systemd (deploy/erp.service), los
// scripts de npm y las guías de despliegue sigan funcionando sin cambios:
//   node server.js   |   pm2 start ecosystem.config.js
// Ejecutar siempre desde la raíz del proyecto (ahí vive el archivo .env).
require('./backend/server');
