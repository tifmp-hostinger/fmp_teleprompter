#!/bin/sh
# Gera o config.js lido pelo navegador a partir das variáveis de ambiente.
# Rodado pelo entrypoint da imagem nginx antes de o servidor subir.
#
# Variáveis aceitas (todas opcionais):
#   PEER_HOST    domínio do seu servidor PeerJS (ex.: peer.seudominio.com)
#   PEER_PORT    porta (padrão 443)
#   PEER_PATH    caminho (padrão /)
#   PEER_SECURE  true|false (padrão true)
#   PEER_KEY     chave do servidor, se você configurou uma
#
# Sem PEER_HOST o controle remoto usa o servidor público do PeerJS.
set -eu

ROOT="${FMP_ROOT:-/usr/share/nginx/html}"

if [ -n "${PEER_HOST:-}" ]; then
  peer_key_json=""
  if [ -n "${PEER_KEY:-}" ]; then
    peer_key_json=$(printf ', "key": "%s"' "$PEER_KEY")
  fi
  peer_json=$(printf '{ "host": "%s", "port": %s, "path": "%s", "secure": %s%s }' \
    "$PEER_HOST" "${PEER_PORT:-443}" "${PEER_PATH:-/}" "${PEER_SECURE:-true}" "$peer_key_json")
  echo "[fmp] controle remoto via servidor PeerJS próprio: ${PEER_HOST}"
else
  peer_json="null"
fi

cat > "$ROOT/config.js" <<EOF
// Gerado automaticamente na inicialização do contêiner. Não edite à mão.
window.FMP_CONFIG = { peer: ${peer_json} };
EOF
