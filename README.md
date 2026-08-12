# Cloudera Quiz Wheel

Spin-the-wheel quiz for Cloudera Evolve events. Player details and scores are stored in a local JSON file.

## Run locally

```bash
npm start
```

Open http://localhost:3000

## Player data file

All player records are read and written to:

```
data/players.json
```

Structure:

```json
{
  "nextId": 1,
  "gameResults": [],
  "leaderboard": [],
  "recentPlayerIds": []
}
```

Each completed quiz appends a record to `gameResults`. The server updates `leaderboard` (top 3) and `recentPlayerIds` (last 50) automatically.

## API

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

- Run via `npm start` — opening `index.html` directly in the browser will not persist data.
- `data/players.json` is gitignored (contains attendee PII). Back it up before events.
