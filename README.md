# Cloudera Quiz Wheel

Spin-the-wheel quiz for Cloudera Evolve events. Player details and scores are stored in **Supabase**.

## Setup

### 1. Create Supabase tables

In your [Supabase dashboard](https://supabase.com/dashboard) → **SQL Editor**, run:

```
supabase/schema.sql
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your project credentials (Settings → API):

- `SUPABASE_URL` — Project URL
- `SUPABASE_SECRET_KEY` — **Secret key** (`sb_secret_...`) from **Secret keys** section

Do **not** use the publishable key (`sb_publishable_...`) — it cannot write to the database.

Legacy projects can use `SUPABASE_SERVICE_ROLE_KEY` (JWT starting with `eyJ...`) instead.

### 3. Install and run

```bash
npm install
npm start
```

Open http://localhost:3000

## Migrate existing local data

If you have records in `data/players.json` from the file-based version:

```bash
npm run migrate:local
```

## Database schema

| Table | Purpose |
|-------|---------|
| `game_results` | Player name, mobile, company, topic, score, accuracy |
| `app_metadata` | Leaderboard snapshot and recent player IDs |

## API

The frontend talks to the local server, which reads/writes Supabase:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/records` | List all player records |
| POST | `/api/records` | Save a new player result |
| PUT | `/api/records/:id` | Update a record |
| DELETE | `/api/records/:id` | Delete a record |
| GET | `/api/leaderboard` | Current top 3 |
| PUT | `/api/leaderboard` | Reset winners list |
| GET | `/api/recent` | Recent player IDs |
| DELETE | `/api/recent` | Clear recent list |

## Notes

- The service role key stays on the server in `.env` — do not commit it.
- Row Level Security is enabled on Supabase tables; the server bypasses it via the service role key.
