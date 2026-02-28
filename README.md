# Magazzino Add-on (esterno)

Repo separato per gestione articoli, stock, movimenti e draft preventivi, con push snapshot HMAC verso Segretaria AI.

## Setup rapido

1. Copia `.env.example` in `.env` e compila i valori.
2. Avvia Postgres:

```bash
docker compose up -d db
```

3. Applica migrazioni:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_segretaria_connection.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_segretaria_connection_rename_from_segreteria.sql
```

4. Avvia app:

```bash
npm install
npm run dev
```

## Endpoints principali

- `GET /health`
- `GET /app` (frontend Magazzino)
- `GET /api/items`
- `POST /api/items`
- `POST /api/stock/movements`
- `GET /api/drafts`
- `POST /api/drafts`
- `POST /api/drafts/:id/push-to-segretaria`
- `POST /api/integration/connect` (token one-time da Segretaria)
- `GET /api/integration/status`
- `GET /connect?token=...` (auto-connect via browser)

## Push verso Segretaria

`POST /api/drafts/:id/push-to-segretaria` crea snapshot e invia:

`POST {SEGRETARIA_BASE_URL}/api/integrations/magazzino/quotes/from-draft`

Headers inviati:
- `X-Provider: magazzino`
- `X-Workspace-Id`
- `X-Api-Key`
- `X-Timestamp`
- `X-Nonce`
- `X-Signature: sha256=...`

Firma su stringa: `${timestamp}.${nonce}.${rawBody}`

## Collegamento automatico (add-on a pagamento)

1. In Segretaria (admin), attiva add-on Magazzino.
2. In Settings Magazzino clicca `Connetti automaticamente`.
3. Si apre `http://localhost:3055/connect?...`: Magazzino scambia token one-time e salva chiavi nel DB.
4. Da quel momento `push-to-segretaria` usa la connessione salvata (fallback su env solo se mancante).

## Note

- Questo repo NON genera PDF/firme finali: resta responsabilità Segretaria.
- Lo stock è gestito con ledger (`stock_movements`) e `stock_levels` aggiornato in transazione.
