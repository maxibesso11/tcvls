# Imagen de TCV LogiSuite ERP (Node.js). La base MySQL corre en su propio
# contenedor (ver docker-compose.yml). Construir desde la raíz del proyecto:
#   docker compose build app
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencias primero: esta capa se reutiliza mientras package*.json no cambie.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./
COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts

# Nunca como root. docker-compose.yml fija además el uid/gid del usuario
# dedicado del servidor (tcvls).
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
