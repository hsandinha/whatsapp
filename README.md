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

## Frontend no Vercel
O frontend pode ser publicado separadamente no Vercel usando o `vercel.json` deste repositório.

Rotas públicas:
- `/` -> `login.html`
- `/app` -> `index.html`
- `/admin` -> `admin.html`

Antes de publicar, ajuste [public/app-config.js](public/app-config.js):
- `APP_BASE_URL`: URL pública do frontend no Vercel
- `API_BASE_URL`: URL pública do backend

No backend, libere a origem do frontend:
```CORS_ALLOWED_ORIGINS=https://seu-frontend.vercel.app```
