# Agent Office

A 2D pixel-art office where AI agents are small characters who think, walk to
their desks, work, and rest in the lounge. It is a working task dashboard: the
task list and the office are driven by the same simulation state.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # simulation, state machine and pathfinding tests
npm run build          # type-check + production build to dist/
npm run build:single   # one self-contained HTML file in dist-single/
npm run mock-backend   # reference backend on :8787 (fake progress, no AI)
GEMINI_API_KEY=... npm run backend   # real backend using Google Gemini
```

## Using it

- Drag to pan, scroll or pinch to zoom, arrow keys and +/- also work.
- Click a character or its desk to open the inspector. Clicking an agent in
  the directory focuses the camera on it.
- **New task** assigns work. A busy agent queues it; nothing is double-assigned.
- In Demo mode, put `[fail]` in a title to see a failure, then use **Retry task**.
- **Manage** shows full task and agent tables with logs and outputs.
- Demo agents, tasks, activity and settings persist in `localStorage`.

## Agent lifecycle

`IDLE → THINKING → WALKING → WORKING → COMPLETED → WALKING → SLEEPING`, with
`WAITING` (no route to the target yet, retried every second) and `ERROR`
(failed run; the agent stays at the desk briefly, then goes idle). Allowed
transitions live in `src/sim/agentMachine.ts`; invalid ones are rejected.
Each finished agent reserves its own rest spot (sofas, beanbags, armchairs,
floor cushions), and a new task wakes it up.

## Modes

**Demo** runs entirely in the browser. Task work is simulated with
deterministic durations and is labelled "simulated" everywhere. No AI model
is called.

**Real** talks to a backend at `VITE_API_BASE_URL` (see `.env.example`) or the
URL entered in Settings. The backend runs the actual work and holds provider
keys; the browser never sees them. Required endpoints:

| Method | Path | Body / returns |
|---|---|---|
| GET | `/api/agents` | `RemoteAgent[]` |
| POST | `/api/agents` | `{ name, role, provider?, model? }` → `RemoteAgent` |
| GET | `/api/tasks` | `RemoteTask[]` |
| POST | `/api/tasks` | `{ title, description, agentId }` → `RemoteTask` |
| GET | `/api/tasks/:id` | `RemoteTask` |
| POST | `/api/tasks/:id/cancel` | `RemoteTask` |
| GET | `/api/activity` | `{ t, level, msg, agentId?, taskId? }[]` |
| GET | `/api/events` | SSE stream, `event: task` with a `RemoteTask` |

Types are in `src/api/adapter.ts`. Activity history is loaded once on connect. If SSE is unavailable the client polls
`/api/tasks` every 3 s. CORS must allow the frontend origin.
`server/mock-backend.mjs` implements this contract with fake progress so you
can try Real mode; replace its `runTask()` with real provider calls.

## Deploying with Gemini (Docker + nginx)

`server/agent-backend.mjs` runs tasks on Google Gemini with an AI Studio key.
The Docker image builds the frontend and serves it together with `/api` from
one container, so nginx only needs to proxy a subdomain to it.

```bash
sudo install -m 600 /dev/null /etc/agent-office.env   # then put GEMINI_API_KEY=... in it
docker compose up -d --build                          # edit VITE_API_BASE_URL in docker-compose.yml first
```

`deploy/nginx-agent-office.conf` is the nginx site (TLS + basic auth). Keep the
password: anyone who reaches the backend can spend your Gemini quota.

## Let an agent work on your PC (runner)

An agent can read and change files on a computer you control, inside one folder
you choose. The PC runs a small program (`runner/`) that makes an **outbound**
connection to the server, so no ports or public IP are needed on the PC.

How it stays safe:
- The runner refuses any path outside the chosen work folder.
- Deletes go to the Recycle Bin, never a permanent erase.
- Reads, writes and common build/test/git commands run automatically; deletes,
  network commands and anything unusual pause for your **Approve/Deny** in the
  browser (`server/runner/tools.mjs` holds the policy).
- Set `RUNNER_TOKEN` on the server; each runner must present the same token.

Server: set `RUNNER_TOKEN` in `/etc/agent-office.env`, recreate the container.
PC: see `runner/README.md` — fill `runner.config.json`, run `node runner.mjs`,
then pick the PC under **Run on** when you create a task.

## Structure

```
src/
  sim/        map.ts (rooms, furniture, desks, rest spots) · pathfinding.ts (A*)
              agentMachine.ts (states) · engine.ts (simulation) · seed.ts
  store/      store.ts (single source of truth, rAF loop, persistence, adapters)
  api/        adapter.ts (contract) · demoAdapter.ts · httpAdapter.ts
  game/       pixelArt.ts (procedural sprites) · OfficeScene.ts (Phaser) · OfficeGame.tsx
  ui/         TopBar, Sidebar, AgentDirectory, TaskPanel, ActivityLog,
              AgentInspector, TaskForm, AgentEditor, ManagementView, Settings
server/       mock-backend.mjs
```

The simulation is plain TypeScript with no Phaser or React imports, so it is
unit-tested directly. Phaser only reads the store each frame and is mounted
once, so React re-renders never restart the game. All art is drawn
procedurally into canvases at startup; there are no image files.

## Limitations

- Capacity is 21 agents, one per desk.
- Real mode adopts only tasks that are queued or running when it connects.
- Characters wait for each other and walk around someone in the way, but in a
  one-tile gap with no way round they squeeze past after about a second rather
  than deadlock.
