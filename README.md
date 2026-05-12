# AI Client Acquisition System — MVP

A scalable Node.js + SQLite backend for AI-powered B2B client outreach.

---

## Project Structure

```
ai-client-acquisition/
├── .env.example              # Environment variable template
├── .gitignore
├── package.json
├── README.md
└── server/
    ├── index.js              # Express app entry point
    ├── db/
    │   ├── connection.js     # SQLite singleton connection
    │   └── init.js           # Schema creation / migrations
    ├── routes/
    │   ├── health.js         # GET /api/health
    │   └── leads.js          # CRUD + AI actions for leads
    └── services/
        ├── healthService.js  # System health logic
        ├── leadsService.js   # Lead CRUD business logic
        └── aiService.js      # Anthropic API wrapper
```

---

## Quick Start

### 1. Prerequisites

- Node.js >= 18.x
- npm >= 9.x

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your `ANTHROPIC_API_KEY` (required for AI features).

### 4. Start the Server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

The server will:
- Auto-create the `data/` directory
- Auto-initialize the SQLite schema
- Start on `http://localhost:3000`

---

## API Reference

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System health check |

**Response**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "environment": "development",
  "uptime_seconds": 42,
  "services": {
    "database": { "ok": true, "message": "SQLite is connected and responsive" },
    "api": { "ok": true, "message": "Express API is running" }
  }
}
```

---

### Leads

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leads` | List all leads |
| GET | `/api/leads/:id` | Get lead by ID |
| POST | `/api/leads` | Create a new lead |
| PATCH | `/api/leads/:id` | Update a lead |
| DELETE | `/api/leads/:id` | Delete a lead |
| POST | `/api/leads/:id/score` | AI-score a lead (0–100) |
| POST | `/api/leads/:id/email` | Generate AI outreach email |

**Create Lead**
```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Smith","email":"jane@acme.com","company":"Acme Corp","source":"linkedin"}'
```

**AI Score a Lead**
```bash
curl -X POST http://localhost:3000/api/leads/<id>/score
```

**Generate Outreach Email**
```bash
curl -X POST http://localhost:3000/api/leads/<id>/email \
  -H "Content-Type: application/json" \
  -d '{"campaign_context":"Selling our SaaS analytics tool"}'
```

---

## Database

SQLite file is stored at `./data/database.sqlite` (gitignored).

Tables: `leads`, `campaigns`, `interactions`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment |
| `DB_PATH` | `./data/database.sqlite` | SQLite file path |
| `ANTHROPIC_API_KEY` | — | Required for AI features |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

---

## Scaling Roadmap

- [ ] Add JWT authentication middleware
- [ ] Add campaigns CRUD routes
- [ ] Add interactions logging
- [ ] Add bulk CSV lead import
- [ ] Add email sending via Resend/SendGrid
- [ ] Add Postgres adapter (swap `better-sqlite3` for `pg`)
- [ ] Add a React dashboard frontend
