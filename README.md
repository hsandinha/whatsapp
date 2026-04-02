# whatsapp-messaging-bot

## Install dependencies
```npm install```

## Run
```node index.js```

Frontend - localhost:3001

## Render Docker
Use o `render.yaml` deste repositório para criar um Web Service Docker com disco persistente.

Diretórios persistidos no disco:
`/data/.wwebjs_auth`
`/data/data`
`/data/uploads`

Variáveis secretas que você precisa informar no Render:
`SUPABASE_URL`
`SUPABASE_ANON_KEY`
`SUPABASE_SERVICE_KEY`

Health check:
`/healthz`

## Render nativo
Se insistir em usar runtime nativo em vez de Docker:

Build Command:
```npm run render:build```

Start Command:
```npm start```

Env recomendado:
```PUPPETEER_CACHE_DIR=/opt/render/project/.cache/puppeteer```
