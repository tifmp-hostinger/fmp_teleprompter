# FMP Barzi Prompter — imagem estática para EasyPanel / Docker.
# O app é 100% front-end (HTML + CSS + ES modules), então basta um nginx
# servindo os arquivos com os cabeçalhos certos. Não há build step.
FROM nginx:1.27-alpine

# Node roda apenas o proxy da IA (opcional, ligado por variável de ambiente).
RUN apk add --no-cache nodejs

# Configuração do servidor (o entrypoint oficial faz envsubst de ${PORT}).
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template

# Entrypoints: servidor da plataforma e config.js de runtime.
COPY docker/30-fmp-server.sh /docker-entrypoint.d/30-fmp-server.sh
COPY docker/40-fmp-runtime-config.sh /docker-entrypoint.d/40-fmp-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/30-fmp-server.sh /docker-entrypoint.d/40-fmp-runtime-config.sh

# Servidor: contas, biblioteca compartilhada e gerador de IA.
# A chave da IA e as senhas ficam aqui dentro, nunca no navegador.
COPY server/ /app/server/
COPY js/ai-shared.js /app/js/ai-shared.js

# Onde os dados da equipe ficam. Monte um volume neste caminho, senão o
# arquivo é perdido a cada deploy.
ENV DATA_FILE=/data/barzi.json
VOLUME ["/data"]

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
