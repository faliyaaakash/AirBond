# AirBond — Setup & Startup Guide

AirBond is an account-free, peer-to-peer platform with two features today:

- **File sharing** — a NestJS signaling server (backed by Redis) brokers the initial
  WebRTC handshake between browsers; once connected, files transfer directly between
  peers over a WebRTC data channel — the server never sees file contents.
- **Chat** — login-free, ephemeral group chat rooms. Messages are relayed live through
  the signaling server over Socket.IO and are never stored anywhere. Only room metadata
  (name, private/password flag, creation time) is persisted, in MongoDB, and auto-expires
  2 hours after the room is created.

## Project structure

```
AirBond/
├── apps/
│   ├── signaling-server/   # NestJS + Socket.IO signaling server
│   │   └── src/rooms/
│   │       ├── files/       # WebRTC file-sharing signaling (Redis-backed)
│   │       └── chat/        # Chat rooms + messaging (Mongo-backed room metadata)
│   └── web/                # React + Vite client
│       └── src/
│           ├── webrtc/       # File-sharing peer connection logic
│           └── chat/         # Chat socket hook, UI, message formatting
├── packages/
│   └── shared/              # Shared TS types & constants (@airbond/shared)
├── infra/
│   ├── docker-compose.yml   # Redis + MongoDB (+ optional coturn) for local dev
│   └── coturn/               # TURN server config
└── package.json              # npm workspaces root
```

## Requirements

| Tool   | Version (tested) | Notes                                  |
|--------|-------------------|-----------------------------------------|
| Node.js | 22.x             | v20+ should also work                   |
| npm    | 10.x              | Workspaces are used — do not use yarn/pnpm |
| Docker | any recent        | Runs Redis + MongoDB (required) and optionally coturn |

### What Redis is used for

Redis is **not** an application database. It only holds ephemeral file-sharing
signaling state (which socket IDs are in which room), each key auto-expiring after
2 hours. No file data or user data is ever stored in it.

### What MongoDB is used for

MongoDB stores **chat room metadata only** — room name, private/password flag (bcrypt
hashed), and creation time. A TTL index auto-deletes each room's document 2 hours after
creation, and the server independently force-closes the room and disconnects everyone
in it at that same moment. **Chat messages themselves are never written to MongoDB, or
anywhere else** — they're relayed live over Socket.IO and only exist in the browser tabs
that were open to see them.

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
| `REDIS_HOST` / `REDIS_PORT`  | `localhost` / `6379`            | Redis connection (file-sharing signaling) |
| `MONGO_URI`                  | `mongodb://localhost:27017/airbond` | MongoDB connection (chat room metadata) |
| `CHAT_ROOM_TTL_SECONDS`      | `7200` (2 hours)                | How long a chat room lives before auto-closing |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | `turn:localhost:3478` / `airbond` / `changeme` | Passed to coturn config |
| `STUN_URL`                   | `stun:stun.l.google.com:19302`  | Public Google STUN fallback       |

| Variable (web) | Default | Purpose |
|-----------------|---------|---------|
| `VITE_SIGNALING_URL` | `http://localhost:4000` | Signaling server the client connects to |
| `VITE_STUN_URL` / `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | see `.env.example` | ICE server config used by `RTCPeerConnection` |

**Never commit real `.env` files** — they're gitignored. If you change TURN credentials
for anything beyond local dev, keep them out of version control.

## 3. Start Redis + MongoDB (required)

```bash
npm run dev:infra
```

This runs `infra/docker-compose.yml`, which starts Redis on `localhost:6379` and
MongoDB on `localhost:27017`. Both are required — Redis for file-sharing signaling
state, MongoDB for chat room metadata.

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

Open two browser tabs/windows at `http://localhost:5173` to test either feature:

- **File Share tab**: create a room in one tab, join it with the room ID in the other,
  then send a file.
- **Chat tab**: create a room (optionally private, with a password) in one tab, enter
  a stage name to join it; in the other tab, join the same room ID with a different
  stage name. You should see a join toast, typing indicators, and messages appear in
  both tabs live.

### Chat REST API

The chat module also exposes a small REST surface on the signaling server, used by the
web client to create/inspect rooms before opening a socket connection:

| Method & path              | Purpose                                      |
|-----------------------------|-----------------------------------------------|
| `POST /chat/rooms`          | Create a room. Body: `{ roomName, isPrivate, password? }` |
| `GET /chat/rooms/:roomId`   | Look up a room's public summary (name, private flag, participant count, expiry) |

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
- **`ECONNREFUSED` to Redis or MongoDB** — make sure `npm run dev:infra` (or `docker
  compose -f infra/docker-compose.yml up -d`) is running before starting the signaling
  server; both containers need to be up.
- **Peers connect but file transfer stalls** — likely a NAT traversal issue; both
  peers are behind a NAT that STUN can't punch through. Enable coturn (see step 3)
  and set matching `TURN_*` / `VITE_TURN_*` values.
- **"This chat room does not exist" right after creating it** — the room ID was
  probably mistyped/truncated on copy; double-check it matches exactly (case-sensitive,
  8 characters).
- **"This chat room has expired"** — chat rooms are hard-capped at `CHAT_ROOM_TTL_SECONDS`
  (2 hours by default) from creation; create a new one.
- **Running the signaling server's `npm run build` while `npm run dev:server` (watch
  mode) is also running** — both write to the same `apps/signaling-server/dist/`
  directory and can race, crashing the watch process with a `Cannot find module
  .../dist/main` error. Don't run both at once; if it happens, just restart
  `npm run dev:server`.
- **`npm install` conflicts inside `apps/web`** — the repo uses npm workspaces from the
  root; always run `npm install` from the repo root, not from inside `apps/web`.
