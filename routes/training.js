// ─── Vytal — routes/training.js ────────────────────────────
// Sesiones de entrenamiento registradas desde la app móvil: la app envía
// la duración real al terminar (o actualizar) una sesión, y el dashboard
// web la consulta para mostrarla en vez de la estimación del plan.

const express = require('express');
const router = express.Router();
const db = require('../db/db');
const authMiddleware = require('../middleware/auth');

// ─── POST /api/training/session ──────────────────────────────
// Body: { duration_min, date? } — upsert de la sesión del día (o de `date`
// si se pasa, formato YYYY-MM-DD). Pensado para que la app móvil la llame
// al terminar el entrenamiento.
router.post('/session', authMiddleware, async (req, res) => {
  const { duration_min, date } = req.body || {};

  if (typeof duration_min !== 'number' || !isFinite(duration_min) || duration_min <= 0) {
    return res.status(400).json({ error: 'duration_min inválido' });
  }

  try {
    const result = await db.query(
      `INSERT INTO training_sessions (user_id, session_date, duration_min)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3)
       ON CONFLICT (user_id, session_date)
       DO UPDATE SET duration_min = EXCLUDED.duration_min, updated_at = NOW()
       RETURNING session_date, duration_min`,
      [req.user.id, date || null, Math.round(duration_min)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error guardando sesión de entrenamiento:', err);
    res.status(500).json({ error: 'Error guardando la sesión' });
  }
});

// ─── GET /api/training/session/today ─────────────────────────
// Devuelve la sesión registrada hoy, o null si aún no se ha entrenado.
router.get('/session/today', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT session_date, duration_min FROM training_sessions
       WHERE user_id = $1 AND session_date = CURRENT_DATE`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Error obteniendo sesión de hoy:', err);
    res.status(500).json({ error: 'Error obteniendo la sesión' });
  }
});

module.exports = router;
