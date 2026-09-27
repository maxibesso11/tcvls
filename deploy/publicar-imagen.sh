#!/usr/bin/env bash
# ============================================================
# Publica la imagen de la app en Docker Hub (se corre en la PC de desarrollo,
# con Git Bash en Windows o bash en Linux/Mac).
#
#   deploy/publicar-imagen.sh              # publica el commit actual
#
# 1. Exige el árbol de git limpio: la imagen es exactamente un commit.
# 2. Corre los tests y la verificación de requires.
# 3. Construye la imagen desde ese commit (git archive), no desde la carpeta.
# 4. La sube como <imagen>:<commit> y <imagen>:latest.
# Después, en el servidor: sudo /opt/tcvls/deploy/desplegar.sh <commit>
#
# Credenciales: se usan las de este proyecto, guardadas aparte de las de
# Docker Desktop, así no se pisa la sesión de otros proyectos (GestionEJP).
#   ~/.docker-tcvls/credenciales   dos líneas: usuario y access token
#                                  (Docker Hub → Account settings →
#                                   Personal access tokens, permiso Read & Write)
# La imagen se toma de TCV_IMAGEN o de deploy/imagen.conf (ej. tcvlogisuite/tcvls-app).
# ============================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
fallar() { echo "✗ $*" >&2; exit 1; }

IMAGEN="${TCV_IMAGEN:-$(grep -E '^IMAGEN=' deploy/imagen.conf 2>/dev/null | cut -d= -f2- | tr -d ' \r')}"
[[ -n "$IMAGEN" ]] || fallar "Definí la imagen en deploy/imagen.conf (IMAGEN=usuario/tcvls-app) o en TCV_IMAGEN."

# Configuración de Docker propia del proyecto (no toca ~/.docker)
export DOCKER_CONFIG="$HOME/.docker-tcvls"
CRED="$DOCKER_CONFIG/credenciales"
[[ -f "$CRED" ]] || fallar "Falta $CRED con dos líneas: usuario de Docker Hub y access token."
USUARIO="$(sed -n 1p "$CRED" | tr -d '\r ')"
TOKEN="$(sed -n 2p "$CRED" | tr -d '\r ')"
[[ -n "$USUARIO" && -n "$TOKEN" ]] || fallar "$CRED debe tener el usuario en la primera línea y el token en la segunda."
umask 077
AUTH="$(printf '%s:%s' "$USUARIO" "$TOKEN" | base64 | tr -d '\n')"
printf '{ "auths": { "https://index.docker.io/v1/": { "auth": "%s" } } }\n' "$AUTH" > "$DOCKER_CONFIG/config.json"

[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fallar "Hay cambios sin commitear: la imagen tiene que salir de un commit."
COMMIT="$(git rev-parse --short HEAD)"
RAMA="$(git rev-parse --abbrev-ref HEAD)"
echo "→ Publicando $IMAGEN:$COMMIT (rama $RAMA: $(git log -1 --format=%s))"

echo "→ Tests"
npm test --silent >/dev/null || fallar "Fallan los tests (npm test)."
npm run verificar --silent || fallar "Falla la verificación (npm run verificar)."

echo "→ Construyendo desde el commit $COMMIT"
git -c core.autocrlf=false archive --format=tar HEAD \
  | docker build --pull -t "$IMAGEN:$COMMIT" -t "$IMAGEN:latest" \
      --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -

echo "→ Subiendo a Docker Hub"
docker push "$IMAGEN:$COMMIT"
docker push "$IMAGEN:latest"

echo
echo "✓ Publicada $IMAGEN:$COMMIT"
echo "  En el servidor: sudo /opt/tcvls/deploy/desplegar.sh $COMMIT"
