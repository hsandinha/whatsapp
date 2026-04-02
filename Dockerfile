FROM node:20-slim

# Instala Chromium e dependências necessárias para whatsapp-web.js
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Define variável para o Puppeteer usar o Chromium do sistema
ENV NODE_ENV=production
ENV PORT=10000
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV WWEBJS_AUTH_DIR=/data/.wwebjs_auth
ENV DATA_DIR=/data/data
ENV UPLOADS_DIR=/data/uploads

WORKDIR /app

# Copia package.json primeiro para cache de dependências
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Copia o restante do projeto
COPY . .

# Cria diretórios necessários
RUN mkdir -p /data/data /data/uploads /data/.wwebjs_auth

EXPOSE 10000

CMD ["node", "index.js"]
