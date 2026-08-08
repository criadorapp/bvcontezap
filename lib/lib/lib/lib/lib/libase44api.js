# BV.conte — Webhook Externo

Servidor Node.js que substitui a backend function `wasenderWebhook` da Base44, eliminando o erro HTTP 402 do plano gratuito.

## Arquitetura

```
WhatsApp → Wasender → [ESTE SERVIDOR no Render] → API REST Base44 → App
```

O banco de dados continua na Base44. Apenas o processamento das mensagens foi movido para cá.

## Deploy no Render.com

1. Crie um repositório no GitHub com os arquivos desta pasta (`server.js`, `package.json`, `.env.example`).
2. No Render, crie um **Web Service** conectando esse repositório.
3. Configure as variáveis de ambiente (copie de `.env.example`):
   - `BASE44_APP_ID` — ID do seu app na Base44 (na URL do editor)
   - `BASE44_API_TOKEN` — Token Service Role gerado nas configurações da Base44
   - `WASENDER_API_KEY`, `WASENDER_SECRET_KEY`, `WASENDER_BOT_PHONE` — do painel Wasender
   - `GROQ_API_KEY` — da sua conta Groq (para transcrição de áudio)
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Depois do deploy, copie a URL do Render (`https://seu-app.onrender.com/webhook`) e cole no painel do Wasender em Webhook URL.

## Variáveis Necessárias

| Variável | Onde obter |
|----------|-----------|
| `BASE44_APP_ID` | URL do editor Base44 |
| `BASE44_API_TOKEN` | Settings → API/Tokens na Base44 |
| `WASENDER_API_KEY` | Painel Wasender |
| `WASENDER_SECRET_KEY` | Painel Wasender |
| `WASENDER_BOT_PHONE` | Número do bot (formato 55DDDNNNNNNNN) |
| `GROQ_API_KEY` | console.groq.com → API Keys |

## Teste

Após o deploy, envie uma mensagem de teste via WhatsApp:
```
Gastei 50 no mercado
```

Se responder com a confirmação da transação, está funcionando.
