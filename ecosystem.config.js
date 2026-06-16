// ecosystem.config.js — Configuración de PM2 para producción.
// Uso:  pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'tcv-logisuite-erp',
    script: 'server.js',
    instances: 1,            // subir a 'max' si se quiere usar todos los núcleos
    exec_mode: 'fork',       // 'cluster' si instances > 1
    autorestart: true,
    watch: false,            // no observar archivos en producción
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production'
    },
    // Logs (PM2 los rota con pm2-logrotate)
    error_file: 'logs/tcv-erp-error.log',
    out_file: 'logs/tcv-erp-out.log',
    merge_logs: true,
    time: true
  }]
};
