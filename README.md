# Arena Clash — real-time multiplayer battle game

Authoritative Node.js + WebSocket server, dependency-light browser client (Canvas 2D, ES modules, no build step).
The server also serves the client, so one service = one URL = HTTPS/WSS automatically.

## Run locally
```
npm install                 # Install
cp .env.example .env        # Configure environment (defaults work as-is)
npm start                   # Start server + client  → http://localhost:3000
```
Open the URL in two or more tabs/devices (same Wi-Fi: `http://<your-LAN-IP>:3000`):
1. **Create room** → note the 4-letter code · 2. **Join room** from other tabs with the code
3. Non-hosts press **Ready** · 4. Host presses **Start match** → 3-2-1 → fight.

`npm run dev` restarts on file changes. `npm test` starts the real server and plays a full match with 3 WebSocket bots
(joins, ready/start, combat, cheat attempts, disconnect/reconnect, results, play again).

## Deploy (production)

### Vercel UI + multiplayer server

The included vercel.json publishes the browser UI. The existing Node/WebSocket
server runs separately; rooms and the game simulation live in one server process.
Practice and tutorial modes also need this server.

1. Push the full project to GitHub, including package-lock.json.
2. Deploy it as a Render Web Service: Node runtime, build command npm ci,
   start command npm start, health check /health. Run one instance.
3. Import the same repository into Vercel. Use the folder containing package.json
   as the root. vercel.json sets Framework to Other, build command npm run build,
   install command npm ci, and output directory public automatically.
4. Set PUBLIC_WS_URL=wss://your-server.onrender.com in Vercel before deploying.
   Replace the hostname with your actual server. Set it for Production and any
   Preview environment you want to test.
5. Deploy Vercel. On the multiplayer server, set
   ALLOWED_ORIGINS=https://your-game.vercel.app and redeploy the server.
   Add custom domains or specific preview origins to this comma-separated list
   when needed. Use exact origins without trailing slashes.
6. Open the Vercel URL in two tabs and test creating, joining and playing a room.

The build copies only browser assets and /shared/game.js into public/ and
creates /config.js from PUBLIC_WS_URL. This address is public, not a secret.
Missing or insecure URLs fail the build. Changing the URL needs a new deployment.
Generated public/ output is ignored by Git. Do not publish the repository root.

To verify locally in PowerShell:

```powershell
$env:PUBLIC_WS_URL = 'wss://your-server.onrender.com'
npm.cmd run build
npm.cmd run test:deploy
```

The deployment test overwrites public/ with a test endpoint. Run your real build
again afterward if using its output. The build reads environment variables;
it does not load .env automatically. Local gameplay still uses npm start.

If the UI stays on RECONNECTING, check the server /health endpoint, the WSS
address in deployed /config.js, and ALLOWED_ORIGINS on the server.

### Node or Docker hosting

Any Node host (Render, Railway, Fly.io, a VPS). Start command `npm start`, build command `npm install`.
Docker: `docker build -t arena . && docker run -p 3000:3000 arena`. Health check: `GET /health`.
The platform's TLS gives `https://` and the client automatically uses `wss://` (no hard-coded URLs).

| Variable | Purpose |
|---|---|
| `PORT` | listen port (usually injected by the host) |
| `ALLOWED_ORIGINS` | comma-separated origins allowed to open WebSockets; empty = allow any origin |
| `PUBLIC_WS_URL` | only if client is hosted separately (e.g. `wss://api.example.com`); served to the client via `/config.js` |

Split deployment: host `client/` + `shared/` statically (keep the `/shared/game.js` path), deploy the server separately,
set `PUBLIC_WS_URL` on a `/config.js` for the static host and `ALLOWED_ORIGINS=https://your-client.example`.
Run one server instance (rooms are in memory; `Room` is isolated so state can later move to Redis with sticky sessions).

## Architecture
- `shared/game.js` — constants, arena, movement + collision (used by server AND client prediction)
- `server/index.js` — HTTP (static, `/health`, `/config.js`), WebSocket gateway, validation, rate limit, heartbeat, room reaper
- `server/room.js` — one room = one 30 Hz authoritative simulation (movement, bullets, damage, kills, respawn, phases, winner)
- `client/` — UI screens, input (keyboard/mouse/multi-touch), camera, rendering, particles (pooled), sound

**Multiplayer:** clients send only intent (`mx,my,aim,fire,dash`) ~30/s. The server simulates, and broadcasts snapshots at 30 Hz.
Clients predict their own movement with the shared `move()` and blend toward server position; other players are interpolated.
Damage, health, score, hits, dash cooldown, fire rate and winner are computed only on the server; client-sent values are clamped or ignored.
**Reconnect:** a per-player token is stored in `sessionStorage`; a dropped socket reconnects with backoff and keeps its player for 20 s.
**Scaling:** the world is 900×560 logical units. The visible area is constant (≈640×400 units) on every screen; the camera follows
you and adapts to aspect ratio, so large monitors get no advantage. Canvas uses `devicePixelRatio` (capped at 2) and a ResizeObserver.
**Mobile:** left half = floating move stick, right half = floating aim stick that fires, DASH button; multi-touch via pointer events; safe-area insets.

## Known limitations
No spectators / join-in-progress; no secondary ability; no configurable key bindings; no TypeScript/React (plain JS chosen for zero-build deploys);
single-process in-memory rooms; reload during a match does not auto-rejoin.

## Arena supplies
Three green health pickups restore 35 armor (up to 100). Only living, injured players can collect them; each recharges in 12 seconds. The HUD shows armor, dash cooldown and respawn time. Run `node test/supplies.js` to verify the pickup rules.

## Practice and device controls
Enter a nickname and choose **Practice with bots** for a match against two server-controlled opponents. **Learn to play** adds guided movement, shooting and dash tasks. Hosts can add or remove bots in the lobby; matches require at least two participants.

Pause to choose automatic, touch or keyboard/mouse controls, adjust joystick size, enable a separate fire button or switch to a left-handed layout. Preferences are saved on the device. Automatic controls adapt to the active pointer.

After refreshing, use **Rejoin previous room** within the 20-second disconnect window. Temporary network drops retry automatically; stale movement/fire stops after 300ms without input. The HUD reports round-trip latency.

Run **npm test** for supply rules, disconnect/rejoin and bot checks, and the multiplayer match simulation.

## Maps and match settings
The host can select Neon Yard (balanced cover), Crossfire (long lanes), or Reactor (flanking around pillars). The lobby previews cover, spawn points and health supplies. Match duration can be 1, 3 or 5 minutes; the kill target can be 5, 10 or 20. Changing settings resets human guest readiness, and settings lock when the countdown begins. Settings are shared with every player and restored on rejoin.

The selected map controls rendering, prediction, bot movement, server collision and supply placement. Combat feedback includes an aim crosshair, server-confirmed hit marker and damage numbers, incoming-fire direction and personal kill progress. `npm test` includes map geometry, rule validation, collision and feedback checks.

## Friends, touch controls and weapons
The home screen has Play with friends, Practice and Learn. In a lobby choose Invite friends to share a link (or copy it when sharing is unavailable). Invitation links fill the room code; joining still requires a nickname and an available room. For devices on the same Wi-Fi, open the game using the server computer LAN IP before sharing; localhost links only work on the computer running the server.

Mobile controls show resting joystick circles and move to your thumb when touched. The aim stick has a dead zone; optional separate fire and left-handed settings remain available in Pause.

Cannon (C): balanced shots, 10-round magazine. Shotgun (S): five short-range pellets per shell, 5-shell magazine. Rapid fire (R): fast, weaker shots, 24-round magazine. Collect labeled pads to equip a weapon; pads return after 15 seconds. Empty magazines reload automatically. Press R or tap RELOAD for a partial-magazine reload. Respawning restores the cannon. Weapon state, damage and reload timing are enforced by the server.

## Team play and interactive arenas
Choose free-for-all, 2 vs 2 (four participants) or 4 vs 4 (eight participants) in Match setup. Bots count toward team size. Teams are assigned evenly; blue and orange tanks share a team score. Friendly fire is disabled, including teammate barrel damage.

Crates block movement and bullets until destroyed. Barrels explode when destroyed, damaging nearby enemies and the shooter; spawn shields remain effective. Arena objects reset each match. Marked boost pads grant a short movement burst with a per-player cooldown.

Hold Shift or the BOOST button for sustained boost. Energy drains while boosting and recharges while resting; after depletion, release and recover at least 25 energy before boosting again. Space remains dash.

Bots have Easy, Normal and Hard difficulty, affecting aiming, firing and boost use. Pause offers saved volume, mute, vibration and graphics preferences. Low graphics reduces particles, shadows and canvas resolution. On touch devices, tap Scores to expand the scoreboard.

At match end, every human can choose Ready for rematch. Bots are ready automatically; the next countdown begins once all connected players are ready and the roster fits the selected mode. The host can choose Change match setup to return everyone to the lobby.
