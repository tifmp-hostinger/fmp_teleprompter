#!/bin/sh
# Sobe o proxy da IA quando há uma chave no ambiente do contêiner.
# Sem chave, nada roda e o app pede a chave no próprio navegador.
set -eu

if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "[fmp] sem OPENAI_API_KEY/ANTHROPIC_API_KEY: gerador de IA usará a chave do navegador"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[fmp] node não encontrado na imagem; proxy de IA desativado" >&2
  exit 0
fi

# Reinicia sozinho se cair (a imagem não tem supervisor).
( while true; do
    node /app/server/ai-proxy.mjs || true
    sleep 3
  done ) >/proc/1/fd/1 2>/proc/1/fd/2 &

echo "[fmp] proxy de IA iniciado"
