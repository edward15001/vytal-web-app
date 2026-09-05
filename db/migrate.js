/**
 * Vytal — Migraciones ligeras (idempotentes)
 * Se ejecutan al arrancar el servidor para que bases de datos existentes
 * reciban las nuevas columnas sin necesidad de recrear el schema.
 */
const db = require('./db');

const MIGRATIONS = [
  // Última vez que el usuario registró/actualizó sus valores
  `ALTER TABLE questionnaire_answers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,

  // Último check-in de progreso respondido por el usuario (in-app)
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ`,

  // Último email de check-in semanal enviado (para no duplicar avisos)
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin_email_at TIMESTAMPTZ`,

  // Equipamiento disponible para el entrenamiento (casa / gimnasio / mixto)
  `ALTER TABLE questionnaire_answers ADD COLUMN IF NOT EXISTS training_equipment VARCHAR(20) DEFAULT 'mixto'`,

  // Notas dietéticas y consejos generales del plan (se muestran en el dashboard)
  `ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS notas_dieta JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS consejos_generales JSONB NOT NULL DEFAULT '[]'`,

  // Contador de veces que el usuario ha regenerado su plan (restringe al tier free)
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_regeneration_count INTEGER NOT NULL DEFAULT 0`,

  // Diario alimentario (app móvil): comidas registradas con foto u otros métodos
  `CREATE TABLE IF NOT EXISTS food_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    meal_type     VARCHAR(20),
    name          VARCHAR(200),
    calories      NUMERIC(8,2) NOT NULL DEFAULT 0,
    protein_g     NUMERIC(8,2) NOT NULL DEFAULT 0,
    carbs_g       NUMERIC(8,2) NOT NULL DEFAULT 0,
    fat_g         NUMERIC(8,2) NOT NULL DEFAULT 0,
    source        VARCHAR(20) NOT NULL DEFAULT 'camera',
    matches_plan  VARCHAR(10),
    feedback      VARCHAR(500),
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log(user_id, meal_date)`,

  // Diario alimentario de la app móvil (analizador por cámara + descuento del día)
  `CREATE TABLE IF NOT EXISTS food_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    meal_type     VARCHAR(20),
    name          VARCHAR(200),
    calories      NUMERIC(8,2) NOT NULL DEFAULT 0,
    protein_g     NUMERIC(8,2) NOT NULL DEFAULT 0,
    carbs_g       NUMERIC(8,2) NOT NULL DEFAULT 0,
    fat_g         NUMERIC(8,2) NOT NULL DEFAULT 0,
    source        VARCHAR(20) NOT NULL DEFAULT 'camera',
    matches_plan  VARCHAR(10),
    feedback      VARCHAR(500),
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log(user_id, meal_date)`,

  // Sesiones de entrenamiento registradas desde la app móvil (duración real
  // de la sesión completada, para mostrarla en el dashboard web).
  `CREATE TABLE IF NOT EXISTS training_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_training_sessions_user_date ON training_sessions(user_id, session_date)`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_sessions_user_id_session_date_key') THEN
       ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_user_id_session_date_key UNIQUE (user_id, session_date);
     END IF;
   END $$`,

  // Sólo un registro de cuestionario y un plan por usuario (para el upsert ON CONFLICT).
  // PostgreSQL no soporta ADD CONSTRAINT IF NOT EXISTS, así que comprobamos pg_constraint.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questionnaire_answers_user_id_key') THEN
       ALTER TABLE questionnaire_answers ADD CONSTRAINT questionnaire_answers_user_id_key UNIQUE (user_id);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nutrition_plans_user_id_key') THEN
       ALTER TABLE nutrition_plans ADD CONSTRAINT nutrition_plans_user_id_key UNIQUE (user_id);
     END IF;
   END $$`,
];

async function runMigrations() {
  let failures = 0;
  for (const sql of MIGRATIONS) {
    try {
      await db.query(sql);
    } catch (err) {
      // Si la tabla aún no existe (BD recién creada sin schema.sql), se ignora:
      // schema.sql ya incluye estas columnas.
      if (err.code === '42P01' || err.code === '3F000') {
        console.warn('⚠️  Migración omitida (tabla aún no creada):', err.message);
      } else {
        failures++;
        console.error('❌ Error en migración:', err.message);
      }
    }
  }
  if (failures > 0) {
    console.error(`⛔ Migraciones con errores: ${failures}. La BD puede estar desactualizada — revisa DATABASE_URL.`);
  } else {
    console.log('✅ Migraciones de BD aplicadas');
  }
}

module.exports = { runMigrations };
