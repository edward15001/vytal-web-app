// ─── Vytal — dashboard.js ─────────────────────────────────

// Helper de iconos SVG (definido en js/icons.js)
const ICON = (n, s) => (window.NV && NV.icon) ? `<span class="nv-icon">${NV.icon(n, s || 14)}</span>` : '';

const token = localStorage.getItem('vytal_token');
const user = JSON.parse(localStorage.getItem('vytal_user') || '{}');

// Redirigir si no hay sesión
if (!token) window.location.href = 'login.html';

let planData = null;
let subData = null;
let paymentHistory = [];
let todayLog = null;   // resumen del diario alimentario de hoy (/api/foodlog/today)

// ¿El usuario tiene acceso PRO? Proviene del campo access de /api/plan;
// para planes antiguos sin acceso, se deriva del estado de la suscripción.
function isProUser() {
  if (planData && planData.access) return planData.access.isPro;
  const s = subData;
  return !!s && ['trial', 'active', 'past_due'].includes(s.status);
}

// ═══ Init ════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  initTopbar();
  try {
    await Promise.all([loadPlan(), loadSubscription(), loadPaymentHistory()]);
    loadTodayLog(); // opcional: no bloquea el render si falla
    renderDashboard();
    // Check-in semanal: preguntar si lleva 7+ días sin actividad
    await checkCheckin();
  } catch (err) {
    console.error('Error inicializando el dashboard:', err);
    showDashboardError(err?.message || 'No se pudo cargar tu panel. Recarga la página e inténtalo de nuevo.');
  } finally {
    hideLoading();
  }
});

const DASHBOARD_REQUEST_TIMEOUT_MS = 15000;

async function fetchDashboard(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DASHBOARD_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('La carga está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function initTopbar() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('dashGreeting').textContent = `${greeting}, ${user.name?.split(' ')[0] || ''}`;
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Sidebar user info
  document.getElementById('sidebarName').textContent = user.name || '';
  document.getElementById('sidebarEmail').textContent = user.email || '';
  const initials = (user.name || 'N').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('sidebarAvatar').textContent = initials;

  // Mobile menu button: solo visible en pantallas pequeñas (el CSS lo gestiona,
  // pero el JS lo forzaba display:flex siempre — corregido)
  const mobileBtn = document.getElementById('mobileMenuBtn');
  if (mobileBtn) {
    // Fallback: inyectar el icono hamburguesa si la inyección automática no lo hizo
    if (!mobileBtn.innerHTML.trim() && window.NV?.icon) {
      mobileBtn.innerHTML = `<span class="nv-icon">${NV.icon('menu', 20)}</span>`;
    }
    if (window.innerWidth <= 768) {
      mobileBtn.style.display = 'flex';
    }
    // Escuchar cambios de tamaño por si el usuario redimensiona
    window.addEventListener('resize', () => {
      mobileBtn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
    }, { passive: true });
  }
}

// ═══ Cargar plan ════════════════════════════════════════════
// Resumen de hoy del diario alimentario (best-effort: si falla, el panel
// usa las kcal planificadas de hoy como progreso).
async function loadTodayLog() {
  try {
    const res = await fetch('/api/foodlog/today', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) todayLog = await res.json();
  } catch (err) {
    console.warn('foodlog/today no disponible:', err.message);
  }
}

async function loadPlan() {
  try {
    const res = await fetchDashboard('/api/plan', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 404) {
        // No tiene plan aún
        showNoPlanMessage();
        return;
      }
      throw new Error('Error cargando plan');
    }
    planData = await res.json();
  } catch (err) {
    console.error(err);
    throw err;
  }
}

// ═══ Cargar suscripción ══════════════════════════════════════
async function loadSubscription() {
  try {
    const res = await fetchDashboard('/api/subscription/status', {
      headers: { Authorization: `Bearer ${token}` }
    });
    subData = await res.json();
  } catch (err) {
    console.error('Error cargando suscripción:', err);
    subData = { status: 'none' };
  }
}

// ═══ Cargar historial de pagos ═══════════════════════════════
async function loadPaymentHistory() {
  try {
    const res = await fetchDashboard('/api/subscription/history', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    paymentHistory = data.payments || [];
  } catch (err) {
    console.error('Error cargando historial de pagos:', err);
    paymentHistory = [];
  }
}

// ═══ Renderizado principal ═══════════════════════════════════
function renderDashboard() {
  renderStatusBanner();
  if (planData) {
    renderOverview();
    renderNutritionTab();
    renderTrainingTab();
    renderSupplementsTab();
  }
  renderSubscriptionTab();

}

// ─── Status Banner ───────────────────────────────────────────
function renderStatusBanner() {
  const banner = document.getElementById('statusBanner');
  const badge = document.getElementById('bannerBadge');
  const title = document.getElementById('bannerTitle');
  const subtitle = document.getElementById('bannerSubtitle');
  const action = document.getElementById('bannerAction');

  if (!subData || subData.status === 'none') {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';

  if (subData.status === 'trial') {
    if (subData.phase === 'prueba_gratuita') {
      banner.className = 'status-banner trial';
      badge.textContent = 'PLAN PRO ACTIVO';
      title.textContent = subData.trial_end ? `Próximo cobro: ${fmt(subData.trial_end)}` : 'Pro activo';
      subtitle.textContent = '14 € · Pago mensual. Deja de pagar cuando quieras y vuelves al plan gratuito.';
      action.innerHTML = `<button class="btn-cancel" onclick="handleCancel()">Dejar de pagar</button>`;
    } else if (subData.phase === 'ventana_cancelacion') {
      banner.className = 'status-banner warning';
      badge.textContent = 'PRO ACTIVO';
      title.textContent = 'Tu plan Pro está activo';
      subtitle.textContent = '14 € · Pago mensual. Deja de pagar cuando quieras y vuelves al plan gratuito.';
      action.innerHTML = `<button class="btn-cancel" onclick="handleCancel()">Dejar de pagar</button>`;
    }
  } else if (subData.status === 'active') {
    banner.className = 'status-banner active';
    badge.textContent = 'PLAN PRO ACTIVO';
    title.textContent = subData.next_billing_date ? `Próximo cobro: ${fmt(subData.next_billing_date)}` : 'Pro activo';
    subtitle.textContent = '14 € · Pago mensual. Deja de pagar cuando quieras y vuelves al plan gratuito.';
    action.innerHTML = `<button class="btn-cancel" onclick="showTab('subscription', null)">Ver suscripción</button>`;
  } else if (subData.status === 'cancelled' || subData.status === 'expired') {
    banner.className = 'status-banner free';
    badge.textContent = 'PLAN GRATUITO';
    title.textContent = 'Estás en el plan gratuito';
    subtitle.textContent = 'Gratis para siempre. Actualiza a Pro cuando quieras.';
    action.innerHTML = `<button class="btn-gold" onclick="openUpgrade()">Actualizar a Pro</button>`;
  } else if (subData.status === 'past_due') {
    banner.className = 'status-banner warning';
    badge.textContent = 'PAGO PENDIENTE';
    title.textContent = 'Pago fallido';
    subtitle.textContent = 'Actualiza tu método de pago para continuar con tu plan.';
    action.innerHTML = '';
  }
}

// ─── Overview Tab (Bento Grid estilo dashboard premium) ──────

// Día seleccionado en el gráfico de calorías (null = media semanal)
let weekSelDay = null;

function selectWeekDay(i) {
  weekSelDay = (weekSelDay === i) ? null : i;
  renderOverview();
}

function renderOverview() {
  const { daily_calories, protein_g, carbs_g, fat_g, profile } = planData;
  const kcalBase = daily_calories || 1;
  const goalLabels = { perder_peso: 'Perder peso', ganar_masa: 'Ganar masa', mantener: 'Mantener', mejorar_salud: 'Mejorar salud' };
  const actLabels = { sedentario: 'Sedentario', ligero: 'Ligero', moderado: 'Moderado', activo: 'Activo', muy_activo: 'Muy activo' };
  const dietLabels = { omnivoro: 'Omnívoro', vegetariano: 'Vegetariano', vegano: 'Vegano', pescetariano: 'Pescetariano', sin_gluten: 'Sin gluten', sin_lactosa: 'Sin lactosa' };
  const goal = goalLabels[profile.goal] || profile.goal;
  const tips = planData.consejos_generales || [];
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const dayLetters = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  // kcal por día (desde el menú real de la semana). En modo free el backend
  // envía solo { _kcal } por día ("a oscuras", sin detalle de comidas).
  const weekKcal = days.map(d => {
    const menu = planData?.weekly_menu?.[d] || {};
    if (typeof menu._kcal === 'number') return menu._kcal;
    return Object.values(menu).reduce((sum, m) => sum + (m && m.calorias ? m.calorias : 0), 0);
  });
  const weekAvg = Math.round(weekKcal.reduce((a, b) => a + b, 0) / 7);
  const maxKcal = Math.max.apply(null, weekKcal.concat([kcalBase, 1]));
  const maxKcalWeek = Math.max.apply(null, weekKcal);
  const minKcalWeek = Math.min.apply(null, weekKcal);

  // Día seleccionado: muestra las kcal de ese día en vez de la media
  const selIdx = weekSelDay;
  const dispKcal = selIdx === null ? weekAvg : weekKcal[selIdx];

  // Progreso del día: kcal realmente registradas en el diario alimentario
  // (/api/foodlog/today); si no hay registro, kcal planificadas de hoy.
  const todayIdx = (new Date().getDay() + 6) % 7; // lun=0 … dom=6
  const loggedKcal = todayLog && todayLog.total ? Math.round(todayLog.total.calories || 0) : null;
  const consumedPct = loggedKcal !== null
    ? Math.min(100, Math.round((loggedKcal / kcalBase) * 100))
    : Math.min(100, Math.round(((weekKcal[todayIdx] || 0) / (kcalBase || 1)) * 100));
  const consumedNote = loggedKcal !== null
    ? `${consumedPct}% consumido hoy`
    : `${consumedPct}% del objetivo de hoy`;

  // Días de entreno: sesiones reales del plan, rellenadas hasta los días que
  // el usuario pidió en su perfil (para que el panel reaccione a sus cambios).
  const trainDays = (planData?.training_plan?.sesiones || []).map(s => s.dia);
  const reqDays = Math.min(7, Math.max(1, Number(profile.training_days_per_week) || trainDays.length || 3));
  const activeIdx = [];
  trainDays.forEach(d => { const i = days.indexOf(d); if (i !== -1 && !activeIdx.includes(i)) activeIdx.push(i); });
  for (let fill = 0; activeIdx.length < reqDays && fill < 7; fill++) {
    const candidate = Math.round((fill * 6) / (reqDays - 1 || 1));
    if (!activeIdx.includes(candidate)) activeIdx.push(candidate);
  }
  const activeSet = new Set(activeIdx);

  // Suplementos (top 4) — solo Pro; en free mostramos bloqueo
  const pct = g => Math.min(100, Math.max(0, Math.round((g * 4 / kcalBase) * 100)));

  // Distribución de macros: los tres segmentos SIEMPRE suman 100 exacto
  // (sin hueco en blanco). El % se calcula por kcal del macro (4/4/9 kcal/g),
  // redondeo con el residual absorbido por el último segmento (grasas).
  const kcalOf = { p: (protein_g || 0) * 4, c: (carbs_g || 0) * 4, f: (fat_g || 0) * 9 };
  const totalMacroKcal = kcalOf.p + kcalOf.c + kcalOf.f || 1;
  const distP = Math.round((kcalOf.p / totalMacroKcal) * 100);
  const distC = Math.round((kcalOf.c / totalMacroKcal) * 100);
  const dist = { p: distP, c: distC, f: 100 - distP - distC };

  document.getElementById('dashBento').innerHTML = `
    <!-- 01 · Tu perfil + kcal objetivo -->
    <div class="dg-panel dg-panel--perfil">
      <span class="dg-kicker">${ICON('target', 13)} Tu perfil</span>
      <h3 class="dg-goal">${goal}</h3>
      <div class="dg-fact-row">
        <span class="dg-fact">${ICON('scale', 13)} ${profile.weight_kg} → ${profile.target_weight_kg || profile.weight_kg} kg</span>
        <span class="dg-fact">${ICON('training', 13)} ${profile.training_days_per_week || 3} días/sem</span>
        <span class="dg-fact">${ICON('zap', 13)} ${actLabels[profile.activity_level] || profile.activity_level}</span>
      </div>
      <div class="dg-meta-row">
        <span>${dietLabels[profile.dietary_preference] || 'Omnívoro'}</span>
        <span>${profile.height_cm} cm</span>
        <span>${profile.age} años</span>
      </div>
      <div class="dg-kcal-block">
        <span class="dg-kcal-num">${kcalBase.toLocaleString('es-ES')}</span>
        <span class="dg-kcal-unit">kcal / día</span>
        <div class="dg-kcal-track"><div class="dg-kcal-fill" style="width:${consumedPct}%"></div></div>
        <span class="dg-kcal-note">${consumedNote}</span>
      </div>
    </div>

    <!-- 02 · Consejo de hoy -->
    <div class="dg-panel dg-panel--consejo">
      <span class="dg-kicker">${ICON('sparkles', 14)} Consejo de hoy</span>
      <p class="dg-tip">${tips[1] || tips[0] || 'Tu plan se ajusta cada semana a tu progreso real.'}</p>
    </div>

    <!-- 03 · Calorías de la semana -->
    <div class="dg-panel dg-panel--full dg-panel--kcal">
      <div class="dg-kcal-head">
        <div>
          <span class="dg-kicker">Calorías de la semana</span>
          <div class="dg-kcal-big">${dispKcal.toLocaleString('es-ES')}<span class="dg-kcal-sub">${selIdx === null ? 'kcal media / día' : 'kcal · ' + days[selIdx]}</span></div>
        </div>
        <div class="dg-day-picker">${dayLetters.map((l, i) => `<button type="button" class="dg-day${i === (selIdx === null ? todayIdx : selIdx) ? ' active' : ''}" onclick="selectWeekDay(${i})" aria-label="${days[i]}">${l}</button>`).join('')}</div>
      </div>
      <div class="dg-bars">
        ${weekKcal.map((k, i) => {
    const isSel = i === (selIdx === null ? todayIdx : selIdx);
    const h = Math.max(6, Math.round((k / maxKcal) * 100));
    return `<div class="dg-bar-col"><div class="dg-bar${isSel ? ' on' : ''}" style="height:${h}%"></div></div>`;
  }).join('')}
      </div>
      <div class="dg-foot">
        <span>Objetivo ${kcalBase.toLocaleString('es-ES')} kcal</span>
        <span>Máx. ${maxKcalWeek.toLocaleString('es-ES')} · Mín. ${minKcalWeek.toLocaleString('es-ES')}</span>
      </div>
    </div>

    <!-- 04 · Entrenamiento de la semana -->
    <div class="dg-panel dg-panel--entreno">
      <span class="dg-kicker">${ICON('training', 13)} Entrenamiento</span>
      <div class="dg-bars dg-bars--arcilla">
        ${days.map((d, i) => {
    const on = activeSet.has(i);
    return `
          <div class="dg-bar-col">
            <div class="dg-bar${on ? ' on' : ''}" style="height:${on ? 62 + (i % 3) * 12 : 14 + (i % 3) * 7}%"></div>
            <span class="dg-bar-day">${dayLetters[i]}</span>
          </div>`;
  }).join('')}
      </div>
      <div class="dg-entreno-foot">${ICON('trophy', 13)} Nivel ${capitalizeFirst(planData?.training_plan?.nivel || '')} · ${reqDays} sesiones/semana</div>
    </div>

    <!-- 05 · Distribución de macros -->
    <div class="dg-panel dg-panel--macros">
      <span class="dg-kicker">${ICON('chart', 13)} Distribución</span>
      <div class="dg-dist-bar">
        <div class="dg-dist-seg" style="width:${dist.p}%;background:var(--savia-500)" title="Proteína"></div>
        <div class="dg-dist-seg" style="width:${dist.c}%;background:var(--malva-500)" title="Carbohidratos"></div>
        <div class="dg-dist-seg" style="width:${dist.f}%;background:var(--ambar-500)" title="Grasas"></div>
      </div>
      <div class="dg-legend">
        <div class="dg-legend-row"><span class="dg-dot" style="background:var(--savia-500)"></span> Proteína <b>${protein_g} g · ${dist.p}%</b></div>
        <div class="dg-legend-row"><span class="dg-dot" style="background:var(--malva-500)"></span> Carbohidratos <b>${carbs_g} g · ${dist.c}%</b></div>
        <div class="dg-legend-row"><span class="dg-dot" style="background:var(--ambar-500)"></span> Grasas <b>${fat_g} g · ${dist.f}%</b></div>
      </div>
    </div>
  `;
}

// ─── Nutrition Tab: Calendario semanal con opciones ─────────
const CAL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const CAL_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const CAL_MEALS = [
  { key: 'desayuno', label: 'Desayuno', icon: 'sunrise' },
  { key: 'almuerzo', label: 'Almuerzo', icon: 'coffee' },
  { key: 'comida', label: 'Comida', icon: 'utensils' },
  { key: 'merienda', label: 'Merienda', icon: 'apple' },
  { key: 'cena', label: 'Cena', icon: 'moon' },
];

let calMenu = null;      // copia de trabajo del weekly_menu
let calOriginal = null;  // copia pristina (para restaurar)
let calSelectedDay = null;
let calOpenMeal = null;

function renderNutritionTab() {
  // El calendario detallado de comidas es exclusivo de Pro. En free mostramos
  // el bloqueo ("a oscuras": ve kcal del día pero no el detalle de comidas).
  if (!isProUser()) {
    document.getElementById('calWeek').innerHTML = '';
    document.getElementById('calDetail').innerHTML = `
      <div class="dg-empty">
        <div class="dg-empty-icon">${ICON('lock', 26)}</div>
        <div class="dg-empty-title">Nutrición detallada solo en Pro</div>
        <div class="dg-empty-sub">Actualiza a <b>Pro · 14 €/mes</b> para ver y personalizar el menú completo de cada día.</div>
        <a href="#" onclick="openUpgrade();return false;" class="btn-cta">Desbloquear a Pro →</a>
      </div>`;
    document.getElementById('calTotal').innerHTML = '';
    return;
  }
  calMenu = JSON.parse(JSON.stringify(planData.weekly_menu || {}));
  calOriginal = JSON.parse(JSON.stringify(calMenu));
  const today = CAL_DAYS[(new Date().getDay() + 6) % 7];
  calSelectedDay = calMenu[today] ? today : (calMenu['Lunes'] ? 'Lunes' : (Object.keys(calMenu)[0] || ''));
  calOpenMeal = null;
  renderCalWeek();
  renderCalDetail();
}

function calDayKcal(day, source) {
  const menu = source ? source[day] : calMenu[day];
  if (!menu) return 0;
  return CAL_MEALS.reduce((sum, m) => sum + (menu[m.key]?.calorias || 0), 0);
}

function calDaySwapped(day) {
  const a = calMenu[day] || {};
  const b = calOriginal[day] || {};
  return CAL_MEALS.some(m => a[m.key]?.nombre !== b[m.key]?.nombre);
}

function calMealSwapped(day, key) {
  return (calMenu?.[day]?.[key]?.nombre || '') !== (calOriginal?.[day]?.[key]?.nombre || '');
}

function renderCalWeek() {
  const el = document.getElementById('calWeek');
  el.innerHTML = CAL_DAYS.map((d, i) => {
    const kcal = calDayKcal(d);
    const swapped = calDaySwapped(d);
    return `
      <button class="cal-day${d === calSelectedDay ? ' active' : ''}${swapped ? ' swapped' : ''}" onclick="selectCalDay('${d}')">
        <span class="cal-day-letter">${CAL_LETTERS[i]}</span>
        <span class="cal-day-name">${d}</span>
        <span class="cal-day-kcal">${kcal ? kcal.toLocaleString('es-ES') + ' kcal' : '—'}</span>
        ${swapped ? '<span class="cal-swap-dot" title="Menú modificado"></span>' : ''}
      </button>`;
  }).join('');
}

function selectCalDay(day) {
  calSelectedDay = day;
  calOpenMeal = null;
  renderCalWeek();
  renderCalDetail();
}

function toggleCalOptions(key) {
  calOpenMeal = calOpenMeal === key ? null : key;
  renderCalDetail();
}

// Estimación de macros por comida: reparte los totales del día en
// proporción a las kcal de cada comida (no hay una base de datos de
// nutrientes por alimento, así que es una aproximación, no un dato medido).
function mealMacroLabel(mealKcal, dayKcal) {
  if (!dayKcal || !planData) return '';
  const share = mealKcal / dayKcal;
  const p = Math.round((planData.protein_g || 0) * share);
  const c = Math.round((planData.carbs_g || 0) * share);
  const f = Math.round((planData.fat_g || 0) * share);
  return `<span class="cal-meal-macros" title="Estimado a partir de las kcal de la comida">${p} P · ${c} C · ${f} G</span>`;
}

function renderCalDetail() {
  const day = calSelectedDay;
  const menu = calMenu[day];
  const detail = document.getElementById('calDetail');
  if (!menu) {
    detail.innerHTML = '<p style="color:var(--text-muted);padding:24px">No hay menú disponible para este día.</p>';
    return;
  }
  const kcal = calDayKcal(day);
  const origKcal = calDayKcal(day, calOriginal);
  const kcalDiff = kcal - origKcal;
  const swapped = calDaySwapped(day);

  const totP = Math.round((planData?.protein_g || 0) * (kcal / (planData?.daily_calories || 1)));
  const totC = Math.round((planData?.carbs_g || 0) * (kcal / (planData?.daily_calories || 1)));
  const totF = Math.round((planData?.fat_g || 0) * (kcal / (planData?.daily_calories || 1)));

  detail.innerHTML = `
    <div class="cal-detail-head">
      <div>
        <div class="cal-detail-kicker">${day.toUpperCase()} ${(new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })).toUpperCase()}</div>
        <div class="cal-detail-kcal-big">${kcal.toLocaleString('es-ES')} kcal<span class="cal-detail-goal"> en objetivo</span></div>
      </div>
      ${swapped ? `<button class="btn-line" onclick="restoreCalDay()">${ICON('rotateLeft', 14)} Restaurar el día</button>` : ''}
    </div>
    <div class="cal-meals">
      ${CAL_MEALS.map(m => {
    const meal = menu[m.key];
    if (!meal) return '';
    const open = calOpenMeal === m.key;
    const mealSwapped = calMealSwapped(day, m.key);
    const opts = CAL_DAYS.filter(o => o !== day && calMenu[o]?.[m.key]).map(o => ({ day: o, meal: calMenu[o][m.key] }));
    return `
        <div class="cal-meal${open ? ' open' : ''}${mealSwapped ? ' changed' : ''}">
          <div class="cal-meal-row">
            <span class="cal-meal-label"><span class="cal-meal-icon">${ICON(m.icon, 16)}</span>${m.label.toUpperCase()}</span>
            <div class="cal-meal-info">
              <span class="cal-meal-name">${meal.nombre}</span>
              ${mealMacroLabel(meal.calorias, kcal)}
              ${Array.isArray(meal.ingredientes) && meal.ingredientes.length ? `<span class="cal-meal-ing">${meal.ingredientes.join(', ')}</span>` : ''}
            </div>
            <span class="cal-meal-kcal">${meal.calorias}</span>
            <button class="cal-swap-btn" onclick="toggleCalOptions('${m.key}')">${ICON('refresh', 13)} Sustituir</button>
          </div>
          ${open ? `
          <div class="cal-options">
            <div class="cal-options-title">Elige otra opción para el ${m.label.toLowerCase()}:</div>
            <div class="cal-options-grid">
              ${opts.map(o => `
                <button class="cal-opt" onclick="applyCalSwap('${m.key}', '${o.day}')">
                  <span class="cal-opt-name">${o.meal.nombre}</span>
                  <span class="cal-opt-meta">${o.day.slice(0, 3)} · ${o.meal.calorias} kcal</span>
                </button>`).join('')}
              ${mealSwapped ? `
                <button class="cal-opt cal-opt--original" onclick="applyCalSwap('${m.key}', null)">
                  <span class="cal-opt-name">${ICON('rotateLeft', 12)} Volver a la original</span>
                  <span class="cal-opt-meta">${calOriginal[day]?.[m.key]?.nombre || ''}</span>
                </button>` : ''}
            </div>
          </div>` : ''}
        </div>`;
  }).join('')}
    </div>`;

  document.getElementById('calTotal').innerHTML = `
    <div class="cal-total-row">
      <span class="cal-total-label">TOTAL</span>
      <span class="cal-total-macros">${totP} P / ${totC} C / ${totF} G</span>
      <span class="cal-total-kcal">${kcal.toLocaleString('es-ES')}</span>
    </div>`;
}

async function applyCalSwap(mealKey, sourceDay) {
  const day = calSelectedDay;
  if (!calMenu[day]) return;
  const replacement = sourceDay
    ? calMenu[sourceDay]?.[mealKey]
    : calOriginal[day]?.[mealKey];
  if (!replacement) return;

  // Optimista: actualiza la vista al momento
  calMenu[day][mealKey] = JSON.parse(JSON.stringify(replacement));
  calOpenMeal = null;
  renderCalWeek();
  renderCalDetail();

  try {
    const res = await fetch('/api/plan/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ day, meal_key: mealKey, replacement })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    if (data.menu) {
      calMenu = data.menu;
      renderCalWeek();
      renderCalDetail();
    }
  } catch (err) {
    alert('No se pudo guardar el cambio: ' + (err.message || 'error de red'));
    renderNutritionTab();
  }
}

async function restoreCalDay() {
  const day = calSelectedDay;
  const changed = CAL_MEALS.filter(m => calMealSwapped(day, m.key)).map(m => m.key);
  for (const key of changed) {
    await applyCalSwap(key, null);
  }
  renderCalWeek();
  renderCalDetail();
}

// ─── Training Tab ────────────────────────────────────────────
const TRAIN_DAYS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const TRAIN_DAYS_ABBR = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

// "4x8 52kg" → { series: 4, reps: 8, peso: 52 } · null si no se puede parsear
function parseExerciseSpec(spec) {
  if (typeof spec !== 'string') return null;
  const m = spec.match(/(\d+)\s*x\s*(\d+)(?:\s*(?:x|@|\-)\s*([\d.,]+)\s*(?:kg)?)?/i);
  if (!m) return null;
  const peso = m[3] ? parseFloat(m[3].replace(',', '.')) : null;
  return { series: +m[1], reps: +m[2], peso: (peso && isFinite(peso)) ? peso : null };
}

// "casa" → "en casa" · "gimnasio" → "en gimnasio" · "mixto" → "casa y gimnasio"
function equipmentLabel(eq) {
  const labels = { casa: 'en casa', gimnasio: 'en gimnasio', mixto: 'casa y gimnasio' };
  return labels[(eq || '').toLowerCase()] || 'casa y gimnasio';
}

// Etiquetas y metadatos por tipo de sesión (nivel de esfuerzo para el mockup)
const SESSION_META = {
  descanso: { label: 'Libre', min: null },
  cardio: { label: 'Cardio', min: 35 },
  movilidad: { label: 'Movilidad', min: 20 },
  full_body: { label: 'Full body', min: 42 },
  'tren superior': { label: 'Superior', min: 48 },
  'tren inferior': { label: 'Inferior', min: 52 },
};

let trainView = 'week';   // 'week' | 'history'

function selectTrainView(v) {
  trainView = v;
  renderTrainingTab();
}

// Estima el volumen semanal (kg levantados) y el gasto calórico de las sesiones
function trainingStats(tp) {
  let volumen = 0;
  let ejercicios = 0;
  let series = 0;
  (tp.sesiones || []).forEach(s => {
    (s.ejercicios || []).forEach(e => {
      ejercicios++;
      const spec = parseExerciseSpec(e);
      if (!spec) return;
      series += spec.series;
      // Volumen = series × reps × peso (si hay peso estimado; si no, se omite)
      if (spec.peso) volumen += spec.series * spec.reps * spec.peso;
    });
  });
  const kcalSesion = 260 + Math.round(series * 4.5);
  return { volumen, ejercicios, series, kcalSesion };
}

function renderTrainingTab() {
  const tp = planData?.training_plan;
  if (!tp) {
    document.getElementById('trainingRoot').innerHTML = '';
    return;
  }

  const sessionByDay = {};
  (tp.sesiones || []).forEach(s => { sessionByDay[s.dia] = s; });
  const todayIdx = (new Date().getDay() + 6) % 7; // lun=0 … dom=6
  const todayName = TRAIN_DAYS_FULL[todayIdx];
  const todaySession = sessionByDay[todayName] || null;

  const dateStr = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const stats = trainingStats(tp);

  const weekCells = TRAIN_DAYS_FULL.map((d, i) => {
    const s = sessionByDay[d];
    const isToday = i === todayIdx;
    const meta = s ? null : (d === 'Sábado' ? SESSION_META.cardio : SESSION_META.descanso);
    const tipo = s ? s.tipo : (meta ? meta.label : 'Libre');
    const min = s ? (SESSION_META[s.tipo?.toLowerCase()]?.min || 45) : (meta ? meta.min : null);
    return `
      <div class="dg-week-cell${isToday ? ' on' : ''}">
        <span class="dg-week-name">${TRAIN_DAYS_ABBR[i]}${isToday ? ' · HOY' : ''}</span>
        <span class="dg-week-tipo">${capitalizeFirst(tipo)}</span>
        <span class="dg-week-min">${min ? min + ' min' : '—'}</span>
      </div>`;
  }).join('');

  // Ejercicios de la sesión de hoy (o de la primera sesión disponible)
  const sessionForTable = todaySession || (tp.sesiones || [])[0];
  const exRows = ((sessionForTable?.ejercicios || [])).map((e, i, arr) => {
    const spec = parseExerciseSpec(e);
    // Estado demostrativo: el último ejercicio completado, el siguiente en curso
    const state = i < arr.length - 2 ? 'done' : (i === arr.length - 2 ? 'doing' : 'pending');
    const name = e.replace(/\s*[x@\-]\s*[\d.,]+\s*kg.*$/i, '').replace(/\s*\d+\s*x\s*\d+.*$/, '').trim();
    const muscles = { sentadilla: 'Cuádriceps · glúteo', press: 'Pectoral · tríceps', remo: 'Dorsal · bíceps', peso: 'Isquiotibial · glúteo', plancha: 'Core' };
    const muscleKey = Object.keys(muscles).find(k => name.toLowerCase().includes(k));
    return `
      <tr class="${state}">
        <td>
          <div class="dg-ex-name">${name}</div>
          <div class="dg-ex-meta${state === 'doing' ? ' doing' : ''}">${state === 'doing' ? 'En curso · serie 2 de ' + (spec?.series || 4) : muscleKey ? muscles[muscleKey] : capitalizeFirst(sessionForTable?.tipo || '')}</div>
        </td>
        <td class="num">${spec?.series ?? '—'}</td>
        <td class="num">${spec?.reps ?? '—'}</td>
        <td class="num">${spec?.peso ? spec.peso + ' kg' : '—'}</td>
        <td class="num">${spec?.reps >= 12 ? '60 s' : '75 s'}</td>
        <td class="num"><span class="dg-ex-state ${state}">${ICON(state === 'done' ? 'checkCircle' : state === 'doing' ? 'stop' : 'clock', 15)}</span></td>
      </tr>`;
  }).join('');

  const notes = (tp.notas || [])[0];

  document.getElementById('trainingRoot').innerHTML = `
    <div class="dg-train-head">
      <div>
        <div class="dg-train-kicker">Semana ${new Date().toLocaleDateString('es-ES', { week: 'numeric' }) === '1' ? 4 : Math.min(4, Math.ceil(((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 24 * 3600 * 1000)) % 4 || 4))} · ${capitalizeFirst(tp.objetivo)}</div>
        <h2 class="dg-train-title">${tp.dias_semana} sesiones por semana</h2>
        <div class="dg-train-sub">${capitalizeFirst(tp.nivel)} · ${equipmentLabel(tp.equipamiento)}</div>
      </div>
      <div class="dg-toggle">
        <button class="${trainView === 'week' ? 'on' : ''}" onclick="selectTrainView('week')">Esta semana</button>
        <button class="${trainView === 'history' ? 'on' : ''}" onclick="selectTrainView('history')">Historial</button>
      </div>
    </div>

    <div class="dg-week">${weekCells}</div>

    <div class="dg-stats">
      <div class="dg-stat">
        <span class="dg-kicker">Sesión de hoy</span>
        <div class="dg-stat-num">${todaySession ? (SESSION_META[todaySession.tipo?.toLowerCase()]?.min || 45) + ' min' : '0 min'}</div>
        <div class="dg-stat-sub">${todaySession ? (todaySession.ejercicios || []).length + ' ejercicios · ' + (todaySession.ejercicios || []).reduce((n, e) => n + (parseExerciseSpec(e)?.series || 0), 0) + ' series' : 'Día libre · recuperación'}</div>
      </div>
      <div class="dg-stat">
        <span class="dg-kicker">Volumen semanal</span>
        <div class="dg-stat-num">${stats.volumen ? stats.volumen.toLocaleString('es-ES') + ' kg' : '—'}</div>
        <div class="dg-stat-sub up">Estimado con tu plan actual</div>
      </div>
      <div class="dg-stat">
        <span class="dg-kicker">Gasto estimado</span>
        <div class="dg-stat-num">${stats.kcalSesion} kcal</div>
        <div class="dg-stat-sub">Ya sumado a tu objetivo</div>
      </div>
    </div>

    ${trainView === 'week' ? `
    <div class="dg-session-head">
      <div class="dg-session-title">${capitalizeFirst(sessionForTable?.tipo || 'libre')} · ${dateStr}</div>
    </div>
    ${sessionForTable ? `
    <table class="dg-ex-table">
      <thead>
        <tr><th>Ejercicio</th><th class="num">Series</th><th class="num">Reps</th><th class="num">Peso</th><th class="num">Pausa</th><th class="num">Estado</th></tr>
      </thead>
      <tbody>${exRows}</tbody>
    </table>
    ${notes ? `
    <div class="dg-note-bar">${ICON('info', 15)} ${notes} <a href="#" class="btn-link" onclick="return false;">Ver alternativas →</a></div>` : ''}`
    : `<div class="dg-note-bar">${ICON('info', 15)} Hoy toca descansar. Aprovecha para recuperar: sueño, hidratación y movilidad ligera.</div>`}`
    : `
    <div class="dg-hist-head"><div class="dg-hist-title">Sesiones recientes</div></div>
    ${(tp.sesiones || []).slice(0, 4).map((s, i) => `
      <div class="dg-hist-row">
        <div><b>${capitalizeFirst(s.tipo)}</b> · ${s.dia}</div>
        <div class="dg-hist-meta">${(s.ejercicios || []).length} ejercicios · hace ${i + 1} sem</div>
      </div>`).join('')}`}
  `;
}

// ─── Supplements Tab ─────────────────────────────────────────
// Mapeo de momento de toma → hora del strip "Tu día, con las tomas"
const SUPP_MOMENTS = [
  { key: 'desayuno', label: 'Desayuno', hour: '08:00' },
  { key: 'media_mañana', label: 'Media mañana', hour: '11:00' },
  { key: 'comida', label: 'Comida', hour: '14:00' },
  { key: 'post_entreno', label: 'Post-entreno', hour: '19:30' },
  { key: 'cena', label: 'Cena', hour: '21:00' },
];

// Deduce cuándo tomar cada suplemento a partir de su motivo/dosis
function suppMoment(s) {
  const t = `${s.motivo || ''} ${s.dosis || ''}`.toLowerCase();
  if (t.includes('entreno') || t.includes('post') || t.includes('suero') || t.includes('prote')) return 'post_entreno';
  if (t.includes('comida') || t.includes('vitamina') || t.includes('d3') || t.includes('omega')) return 'desayuno';
  if (t.includes('cena') || t.includes('noche') || t.includes('magnesio')) return 'cena';
  return 'comida';
}

// Heurística de prioridad: opcional si el motivo lo sugiere
function suppPriority(s) {
  const t = (s.motivo || '').toLowerCase();
  if (t.includes('opcional') || t.includes('no es necesaria') || t.includes('si buscas')) return 'opcional';
  return 'prioridad alta';
}

function renderSupplementsTab() {
  // La suplementación es exclusiva de Pro
  if (!isProUser()) {
    document.getElementById('suppsRoot').innerHTML = `
      <div class="dg-empty">
        <div class="dg-empty-icon">${ICON('lock', 26)}</div>
        <div class="dg-empty-title">Suplementación solo en Pro</div>
        <div class="dg-empty-sub">Descubre qué suplementos encajan con tu plan actualizando a <b>Pro · 14 €/mes</b>.</div>
        <a href="#" onclick="openUpgrade();return false;" class="btn-cta">Desbloquear a Pro →</a>
      </div>`;
    return;
  }
  const supps = planData?.supplements || [];
  const icons = ['milk', 'sun', 'zap', 'flask', 'droplet', 'seedling', 'shield'];

  // Strip "Tu día": qué suplemento cae en cada franja horaria
  const daySlots = SUPP_MOMENTS.map(slot => {
    const taken = supps.filter(s => suppMoment(s) === slot.key);
    return `
      <div class="dg-day-slot${taken.length ? ' on' : ''}">
        <div class="dg-slot-hour">${slot.hour}</div>
        <div class="dg-slot-meal">${slot.label}</div>
        <div class="dg-slot-supp${taken.length ? '' : ' empty'}">${taken.length ? taken.map(s => `${s.nombre} ${s.dosis || ''}`).join('<br>') : '—'}</div>
      </div>`;
  }).join('');

  document.getElementById('suppsRoot').innerHTML = `
    <div class="dg-supp-head">
      <div class="dg-kicker" style="margin-bottom:10px;">Tu plan justifica ${supps.length} suplemento${supps.length === 1 ? '' : 's'}</div>
      <h2 class="dg-supp-title">Solo lo que tus números piden</h2>
      <p class="dg-supp-sub">Nada de listas de veinte productos. Estos cubren los huecos reales de tu dieta actual. Si tu plan cambia, la lista cambia.</p>
    </div>

    <div class="dg-supp-grid">
      ${supps.map((s, i) => `
        <div class="dg-supp-card">
          <div class="dg-supp-icon">${ICON(icons[i % icons.length], 20)}</div>
          <div class="dg-supp-priority${suppPriority(s) === 'opcional' ? ' optional' : ''}">${suppPriority(s) === 'opcional' ? 'Opcional' : 'Prioridad alta'}</div>
          <div class="dg-supp-name">${s.nombre}</div>
          <p class="dg-supp-why">${s.motivo || ''}</p>
          <hr class="dg-supp-divider">
          <div class="dg-supp-facts">
            <div><span class="dg-supp-fact-label">Dosis</span><span class="dg-supp-fact-value">${s.dosis || '—'}</span></div>
            <div style="text-align:right;"><span class="dg-supp-fact-label">Momento</span><span class="dg-supp-fact-value">${(SUPP_MOMENTS.find(m => m.key === suppMoment(s)) || {}).label || 'Indiferente'}</span></div>
          </div>
        </div>`).join('')}
    </div>

    <div style="padding:24px 32px 0;"><div class="dg-hist-title" style="margin-bottom:2px;">Tu día, con las tomas</div></div>
    <div class="dg-day-strip">${daySlots}</div>

    <div class="dg-disclaimer">
      ${ICON('warning', 16)} Estas sugerencias no sustituyen el consejo de un médico o farmacéutico. Si tomas medicación o tienes una condición diagnosticada, consúltalo antes de empezar.
    </div>
  `;
}

// ─── Subscription Tab ────────────────────────────────────────
function renderSubscriptionTab() {
  const noSubscription = !subData || subData.status === 'none';
  const { status } = subData || {};

  // El usuario no cancela nada: o decide no pagar (plan gratuito, gratis para
  // siempre) o decide pagar (Pro). Sin suscripción y con estado 'cancelled' /
  // 'expired' se muestran todos como el plan gratuito.
  const isFree = noSubscription || status === 'cancelled' || status === 'expired';
  const price = subData?.plan_price_eur || 14;

  // Tarjeta real (últimos 4 dígitos + marca + caducidad) desde el backend;
  // si el cliente no tiene método de pago guardado, mostramos un estado neutro.
  const card = subData?.card || {};
  const cardBrand = ({ visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', unionpay: 'UnionPay' }[card.brand]) || 'Tarjeta';
  const cardExp = card.exp_month && card.exp_year ? `caduca ${card.exp_month}/${String(card.exp_year).slice(-2)}` : null;

  const fmtShort = d => d
    ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const histRows = paymentHistory.slice(0, 6).map(p => `
    <tr>
      <td>${fmtShort(p.paid_at || p.billing_period_start)}</td>
      <td>Plan Pro · mensual</td>
      <td class="num">${p.amount_eur} €</td>
      <td class="${p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'err' : ''}">${{ paid: 'Pagado', failed: 'Fallido', pending: 'Pendiente', refunded: 'Reembolsado' }[p.status] || p.status}</td>
    </tr>`).join('');

  document.getElementById('subRoot').innerHTML = `
    <div class="dg-sub-top">
      <div class="dg-sub-plan">
        <div class="dg-sub-plan-head">
          <span class="dg-sub-kicker">Plan actual</span>
          <span class="dg-active-chip${isFree ? ' off' : ''}">${isFree ? 'FREE' : 'ACTIVO'}</span>
        </div>
        <h2 class="dg-sub-name">${isFree ? 'Free' : 'Pro'}</h2>
        <div class="dg-sub-price">${isFree ? '0 € / siempre' : `${price} € / mes · sin permanencia`}</div>
        <div class="dg-sub-facts">
          <div class="dg-sub-fact"><span>Próximo cobro</span><b>${isFree ? '—' : fmtShort(subData.next_billing_date || subData.trial_end)}</b></div>
          <div class="dg-sub-fact"><span>Estado</span><b>${isFree ? 'Sin pago' : 'Activa'}</b></div>
        </div>
      </div>
      <div class="dg-sub-pay">
        <span class="dg-sub-kicker">Método de pago</span>
        <div class="dg-pay-box" style="margin-top:12px;">
          ${ICON('subscription', 20)}
          <div>
            <div class="dg-pay-num">${card.last4 ? `•••• •••• •••• ${card.last4}` : '•••• •••• •••• ••••'}</div>
            <div class="dg-pay-meta">${cardBrand}${cardExp ? ` · ${cardExp}` : ''}${card.last4 ? '' : ' · sin tarjeta guardada'}</div>
          </div>
        </div>
        <div class="dg-pay-actions">
          <a href="https://billing.stripe.com/p/login/" target="_blank" rel="noopener" class="btn-line">Cambiar tarjeta</a>
          <a href="#" class="btn-link" onclick="return false;">Descargar facturas</a>
        </div>
      </div>
    </div>

    ${paymentHistory.length ? `
    <div class="dg-hist-head"><div class="dg-hist-title">Historial de facturación</div></div>
    <div class="dg-hist-box">
      <table class="dg-table">
        <thead>
          <tr><th>Fecha</th><th>Concepto</th><th class="num">Importe</th><th>Estado</th></tr>
        </thead>
        <tbody>${histRows}</tbody>
      </table>
    </div>` : ''}

    <div class="dg-cancel">
      <div>
        <div class="dg-cancel-title">${isFree ? 'Tu plan gratuito' : 'Cancelar la suscripción'}</div>
        <div class="dg-cancel-sub">${isFree
    ? 'El plan gratuito es gratis para siempre. Actualiza a Pro para desbloquear el menú detallado, la suplementación y los check-ins.'
    : `Mantienes el acceso hasta el ${fmtShort(subData?.next_billing_date)}. Después pasas a Free y conservas tu cálculo metabólico y tu historial.`}</div>
      </div>
      ${isFree
    ? `<button class="btn-cta" onclick="openUpgrade()">${ICON('sparkles', 15)} Actualizar a Pro · ${price} €/mes</button>`
    : `<button class="btn-outline-danger" onclick="handleCancel()">Cancelar plan</button>`}
    </div>
  `;
}

// ═══ Dejar de pagar ══════════════════════════════════════════
async function handleCancel() {
  if (!confirm('¿Quieres dejar de pagar y volver al plan gratuito?')) return;

  try {
    const res = await fetch('/api/subscription/cancel', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Error al dejar de pagar');
      return;
    }

    alert('Has vuelto al plan gratuito. Puedes actualizar a Pro cuando quieras.');
    await loadSubscription();
    renderStatusBanner();
    renderSubscriptionTab();
  } catch (err) {
    alert('Error de conexión');
  }
}

// ═══ Check-in semanal ════════════════════════════════════════
async function checkCheckin() {
  if (!planData) return; // Solo si tiene plan
  try {
    const res = await fetch('/api/checkin/status', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.due) {
      document.getElementById('checkinOverlay').style.display = 'flex';
    }
  } catch (err) {
    console.error('Error comprobando check-in:', err);
  }
}

async function checkinAllGood() {
  try {
    await fetch('/api/checkin/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ response: 'all_good' })
    });
  } catch (err) {
    console.error(err);
  }
  hideCheckinModal();
}

async function checkinWantChange() {
  try {
    await fetch('/api/checkin/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ response: 'want_change' })
    });
  } catch (err) {
    console.error(err);
  }
  window.location.href = 'questionnaire.html?update=1';
}

function hideCheckinModal() {
  document.getElementById('checkinOverlay').style.display = 'none';
}

// ═══ Tabs ════════════════════════════════════════════════════
function showTab(tabId, linkEl) {
  ['overview', 'nutrition', 'training', 'supplements', 'subscription'].forEach(id => {
    const el = document.getElementById(`tab-${id}`);
    if (el) el.style.display = id === tabId ? 'block' : 'none';
  });
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');
  // Auto-cerrar sidebar en mobile
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('open');
  return false;
}

// ═══ Utils ═══════════════════════════════════════════════════
function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function capitalizeFirst(str = '') {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

function showDashboardError(message) {
  const main = document.querySelector('.dashboard-main');
  if (!main) return;
  main.innerHTML = `
    <div style="text-align:center;padding:80px 24px;">
      <h2 style="font-size:24px;font-weight:800;margin-bottom:10px;">No se pudo cargar el panel</h2>
      <p style="color:var(--text-muted);margin-bottom:28px;">${message}</p>
      <button class="btn-gold-large" onclick="window.location.reload()">Reintentar</button>
    </div>
  `;
}

function showNoPlanMessage() {
  const main = document.querySelector('.dashboard-main');
  main.innerHTML = `
    <div style="text-align:center;padding:80px 24px;">
      <div style="font-size:48px;margin-bottom:20px;color:var(--gold);display:flex;justify-content:center;">${ICON('clipboard', 44)}</div>
      <h2 style="font-size:24px;font-weight:800;margin-bottom:10px;">Aún no tienes un plan</h2>
      <p style="color:var(--text-muted);margin-bottom:28px;">Completa el cuestionario para recibir tu plan personalizado</p>
      <a href="questionnaire.html" class="btn-gold-large">Crear mi plan →</a>
    </div>
  `;
}

function logout() {
  localStorage.removeItem('vytal_token');
  localStorage.removeItem('vytal_user');
  window.location.href = 'index.html';
}

// ═══ Upgrade a Pro (Stripe) ═══════════════════════════════════
let upgradeStripe = null;
let upgradeCardElement = null;
let upgradeSetupSecret = null;
let upgradePendingSubscriptionId = null;
let upgradeInitialized = false;

// Abre el modal de pago para pasar de free a Pro. Si Stripe aún no está
// cargado o el modal no está listo, se inicializa bajo demanda.
function openUpgrade() {
  const overlay = document.getElementById('upgradeOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  initUpgradeCheckout();
}

function closeUpgrade() {
  document.getElementById('upgradeOverlay').style.display = 'none';
}

async function initUpgradeCheckout() {
  if (upgradeInitialized) return;
  if (typeof Stripe === 'undefined') {
    const errEl = document.getElementById('upgradeCardErrors');
    errEl.textContent = 'El sistema de pago seguro no se cargó. Recarga la página e inténtalo de nuevo.';
    errEl.style.display = 'block';
    return;
  }
  try {
    document.getElementById('upgradeSubmitBtn').disabled = true;
    const res = await fetch('/api/subscription/intent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      const errEl = document.getElementById('upgradeCardErrors');
      errEl.textContent = data.error || 'No se pudo preparar el pago. Inténtalo en unos minutos.';
      errEl.style.display = 'block';
      return;
    }

    upgradeSetupSecret = data.client_secret;
    upgradePendingSubscriptionId = data.subscription_id;
    upgradeStripe = Stripe(data.publishable_key);
    upgradeCardElement = upgradeStripe.elements().create('card', {
      style: {
        base: {
          color: '#e8e0d0',
          fontFamily: "'Outfit', sans-serif",
          fontSize: '16px',
          '::placeholder': { color: '#888880' },
        },
        invalid: { color: '#e55b5b' },
      },
    });
    upgradeCardElement.mount('#upgradeCardElement');
    upgradeCardElement.on('change', (e) => {
      const errEl = document.getElementById('upgradeCardErrors');
      if (e.error) {
        errEl.textContent = e.error.message;
        errEl.style.display = 'block';
      } else {
        errEl.style.display = 'none';
      }
    });
    upgradeInitialized = true;
    document.getElementById('upgradeSubmitBtn').disabled = false;
  } catch (err) {
    console.error('Error iniciando checkout de upgrade:', err);
    document.getElementById('upgradeSubmitBtn').disabled = false;
  }
}

async function startProUpgrade() {
  const errEl = document.getElementById('upgradeCardErrors');
  const btn = document.getElementById('upgradeSubmitBtn');
  errEl.style.display = 'none';

  if (!upgradeStripe || !upgradeCardElement || !upgradePendingSubscriptionId) {
    errEl.textContent = 'El formulario de pago aún no está listo. Inténtalo de nuevo.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Confirmando tu pago de 14 €...';

  // Confirmar el PaymentIntent de la primera factura (cobra los 14 €). En un
  // reintento ya pagado (client_secret null), saltamos directo a activar.
  if (upgradeSetupSecret) {
    const { error } = await upgradeStripe.confirmCardPayment(upgradeSetupSecret, {
      payment_method: {
        card: upgradeCardElement,
        billing_details: { name: user.name || '', email: user.email || '' },
      },
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Actualizar a Pro · 14 €/mes';
      return;
    }
  }

  btn.textContent = 'Activando tu plan Pro...';
  try {
    const res = await fetch('/api/subscription/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ subscription_id: upgradePendingSubscriptionId }),
    });
    const data = await res.json();

    if (!res.ok) {
      // Reintentar dejar el modal listo para un segundo intento
      errEl.textContent = data.error || 'Error al activar Pro.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Actualizar a Pro · 14 €/mes';
      return;
    }

    // Reactivar: recargar para que el backend re-exponga el plan completo
    btn.textContent = '¡Pro activado!';
    window.location.reload();
  } catch (err) {
    console.error('Error en startProUpgrade:', err);
    errEl.textContent = 'Hubo un error de conexión. Inténtalo de nuevo.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Actualizar a Pro · 14 €/mes';
  }
}
