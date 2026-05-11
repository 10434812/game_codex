const db = require('../models/db');

async function getDashboard() {
  const totalUsers = await db.queryOne('SELECT COUNT(*) as count FROM users');
  const todayGames = await db.queryOne("SELECT COUNT(*) as count FROM game_sessions WHERE DATE(started_at) = CURDATE()");
  const activeRooms = await db.queryOne("SELECT COUNT(*) as count FROM rooms WHERE status = 'playing'");
  const todayRevenue = await db.queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM coin_records WHERE DATE(created_at) = CURDATE() AND amount > 0");
  return {
    totalUsers: totalUsers?.count || 0,
    todayGames: todayGames?.count || 0,
    activeRooms: activeRooms?.count || 0,
    todayRevenue: todayRevenue?.total || 0,
  };
}
module.exports = { getDashboard };
