#!/bin/sh
# Sobe o servidor da plataforma (contas, biblioteca compartilhada e IA).
# Só roda se houver algo para servir: contas ativadas ou chave de IA.
set -eu

if [ -z "${ADMIN_EMAIL:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "[fmp] sem ADMIN_EMAIL nem chave de IA: o app roda 100% local no navegador"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[fmp] node não encontrado na imagem; contas e IA desativadas" >&2
  exit 0
fi

mkdir -p "$(dirname "${DATA_FILE:-/data/barzi.json}")"

# Reinicia sozinho se cair (a imagem não tem supervisor).
( while true; do
    node /app/server/index.mjs || true
    sleep 3
  done ) >/proc/1/fd/1 2>/proc/1/fd/2 &

echo "[fmp] servidor iniciado"
