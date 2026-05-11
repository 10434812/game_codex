# Learnings - Phase 4: Game Core Service

## Engine Integration Notes

### `playRound` Already Applies Events
The engine's `playRound(players, teams, options)` already calls `applyRoundEvents` internally and returns `{ events, players, teams }` with players already updated. Do NOT call `applyRoundEvents` again after `playRound` — that would double-apply score deltas. Just use `roundResult.players` and `roundResult.teams` directly.

### Event Property Names
Engine round events use `actorId` and `delta` properties, not `playerId` and `type`. The field name `actorId` must be used when iterating events for score logging.

### DB Idempotency
The `startGameSession` function checks for existing `game_sessions` and `game_players` before inserting, allowing it to be called safely even after `room-service.startGame` has already created the DB records. This avoids duplicate inserts while keeping the function self-contained.

## Socket.IO Pattern
- `socket.handshake.auth?.token` checks the auth object and `socket.handshake.query?.token` checks query params for JWT
- Socket middleware is registered via `io.use()` and runs before connection handlers
- Connected clients are tracked in a Map: `socket.id -> { userId, sessionId }`

## Route Conventions
- Follow `rooms.js` pattern: express router, `auth` middleware, `success`/`fail` response helpers
- Route file is auto-mounted by `routes/index.js` via `tryMount('/games', './games')`

---

# Learnings - Phase: Frontend API/Socket Integration

## Room Page API Migration
- **initRoom** calls `api.post('/rooms', { stageId: 1 })` → returns `{ id, roomCode }`
- **pollRoom** uses `setInterval(2s)` + `api.get('/rooms/:id')` to display player slots
- **onStartGame** calls `api.post('/rooms/:id/start')` → returns `{ sessionId }` → redirects to arena
- Existing `observeState`, `inviteFriend`, `toggleReady` preserved for backward compat — they become dead code once backend handles everything
- `clearPollTimer()` mirrors `clearStartCountdown()` pattern — setInterval ID tracked on `this.pollTimer`

## Room Page Local Fallback

- `onStartGame()` tries API first, falls back to `gameStore.startGame()` + `wx.redirectTo({url: '/pages/arena/index'})` on failure (e.g., 401 from localhost:3000)
- `onShow()` subscribes to `gameStore.subscribe()` and seeds `observeState(gameStore.getState())` so the page reacts to state changes (e.g., status → 'playing' → redirect to arena)
- `observeState` handles 'idle' → 'waiting' (via `ensureRoom`), 'playing' → redirect arena, 'finished' → redirect result

## Arena Page Socket.IO Integration
- WeChat mini-program sockets use `wx.connectSocket()` with URL `ws://localhost:3000?token=<jwt>`
- Arena page gets `sessionId` from URL query via `getCurrentPages()` pattern (same as result page)
- Socket events: `join_arena` (on open), `game_tick` → `syncArena()`, `time_update`, `game_finished`, `emote_broadcast`
- `handleGameTick` delegates to existing `syncArena()` — socket data must match gameStore state shape
- Emote sending: `sendEmoteViaSocket(emoteId)` sends `{ event: 'emote', data: { sessionId, emoteId } }`
- **Disconnect on hide/unload**: `socketTask.close({})` — called in both `onHide()` and `onUnload()`
- **Preservation rule**: All board-layout, team-link, investment, shop/userProfile integrations kept intact — only data flow changed from `gameStore.subscribe()` to socket `onMessage()`
