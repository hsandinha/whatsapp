# whatsapp-messaging-bot

## Install dependencies
```npm install```

## Run
```node index.js```

Frontend - localhost:3001

## Render
Se usar Web Service nativo no Render, use:

Build Command:
```npm run render:build```

Start Command:
```npm start```

Env recomendado:
```PUPPETEER_CACHE_DIR=/opt/render/project/.cache/puppeteer```

Mais confiável ainda: publicar como serviço Docker, já que o repositório já possui `Dockerfile` com Chromium configurado.
