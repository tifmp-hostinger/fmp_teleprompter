# FMP Teleprompter — imagem estática para EasyPanel / Docker.
# O app é 100% front-end (HTML + CSS + ES modules), então basta um nginx
# servindo os arquivos com os cabeçalhos certos. Não há build step.
FROM nginx:1.27-alpine

# Configuração do servidor (o entrypoint oficial faz envsubst de ${PORT}).
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template

# Gera o config.js de runtime (servidor PeerJS próprio, se configurado).
COPY docker/40-fmp-runtime-config.sh /docker-entrypoint.d/40-fmp-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-fmp-runtime-config.sh

# Arquivos do app.
WORKDIR /usr/share/nginx/html
COPY index.html output.html remote.html manifest.webmanifest sw.js config.js ./
COPY css/ ./css/
COPY js/ ./js/
COPY icons/ ./icons/

# Porta do servidor. O EasyPanel costuma mapear a 80; altere com -e PORT=8080.
ENV PORT=80
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
