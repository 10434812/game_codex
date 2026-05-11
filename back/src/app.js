const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server: SocketIOServer } = require('socket.io');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/error-handler');
const initArenaSocket = require('./socket/arena-handler');

const app = express();

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(helmet());
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────
app.use('/api', routes);

// ─── Static: uploaded avatars ────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// ─── Static (admin panel, to be built later) ─────────────
// app.use('/admin', express.static(path.join(__dirname, '../admin/dist')));

// ─── Error Handler (must be last) ────────────────────────
app.use(errorHandler);

// ─── HTTP + Socket.IO Server ─────────────────────────────
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

// Initialize arena socket handlers
initArenaSocket(io);

// ─── Start ───────────────────────────────────────────────
server.listen(config.port, () => {
  console.log(`[GameCodex] Server running on http://localhost:${config.port}`);
  console.log(`[GameCodex] Environment: ${config.nodeEnv}`);
});

// Export for testing
module.exports = { app, server, io };
