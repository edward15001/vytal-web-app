-- ============================================================
-- Vytal — Schema de Base de Datos
-- ============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Usuarios ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(100),
    -- Check-ins de progreso ("¿Cómo va ese progreso?")
    last_checkin_at      TIMESTAMPTZ,
    last_checkin_email_at TIMESTAMPTZ,
    -- Veces que el usuario ha regenerado su plan (restringido al tier free)
    plan_regeneration_count INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Respuestas del Cuestionario ────────────────────────────
CREATE TABLE IF NOT EXISTS questionnaire_answers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Métricas físicas
    age                 INTEGER NOT NULL,
    sex                 VARCHAR(10) NOT NULL CHECK (sex IN ('hombre', 'mujer')),
    weight_kg           DECIMAL(5,2) NOT NULL,
    height_cm           INTEGER NOT NULL,
    target_weight_kg    DECIMAL(5,2),
    -- Objetivos y estilo de vida
    goal                VARCHAR(50) NOT NULL CHECK (goal IN ('perder_peso', 'ganar_masa', 'mantener', 'mejorar_salud')),
    activity_level      VARCHAR(20) NOT NULL CHECK (activity_level IN ('sedentario', 'ligero', 'moderado', 'activo', 'muy_activo')),
    dietary_preference  VARCHAR(20) NOT NULL CHECK (dietary_preference IN ('omnivoro', 'vegetariano', 'vegano', 'sin_gluten', 'sin_lactosa')),
    -- Condiciones de salud (array de strings)
    health_conditions   TEXT[] DEFAULT '{}',
    -- Experiencia entrenamiento
    training_experience VARCHAR(20) DEFAULT 'principiante' CHECK (training_experience IN ('principiante', 'intermedio', 'avanzado')),
    training_days_per_week INTEGER DEFAULT 3,
    training_equipment  VARCHAR(20) DEFAULT 'mixto' CHECK (training_equipment IN ('casa', 'gimnasio', 'mixto')),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    -- Última vez que el usuario registró/actualizó sus valores
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    -- Sólo un registro de cuestionario por usuario
    UNIQUE(user_id)
);

-- ─── Planes de Nutrición ────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_plans (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Datos calculados
    daily_calories   INTEGER NOT NULL,
    protein_g        INTEGER NOT NULL,
    carbs_g          INTEGER NOT NULL,
    fat_g            INTEGER NOT NULL,
    -- Plan completo en JSON
    weekly_menu      JSONB NOT NULL DEFAULT '{}',
    training_plan    JSONB NOT NULL DEFAULT '{}',
    supplements      JSONB NOT NULL DEFAULT '[]',
    -- Notas dietéticas por condición de salud (array de strings)
    notas_dieta       JSONB NOT NULL DEFAULT '[]',
    -- Consejos generales mostrados en el dashboard (array de strings)
    consejos_generales JSONB NOT NULL DEFAULT '[]',
    generated_at     TIMESTAMPTZ DEFAULT NOW(),
    -- Sólo un plan activo por usuario
    UNIQUE(user_id)
);

-- ─── Suscripciones ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Stripe
    stripe_customer_id      VARCHAR(100),
    stripe_subscription_id  VARCHAR(100),
    stripe_payment_method_id VARCHAR(100),
    -- Fechas clave
    trial_start             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trial_end               TIMESTAMPTZ NOT NULL,          -- trial_start + TRIAL_DAYS (por defecto 7 días)
    cancel_window_end       TIMESTAMPTZ NOT NULL,          -- Coincide con trial_end: ventana de cancelación sin cargo
    charge_day              INTEGER NOT NULL,              -- Día del mes en que se cobra (1-28)
    next_billing_date       TIMESTAMPTZ,
    -- Estado
    status                  VARCHAR(20) NOT NULL DEFAULT 'trial'
                            CHECK (status IN ('trial', 'active', 'cancelled', 'expired', 'past_due')),
    cancelled_at            TIMESTAMPTZ,
    -- Avisos enviados
    trial_end_notified      BOOLEAN DEFAULT FALSE,
    charge_warning_notified BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- ─── Historial de Pagos ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_invoice_id VARCHAR(100),
    amount_eur      DECIMAL(8,2) NOT NULL,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('paid', 'failed', 'pending', 'refunded')),
    billing_period_start TIMESTAMPTZ,
    billing_period_end   TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Registro de comidas (diario alimentario / analizador móvil) ──
CREATE TABLE IF NOT EXISTS food_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Comida del plan a la que corresponde (desayuno/almuerzo/comida/merienda/cena)
    -- o NULL si es un extra fuera del plan
    meal_type     VARCHAR(20),
    -- Alimento reconocido (nombre corto) y macros estimados
    name          VARCHAR(200),
    calories      NUMERIC(8,2) NOT NULL DEFAULT 0,
    protein_g     NUMERIC(8,2) NOT NULL DEFAULT 0,
    carbs_g       NUMERIC(8,2) NOT NULL DEFAULT 0,
    fat_g         NUMERIC(8,2) NOT NULL DEFAULT 0,
    -- Cómo se registró (camera / barcode / manual)
    source        VARCHAR(20) NOT NULL DEFAULT 'camera',
    -- Resultado de la comparación con el plan ("dentro" / "fuera" / null)
    matches_plan  VARCHAR(10),
    -- Mensaje de la IA sobre si cuadra o no con el plan
    feedback      VARCHAR(500),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT food_log_matches_check CHECK (matches_plan IN ('dentro', 'fuera') OR matches_plan IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log(user_id, meal_date);

-- ─── Sesiones de entrenamiento registradas (app móvil) ──────
-- Duración real de la sesión completada, para mostrarla en el dashboard
-- web en vez de la estimación del plan.
CREATE TABLE IF NOT EXISTS training_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    -- Una sesión registrada por usuario y día (la app hace upsert)
    UNIQUE(user_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_user_date ON training_sessions(user_id, session_date);

-- ─── Índices ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_end ON subscriptions(trial_end);
CREATE INDEX IF NOT EXISTS idx_subscriptions_cancel_window_end ON subscriptions(cancel_window_end);
CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id);

-- ─── Trigger: updated_at automático ─────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
