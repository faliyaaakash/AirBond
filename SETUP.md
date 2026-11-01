# AirBond — Setup & Startup Guide

AirBond is an account-free, peer-to-peer platform with two features today:

- **File sharing** — a NestJS signaling server (backed by Redis) brokers the initial
  WebRTC handshake between browsers; once connected, files transfer directly between
  peers over a WebRTC data channel — the server never sees file contents.
- **Chat** — login-free, ephemeral group chat rooms. Messages are relayed live through
  the signaling server over Socket.IO and are never stored anywhere. Only room metadata
  (name, private/password flag, creation time) is persisted, in MongoDB, and auto-expires
  2 hours after the room is created.
- **Live Stream** — a broadcaster's camera or screen goes straight to viewers over WebRTC
  (peer-to-peer, same as file sharing), with live speech-to-text captions (interim +
  final, browser-native, never stored), a lightweight stream-chat sidebar, and single-heart
  reactions. Streams can be public or password-protected and appear in a live "what's on
  now" discovery list pushed to every connected browser. Entirely in-memory/ephemeral on
  the server — no MongoDB, no Redis, just Socket.IO room state — and auto-expires 2 hours
  after creation like everything else. Full group video calling (a real SFU) is a separate,
  not-yet-built feature; this is one broadcaster to N viewers over a WebRTC mesh, which
  scales to a handful of viewers, not a large audience.

## Project structure

```
AirBond/
├── apps/
│   ├── signaling-server/   # NestJS + Socket.IO signaling server
│   │   └── src/rooms/
│   │       ├── files/       # WebRTC file-sharing signaling (Redis-backed)
│   │       ├── chat/        # Chat rooms + messaging (Mongo-backed room metadata)
│   │       └── stream/      # Live stream signaling, captions, stream chat (in-memory)
│   └── web/                # React + Vite client
│       └── src/
│           ├── webrtc/       # File-sharing peer connection logic
│           ├── chat/         # Chat socket hook, UI, message formatting
│           └── stream/       # Live stream session hook, broadcaster/viewer UI
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

### What Live Stream uses

Nothing extra — no Redis, no MongoDB. Stream rooms (title, private/password flag, viewer
list, live captions, stream chat) live entirely in the signaling server's memory and are
gone the moment the stream ends or the server restarts, same 2-hour ephemeral ceiling as
everything else in this app.

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
- **Live Stream tab** (Chrome/Edge, for live captions): start a stream in one tab
  (grant camera/mic access); it should appear in the "Live now" list in the other tab,
  tagged Public or Private. Join it there — video should render within a couple of
  seconds, and speaking in the broadcaster tab should show live captions in the viewer
  tab. Try the mic/camera/screen-share toggles, stream chat, and reactions.

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
- **Testing camera/mic features (Live Stream, Video Call) from a phone on the same
  Wi-Fi** — `getUserMedia` requires a secure context, so you need `apps/web`'s HTTPS dev
  cert set up (see step 2) and the LAN IP it was generated for (`npm run dev:web` prints
  it as `Network: https://<ip>:5173`). Visit that exact URL on the phone, not
  `localhost`.
  - **Camera/mic permission denied with no popup ever appearing** on Android Chrome —
    this means Chrome already has a stored decision for the page, not a fresh prompt.
    Check two separate places: (1) the lock/info icon next to Chrome's address bar →
    Permissions → Camera/Microphone → Allow (or Chrome Settings → Site settings → All
    sites → the page → same), and (2) Android Settings → Apps → Chrome → Permissions →
    Camera/Microphone → Allow — if Chrome itself is blocked at the OS level, it won't
    even show the in-page prompt. The app itself now surfaces these exact steps inline
    when this error occurs (see `apps/web/src/components/PermissionDeniedHelp.tsx`).
  - **Still failing after both of those are Allowed** — likely the self-signed dev cert
    isn't trusted on the phone, which can make Chrome treat camera/mic as unavailable
    even with permissions granted. Install the CA once: send `infra/certs/rootCA.pem` to
    the phone, then Android Settings → Security → Encryption & credentials → Install a
    certificate → CA certificate → pick the file. Reload the page afterward; the address
    bar should show a trusted padlock instead of "Not secure".
- **Demoing on a network you don't control** (college/office Wi-Fi, a classroom) instead
  of your usual home network — several things are network-specific and need redoing:
  - **`VITE_TURN_URL`/`VITE_STUN_URL` pointing at a LAN IP** (e.g. your home coturn at
    `192.168.x.x:3478`) is unreachable from a different network entirely. `ICE_CONFIG`
    (`apps/web/src/webrtc/iceConfig.ts`) always also includes a free public TURN fallback
    (OpenRelay/Metered) for exactly this reason, so P2P/calls/streams still have a relay
    option even when the LAN one can't be reached — no `.env` change needed for this part.
  - **Cloudflare quick-tunnel URLs (`cloudflared tunnel --url ...`) are tied to the
    `cloudflared` process, not the network.** If that process is still running when you
    switch Wi-Fi, the same tunnel URL keeps working (it just reconnects). If your laptop
    sleeps/restarts between networks, you'll get brand-new random URLs when you restart
    `cloudflared` — update `VITE_SIGNALING_URL` in `apps/web/.env` to the new signaling
    tunnel URL and restart `npm run dev:web` before presenting.
  - **The biggest real risk is the network itself blocking peer-to-peer traffic** — many
    institutional Wi-Fi networks enable "client/AP isolation," which silently drops
    traffic directly between two devices on the same Wi-Fi at the access point itself.
    No STUN/TURN configuration fixes this (it's not a NAT problem, it's the AP refusing
    to forward the packets at all) — file transfers/calls/streams between two devices on
    that Wi-Fi will simply never connect. Test on the actual destination network ahead of
    time if at all possible. If it turns out to be isolated, the reliable fallback is
    putting both demo devices on one phone's personal mobile hotspot instead of the
    venue's Wi-Fi — that's a network you fully control and isolation won't be enabled.
