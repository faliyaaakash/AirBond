# AirBond — Setup & Startup Guide

AirBond is an account-free, peer-to-peer file-sharing platform built on WebRTC. A NestJS
signaling server (backed by Redis) brokers the initial handshake between browsers; once
connected, files transfer directly between peers over a WebRTC data channel — the server
never sees file contents.

## Project structure

```
AirBond/
├── apps/
│   ├── signaling-server/   # NestJS + Socket.IO signaling server
│   └── web/                # React + Vite client (WebRTC peer logic)
├── packages/
│   └── shared/              # Shared TS types & constants (@airbond/shared)
├── infra/
│   ├── docker-compose.yml   # Redis (+ optional coturn) for local dev
│   └── coturn/               # TURN server config
└── package.json              # npm workspaces root
```

## Requirements

| Tool   | Version (tested) | Notes                                  |
|--------|-------------------|-----------------------------------------|
| Node.js | 22.x             | v20+ should also work                   |
| npm    | 10.x              | Workspaces are used — do not use yarn/pnpm |
| Docker | any recent        | Runs Redis (required) and optionally coturn |

No database setup is required beyond Redis — see below.

### What Redis is used for

Redis is **not** an application database. It only holds ephemeral signaling state
(which socket IDs are in which room), each key auto-expiring after 2 hours. No file
data or user data is ever stored in it.

## 1. Install dependencies

From the repo root (this installs all workspaces — `apps/*` and `packages/*` — in one go):

```bash
npm install
```

## 2. Configure environment variables

Each app has an `.env.example` — copy it to `.env` and adjust if needed. Defaults work
out of the box for local development.

```bash
cp apps/signaling-server/.env.example apps/signaling-server/.env
cp apps/web/.env.example apps/web/.env
```

| Variable (signaling-server) | Default                        | Purpose                          |
|------------------------------|---------------------------------|-----------------------------------|
| `PORT`                       | `4000`                          | HTTP + Socket.IO port             |
| `REDIS_HOST` / `REDIS_PORT`  | `localhost` / `6379`            | Redis connection                  |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | `turn:localhost:3478` / `airbond` / `changeme` | Passed to coturn config |
| `STUN_URL`                   | `stun:stun.l.google.com:19302`  | Public Google STUN fallback       |

| Variable (web) | Default | Purpose |
|-----------------|---------|---------|
| `VITE_SIGNALING_URL` | `http://localhost:4000` | Signaling server the client connects to |
| `VITE_STUN_URL` / `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | see `.env.example` | ICE server config used by `RTCPeerConnection` |

**Never commit real `.env` files** — they're gitignored. If you change TURN credentials
for anything beyond local dev, keep them out of version control.

## 3. Start Redis (required)

```bash
npm run dev:infra
```

This runs `infra/docker-compose.yml`, which starts Redis on `localhost:6379`.

> **Note on TURN/coturn:** the `coturn` service in `infra/docker-compose.yml` is
> currently commented out. STUN alone (Google's public servers) is enough for most
> local/LAN testing — you only need a running TURN server if you're testing peers
> behind restrictive/symmetric NATs. Uncomment the `coturn` block in
> `infra/docker-compose.yml` if you need it; it uses `infra/coturn/turnserver.conf`.

## 4. Run the app in development

Option A — start everything at once (infra + server + web):

```bash
npm run dev
```

Option B — run pieces individually (useful when infra is already running):

```bash
npm run dev:server   # NestJS signaling server -> http://localhost:4000
npm run dev:web       # Vite dev server         -> http://localhost:5173
```

Open two browser tabs/windows at `http://localhost:5173` to test a transfer: create a
room in one tab, join it with the room ID in the other, then send a file.

## 5. Build for production

```bash
npm run build
```

Runs the build script in every workspace (`packages/shared` → type declarations,
`apps/signaling-server` → `dist/`, `apps/web` → static `dist/` via Vite).

## 6. Lint & format

```bash
npm run lint      # eslint across the repo
npm run format    # prettier --write
```

Each workspace also exposes its own `lint`/`format` scripts if you want to run them
scoped to just `apps/web` or `apps/signaling-server`.

## 7. Tests

The signaling server has Jest unit/e2e tests:

```bash
cd apps/signaling-server
npm run test        # unit tests
npm run test:e2e     # e2e tests
npm run test:cov     # coverage
```

`apps/web` does not currently have a test suite configured.

## Troubleshooting

- **Client can't connect to signaling server** — confirm `apps/signaling-server` is
  running on the port in `VITE_SIGNALING_URL` (default `4000`), and that
  `apps/signaling-server/.env` exists.
- **`ECONNREFUSED` to Redis** — make sure `npm run dev:infra` (or `docker compose -f
  infra/docker-compose.yml up -d`) is running before starting the signaling server.
- **Peers connect but file transfer stalls** — likely a NAT traversal issue; both
  peers are behind a NAT that STUN can't punch through. Enable coturn (see step 3)
  and set matching `TURN_*` / `VITE_TURN_*` values.
- **`npm install` conflicts inside `apps/web`** — the repo uses npm workspaces from the
  root; always run `npm install` from the repo root, not from inside `apps/web`.
