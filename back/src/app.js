const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server: SocketIOServer } = require('socket.io');
const config = require('./config');
// 生产运行与公开发行分别检查；受邀体验由账号名单限制 HTTP 与实时连接。
if (config.nodeEnv === 'production') {
  require('./services/release-readiness').assertBackendDeploymentReady(config.deployment);
}
const routes = require('./routes');
const errorHandler = require('./middleware/error-handler');
const initArenaSocket = require('./socket/arena-handler');
const { createArenaRealtimeHub } = require('./socket/arena-realtime');
const db = require('./models/db');
const gameService = require('./services/game-service');
const PERIODIC_RECONCILE_INTERVAL_MS = 60000;
let periodicReconcileTimer = null;
const avatarReviewService = require('./services/avatar-review-service');

const app = express();

// 反向代理信任策略：仅当部署方显式设置 TRUST_PROXY 时才信任转发头，
// 避免默认信任 X-Forwarded-For 带来的来源 IP 伪造风险。
app.set('trust proxy', config.trustProxy);
if (config.nodeEnv === 'production' && config.trustProxy === false) {
  console.warn('[Config] TRUST_PROXY 未配置：若部署在 nginx/负载均衡之后，req.ip 会是代理地址，登录限速与审计日志将失真');
}

// ─── Middleware ───────────────────────────────────────────
app.use(cors({ origin: config.cors.origin }));
app.use(helmet());
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────
app.use('/api', routes);

// ─── Static: uploaded avatars ────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), {
  setHeaders(res) { res.setHeader('Cache-Control', 'private, no-store'); },
}));

// ─── Static: admin panel ─────────────────────────────────
const adminDistPath = path.resolve(__dirname, '../admin-web/dist');
const adminIndexPath = path.join(adminDistPath, 'index.html');
app.use('/admin', express.static(adminDistPath));
app.get('/admin/*', (_req, res, next) => {
  if (!fs.existsSync(adminIndexPath)) return next();
  return res.sendFile(adminIndexPath);
});

// ─── Error Handler (must be last) ────────────────────────
app.use(errorHandler);

// ─── HTTP + Socket.IO Server ─────────────────────────────
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: config.cors.origin,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);
const arenaRealtimeWs = createArenaRealtimeHub(server);
const arenaRealtime = {
  emitToSession(sessionId, event, data) {
    io.to(`arena:${sessionId}`).emit(event, data);
    arenaRealtimeWs.emitToSession(sessionId, event, data);
  },
  close() {
    arenaRealtimeWs.close();
  },
};
app.set('arenaRealtime', arenaRealtime);

// Initialize arena socket handlers
initArenaSocket(io);

let avatarCleanupRunning = false;
function cleanupExpiredAvatars() {
  if (avatarCleanupRunning) return;
  avatarCleanupRunning = true;
  avatarReviewService.expirePending()
    .catch(() => console.error('[AvatarReview] Expired media cleanup failed; it will be retried.'))
    .finally(() => { avatarCleanupRunning = false; });
}
const avatarCleanupTimer = setInterval(cleanupExpiredAvatars, 60 * 1000);
avatarCleanupTimer.unref();

server.on('close', () => {
  arenaRealtime.close();
  clearInterval(avatarCleanupTimer);
});

// ─── Start ───────────────────────────────────────────────
server.listen(config.port, () => {
  console.log(`[GameCodex] Server running on http://localhost:${config.port}`);
  console.log(`[GameCodex] Environment: ${config.nodeEnv}`);
  cleanupExpiredAvatars();

  // Startup reconciliation: sessions left as 'playing' by a previous process
  // (crash/restart) have no in-memory state and would freeze their players.
  // Mark them interrupted and roll the room back to waiting so nobody is stuck.
  gameService.reconcileOrphanSessions()
    .then((count) => {
      if (count > 0) {
        console.log(`[GameService] Reconcile done: ${count} orphaned session(s) marked interrupted`);
      }
    })
    .catch((err) => {
      console.error('[GameService] Reconcile error:', err);
    });

  // Periodic reconciliation: a failed start whose compensation also hit a DB
  // outage leaves a 'playing' row with no memory state. Re-run reconciliation
  // so such rooms recover without a process restart. Live in-memory games are
  // skipped by reconcileOrphanSessions, so this never ends an active match.
  periodicReconcileTimer = setInterval(() => {
    gameService.reconcileOrphanSessions().catch((err) => {
      console.error('[GameService] Periodic reconcile error:', err);
    });
  }, PERIODIC_RECONCILE_INTERVAL_MS);
  if (periodicReconcileTimer && typeof periodicReconcileTimer.unref === 'function') {
    periodicReconcileTimer.unref();
  }
});

// ─── Graceful shutdown ──────────────────────────────────
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[GameCodex] Received ${signal}, shutting down gracefully...`);
  if (periodicReconcileTimer) clearInterval(periodicReconcileTimer);

  const forceExit = setTimeout(() => {
    console.error('[GameCodex] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
  if (forceExit && typeof forceExit.unref === 'function') forceExit.unref();

  // Stop driving games / background jobs first so no tick can start a new
  // write while we drain.
  gameService.stopAllTimers();
  // Close both realtime hubs so open ws/socket.io connections do not keep
  // server.close() waiting until the force-exit timeout.
  try {
    if (typeof io.close === 'function') io.close();
  } catch (_err) {}
  arenaRealtime.close();

  server.close(() => {
    db.pool.end()
      .then(() => {
        clearTimeout(forceExit);
        process.exit(0);
      })
      .catch((err) => {
        console.error('[GameCodex] Error closing db pool:', err);
        process.exit(1);
      });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Export for testing
module.exports = { app, server, io };
