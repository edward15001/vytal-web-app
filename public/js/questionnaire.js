// ─── Vytal — questionnaire.js ────────────────────────────

// ═══ Estado del formulario ═══════════════════════════════════
const formData = {
    name: '', email: '', password: '',
    sex: null, age: null, height: null, weight: null, targetWeight: null,
    goal: null, activity_level: null,
    dietary_preference: null, training_experience: null, training_days: 3,
    training_equipment: 'mixto',
    health_conditions: [],
};

let currentStep = 1;

// ═══ Modo de uso ════════════════════════════════════════════
// - Normal:       registro + plan gratuito (sin pago obligatorio)
// - ?update=1:    actualizar valores → regenera el plan (sin pago)
// - ?subscribe=1: re-suscribirse tras cancelar (con pago, sin registro)
const urlParams = new URLSearchParams(window.location.search);
const updateMode = urlParams.get('update') === '1';
const resubMode = urlParams.get('subscribe') === '1';
const loggedIn = !!localStorage.getItem('vytal_token');
const isEditFlow = updateMode || resubMode;
const TOTAL_STEPS = updateMode ? 6 : (resubMode ? 7 : 8);
let authToken = null;

// Nivel de acceso devuelto por el backend (free/pro) tras generar el plan
let lastAccess = null;
// Plan generado (para la tarjeta de éxito)
let lastPlan = null;

// ═══ Estado del pago (Stripe) ═══════════════════════════════
let stripe = null;
let cardElement = null;
let setupClientSecret = null;
let pendingSubscriptionId = null;
let paymentInitialized = false;

// ═══ Navegación entre pasos ═══════════════════════════════════
function goToStep(targetStep) {
    // En modo edición el paso 1 (registro) está oculto
    if (isEditFlow && targetStep < 2) targetStep = 2;

    if (!validateStep(currentStep)) return;
    if (targetStep > currentStep) collectStepData(currentStep);

    document.getElementById(`step-${currentStep}`).style.display = 'none';
    currentStep = targetStep;
    document.getElementById(`step-${currentStep}`).style.display = 'block';
    // La pantalla de éxito usa un fondo verde a toda la página
    document.body.classList.toggle('success-mode', targetStep === 8);
    updateProgress();
    if (targetStep === 8) renderSuccess();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Renderiza la pantalla de éxito (paso 8) según el nivel de acceso:
// - FREE: plan gratuito con CTA de actualizar a Pro (opcional).
// - PRO / edición: plan completo (o actualización confirmada).
// Etiquetas de nivel de experiencia para la tarjeta de éxito
const LEVEL_LABEL = {
    principiante: 'nivel principiante',
    intermedio: 'nivel intermedio',
    avanzado: 'nivel avanzado',
};

function renderSuccess() {
    const isEdit = updateMode;
    const textEl = document.getElementById('successText');
    const btnEl = document.getElementById('successBtn');

    // Datos de las tarjetas (objetivo / menú / entreno)
    const kcalEl = document.getElementById('ssKcal');
    const daysEl = document.getElementById('ssDays');
    const levelEl = document.getElementById('ssLevel');

    if (kcalEl && lastPlan) {
        kcalEl.textContent = Number(lastPlan.daily_calories || 0).toLocaleString('es-ES');
    }
    if (daysEl) {
        daysEl.textContent = (formData.training_days || 3) + ' días';
    }
    if (levelEl) {
        levelEl.textContent = LEVEL_LABEL[formData.training_experience] || 'nivel ' + (formData.training_experience || '');
    }

    if (isEdit) {
        textEl.innerHTML =
            'Hemos <strong>actualizado tu plan</strong> con tus nuevos datos. Tu menú semanal, tu rutina y tu suplementación ya se han recalculado.';
        btnEl.innerHTML = 'Ir a mi panel&nbsp;&nbsp;→';
        btnEl.href = 'dashboard.html';
        return;
    }

    const isPro = lastAccess && lastAccess.isPro;
    if (isPro) {
        textEl.innerHTML =
            'Hemos generado tu plan personalizado de nutrición y entrenamiento, y tu <strong>plan Pro está activo</strong>. Todo lo hemos enviado también a tu email.';
        btnEl.innerHTML = 'Ir a mi panel&nbsp;&nbsp;→';
        btnEl.href = 'dashboard.html';
    } else {
        // Plan FREE
        textEl.innerHTML =
            'Hemos generado tu plan personalizado de nutrición y entrenamiento. Tu <strong>plan gratuito</strong> ya está activo.';
        btnEl.innerHTML = 'Ir a mi panel&nbsp;&nbsp;→';
        btnEl.href = 'dashboard.html';
    }
}

function updateProgress() {
    // La pantalla de éxito (paso 8) siempre muestra la barra completa
    if (currentStep >= 8) {
        document.getElementById('progressBar').style.width = '100%';
        document.getElementById('progressText').textContent = 'COMPLETADO';
        return;
    }
    const stepIndex = isEditFlow ? currentStep - 1 : currentStep;
    const pct = Math.min(100, Math.round((stepIndex / TOTAL_STEPS) * 100));
    document.getElementById('progressBar').style.width = `${pct}%`;
    document.getElementById('progressText').textContent = `Paso ${stepIndex} de ${TOTAL_STEPS}`;
}

// ═══ Validación por paso ═════════════════════════════════════
function validateStep(step) {
    const alertEl = document.getElementById(`alert-${step}`);
    const hideAlert = () => { if (alertEl) alertEl.style.display = 'none'; };
    const showAlert = (msg) => {
        if (!alertEl) return false;
        alertEl.textContent = msg;
        alertEl.style.display = 'block';
        return false;
    };
    hideAlert();

    switch (step) {
        case 1: {
            const name = document.getElementById('q-name').value.trim();
            const email = document.getElementById('q-email').value.trim();
            const pass = document.getElementById('q-password').value;
            if (!name) return showAlert('Por favor introduce tu nombre.');
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert('Email inválido.');
            if (pass.length < 8) return showAlert('La contraseña debe tener mínimo 8 caracteres.');
            return true;
        }
        case 2: {
            if (!formData.sex) return showAlert('Selecciona tu sexo biológico.');
            const age = parseInt(document.getElementById('q-age').value);
            const h = parseInt(document.getElementById('q-height').value);
            const w = parseFloat(document.getElementById('q-weight').value);
            if (!age || age < 15 || age > 100) return showAlert('Introduce una edad válida (15-100).');
            if (!h || h < 100 || h > 230) return showAlert('Introduce una altura válida (100-230 cm).');
            if (!w || w < 30 || w > 300) return showAlert('Introduce un peso válido (30-300 kg).');
            return true;
        }
        case 3:
            if (!formData.goal) return showAlert('Selecciona tu objetivo principal.');
            return true;
        case 4:
            if (!formData.activity_level) return showAlert('Selecciona tu nivel de actividad.');
            return true;
        case 5: {
            if (!formData.dietary_preference) return showAlert('Selecciona tu preferencia dietética.');
            if (!formData.training_experience) return showAlert('Selecciona tu nivel de experiencia en el gym.');
            if (!formData.training_equipment) return showAlert('Selecciona dónde entrenas.');
            return true;
        }
        default: return true;
    }
}

// ═══ Recopilar datos del paso ════════════════════════════════
function collectStepData(step) {
    switch (step) {
        case 1:
            formData.name = document.getElementById('q-name').value.trim();
            formData.email = document.getElementById('q-email').value.trim();
            formData.password = document.getElementById('q-password').value;
            break;
        case 2:
            formData.age = parseInt(document.getElementById('q-age').value);
            formData.height = parseInt(document.getElementById('q-height').value);
            formData.weight = parseFloat(document.getElementById('q-weight').value);
            const tw = document.getElementById('q-target-weight').value;
            formData.targetWeight = tw ? parseFloat(tw) : null;
            break;
        case 5:
            // El valor ya se actualizó al pulsar los segmentos de la barra
            formData.training_days = formData.training_days || 3;
            break;
    }
}

// ═══ Selección de opciones ═══════════════════════════════════
function selectOption(btn, field, value) {
    // Desmarcar todos los botones del mismo grupo
    const parent = btn.closest('.option-grid');
    if (parent) parent.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    formData[field] = value;

    // Actualizar la franja de gasto estimado del paso 4 (actividad)
    if (field === 'activity_level') updateGastoEstimado();
}

// Multiplicador de actividad según el nivel elegido
const ACTIVITY_MULT = {
    sedentario: 1.2,
    ligero: 1.375,
    moderado: 1.55,
    activo: 1.725,
    muy_activo: 1.9,
};

// Estima el gasto calórico diario = BMR (Harris-Benedict) × factor de actividad
function updateGastoEstimado() {
    const valEl = document.getElementById('gastoEstimadoVal');
    if (!valEl) return;

    const sex = formData.sex;
    const age = parseFloat(formData.age);
    const height = parseFloat(formData.height);
    const weight = parseFloat(formData.weight);
    const mult = ACTIVITY_MULT[formData.activity_level];

    if (!mult || !age || !height || !weight) {
        valEl.textContent = '— kcal / día';
        return;
    }

    // Harris-Benedict revisada
    const bmr = sex === 'mujer'
        ? 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age)
        : 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age);

    const kcal = Math.round(bmr * mult);
    valEl.textContent = kcal.toLocaleString('es-ES') + ' kcal / día';
}

function toggleCondition(el) {
    el.classList.toggle('checked');
    const val = el.dataset.value;

    if (val === 'ninguna') {
        // Desmarcar todas las demás (el selector != no es válido en querySelectorAll)
        document.querySelectorAll('.checkbox-item:not([data-value="ninguna"])').forEach(i => i.classList.remove('checked'));
        formData.health_conditions = el.classList.contains('checked') ? ['ninguna'] : [];
    } else {
        // Desmarcar "ninguna"
        document.querySelector('.checkbox-item[data-value="ninguna"]')?.classList.remove('checked');
        formData.health_conditions = formData.health_conditions.filter(v => v !== 'ninguna');
        if (el.classList.contains('checked')) {
            formData.health_conditions.push(val);
        } else {
            formData.health_conditions = formData.health_conditions.filter(v => v !== val);
        }
    }
}

// Barra segmentada de días por semana (1-6)
function setTrainingDays(n) {
    formData.training_days = parseInt(n);
    const valEl = document.getElementById('trainingDaysVal');
    if (valEl) valEl.textContent = n;
    document.querySelectorAll('#daysBar .days-seg').forEach((seg, i) => {
        seg.classList.toggle('filled', i < n);
    });
}

// ═══ Rellenar formulario con los datos actuales (modo edición) ═
async function prefillForm() {
    try {
        const res = await fetch('/api/plan', {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const p = data.profile || {};

        formData.sex = p.sex;
        formData.goal = p.goal;
        formData.activity_level = p.activity_level;
        formData.dietary_preference = p.dietary_preference;
        formData.training_experience = p.training_experience || 'principiante';
        formData.training_days = p.training_days_per_week || 3;
        formData.training_equipment = p.training_equipment || 'mixto';

        // Marcar opciones seleccionadas
        [['sex', p.sex], ['goal', p.goal], ['activity_level', p.activity_level],
         ['dietary_preference', p.dietary_preference], ['training_experience', formData.training_experience],
         ['training_equipment', formData.training_equipment]]
            .forEach(([field, value]) => {
                if (!value) return;
                document.querySelectorAll('.option-btn').forEach(btn => {
                    if ((btn.getAttribute('onclick') || '').includes(`'${field}', '${value}'`)) {
                        btn.classList.add('selected');
                    }
                });
            });

        // Campos numéricos
        if (p.age) document.getElementById('q-age').value = p.age;
        if (p.height_cm) document.getElementById('q-height').value = p.height_cm;
        if (p.weight_kg) document.getElementById('q-weight').value = p.weight_kg;
        if (p.target_weight_kg) document.getElementById('q-target-weight').value = p.target_weight_kg;

        // Condiciones de salud
        if (Array.isArray(p.health_conditions)) {
            p.health_conditions.forEach(v => {
                document.querySelector(`.checkbox-item[data-value="${v}"]`)?.classList.add('checked');
            });
            formData.health_conditions = p.health_conditions.filter(c => c !== 'ninguna');
        }

        // Días de entrenamiento: rellenar la barra segmentada y el valor
        if (document.getElementById('trainingDaysVal')) {
            setTrainingDays(formData.training_days || 3);
        }
    } catch (err) {
        console.error('Error rellenando formulario:', err);
    }
}

// ═══ Registro / actualización de usuario ═════════════════════
async function registerUser() {
    if (isEditFlow) {
        // Ya estamos registrados: solo actualizar el cuestionario
        showLoading(updateMode ? 'Actualizando tu plan...' : 'Guardando tus datos...');
        try {
            authToken = localStorage.getItem('vytal_token');
            await submitQuestionnaire();
            if (updateMode) {
                lastAccess = null;
                document.querySelectorAll('.quiz-card').forEach(card => { card.style.display = 'none'; });
                currentStep = 8;
                document.getElementById('step-8').style.display = 'block';
                document.body.classList.add('success-mode');
                renderSuccess();
                updateProgress();
            } else {
                // Re-suscripción: ir a guardar tarjeta
                goToStep(7);
                initPayment();
            }
        } catch (err) {
            console.error(err);
            const alertEl = document.getElementById('alert-6');
            if (alertEl) {
                // Mostrar el error real del backend si existe (p.ej. límite de
                // regeneraciones o validación), en vez de un mensaje genérico.
                let msg = 'Hubo un error actualizando tus datos. Inténtalo de nuevo.';
                try {
                    const parsed = JSON.parse(err.message);
                    if (parsed && parsed.error) msg = parsed.error;
                    else if (parsed && parsed.errors && parsed.errors.length) {
                        msg = parsed.errors.map(e => e.msg).join(' · ');
                    }
                } catch (_) { /* el mensaje no es JSON: se usa el genérico */ }
                alertEl.textContent = msg;
                alertEl.style.display = 'block';
            }
        } finally {
            hideLoading();
        }
        return;
    }

    showLoading('Creando tu cuenta...');
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: formData.name,
                email: formData.email,
                password: formData.password,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            hideLoading();
            // Mostrar el error en el paso visible (6, donde está el botón) —
            // no en un mensaje oculto de otro paso
            const alertEl = document.getElementById('alert-6');
            const baseMsg = data.error || (data.errors ? data.errors.map(e => e.msg).join(' · ') : 'Error al registrar. Inténtalo de nuevo.');
            alertEl.textContent = baseMsg;
            if (res.status === 409) {
                alertEl.appendChild(document.createTextNode(' '));
                const loginLink = document.createElement('a');
                loginLink.href = 'login.html';
                loginLink.textContent = 'Inicia sesión aquí';
                loginLink.style.color = 'var(--gold)';
                loginLink.style.textDecoration = 'underline';
                alertEl.appendChild(loginLink);
            }
            alertEl.style.display = 'block';
            return;
        }
        authToken = data.token;
        localStorage.setItem('vytal_token', data.token);
        localStorage.setItem('vytal_user', JSON.stringify(data.user));

        // Guardar cuestionario y obtener el plan. El usuario queda en FREE por
        // defecto; ahora se le lleva al paso 7 (pago) donde puede activar Pro
        // (14 €/mes) o continuar con el plan gratuito sin pagar.
        const qRes = await submitQuestionnaire();
        lastAccess = qRes && qRes.access ? qRes.access : null;
        lastPlan = qRes && qRes.plan ? qRes.plan : null;
        goToStep(7);
        initPayment();
    } catch (err) {
        console.error(err);
        const alertEl = document.getElementById('alert-6') || document.getElementById('alert-5');
        if (alertEl) {
            let msg = 'Hubo un error inesperado. Inténtalo de nuevo.';
            try {
                const parsed = JSON.parse(err.message);
                if (parsed && parsed.error) msg = parsed.error;
                else if (parsed && parsed.errors && parsed.errors.length) {
                    msg = parsed.errors.map(e => e.msg).join(' · ');
                }
            } catch (_) {
                if (err && err.message && err.message !== 'Failed to fetch') {
                    msg = err.message;
                }
            }
            alertEl.textContent = msg;
            alertEl.style.display = 'block';
        }
    } finally {
        hideLoading();
    }
}

// ═══ Envío del cuestionario ══════════════════════════════════
async function submitQuestionnaire() {
    try {
        const res = await fetch('/api/questionnaire', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
                age: formData.age,
                sex: formData.sex,
                weight_kg: formData.weight,
                height_cm: formData.height,
                target_weight_kg: formData.targetWeight,
                goal: formData.goal,
                activity_level: formData.activity_level,
                dietary_preference: formData.dietary_preference,
                health_conditions: formData.health_conditions.filter(c => c !== 'ninguna'),
                training_experience: formData.training_experience || 'principiante',
                training_days_per_week: formData.training_days,
                training_equipment: formData.training_equipment || 'mixto',
            }),
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(JSON.stringify(data));
        }
        return await res.json();
    } catch (err) {
        console.error('Error enviando cuestionario:', err);
        throw err;
    }
}

// ═══ Stripe: guardar tarjeta + activar Pro ═══════
async function initPayment() {
    if (paymentInitialized) return;
    paymentInitialized = true;

    if (typeof Stripe === 'undefined') {
        const alertEl = document.getElementById('alert-7');
        alertEl.textContent = 'No se pudo cargar el sistema de pago seguro. Recarga la página e inténtalo de nuevo.';
        alertEl.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/subscription/intent', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const data = await res.json();

        if (!res.ok) {
            const alertEl = document.getElementById('alert-7');
            alertEl.textContent = data.error || 'No se pudo preparar el pago. Inténtalo en unos minutos.';
            alertEl.style.display = 'block';
            return;
        }

        setupClientSecret = data.client_secret;
        pendingSubscriptionId = data.subscription_id;
        stripe = Stripe(data.publishable_key);
        cardElement = stripe.elements().create('card', {
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
        cardElement.mount('#card-element');
        cardElement.on('change', (e) => {
            const errEl = document.getElementById('card-errors');
            if (e.error) {
                errEl.textContent = e.error.message;
                errEl.style.display = 'block';
            } else {
                errEl.style.display = 'none';
            }
        });
    } catch (err) {
        console.error('Error iniciando pago:', err);
        paymentInitialized = false;
    }
}

async function startTrial() {
    const alertEl = document.getElementById('alert-7');
    const errEl = document.getElementById('card-errors');
    [alertEl, errEl].forEach(el => { if (el) el.style.display = 'none'; });

    if (!stripe || !cardElement || !pendingSubscriptionId) {
        alertEl.textContent = 'El formulario de pago aún no está listo. Espera un momento e inténtalo de nuevo.';
        alertEl.style.display = 'block';
        return;
    }

    // Confirmar el PaymentIntent de la primera factura (cobra los 14 €). En un
    // reintento ya pagado (client_secret null), saltamos directo a activar.
    if (setupClientSecret) {
        showLoading('Confirmando tu pago de 14 €...');
        try {
            const { error } = await stripe.confirmCardPayment(setupClientSecret, {
                payment_method: {
                    card: cardElement,
                    billing_details: { name: formData.name, email: formData.email },
                },
            });
            if (error) {
                errEl.textContent = error.message;
                errEl.style.display = 'block';
                hideLoading();
                return;
            }
        } catch (err) {
            console.error('Error confirmando pago:', err);
            alertEl.textContent = 'Hubo un error de conexión. Inténtalo de nuevo.';
            alertEl.style.display = 'block';
            hideLoading();
            return;
        }
    }

    showLoading('Activando tu plan Pro...');
    try {
        const res = await fetch('/api/subscription/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ subscription_id: pendingSubscriptionId }),
        });
        const data = await res.json();

        if (!res.ok) {
            alertEl.textContent = data.error || 'Error al activar Pro.';
            alertEl.style.display = 'block';
            hideLoading();
            return;
        }

        // ¡Pro activado!
        goToStep(8);
    } catch (err) {
        console.error('Error en startTrial:', err);
        alertEl.textContent = 'Hubo un error de conexión. Inténtalo de nuevo.';
        alertEl.style.display = 'block';
    } finally {
        hideLoading();
    }
}

// Continúa con el plan gratuito (sin pago). El plan ya se generó al registrar/actualizar.
function continueFree() {
    // Asegurar que el éxito muestra el modo gratuito (lastAccess.isPro = false)
    lastAccess = lastAccess || {};
    lastAccess.isPro = false;
    goToStep(8);
}

// ═══ Helpers ════════════════════════════════════════════════
function showLoading(msg = 'Cargando...') {
    document.getElementById('loadingText').textContent = msg;
    document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// ═══ Init ════════════════════════════════════════════════════
// Por defecto se marca "Ninguna condición especial" (la desmarcará prefillForm
// si el usuario tiene condiciones guardadas).
// Solo al cargar la página, antes de cualquier prefill.
(function initHealthDefault() {
    const ninguna = document.querySelector('.checkbox-item[data-value="ninguna"]');
    if (ninguna && !ninguna.classList.contains('checked')) {
        ninguna.classList.add('checked');
        formData.health_conditions = ['ninguna'];
    }
})();

if (loggedIn) {
    if (!isEditFlow) {
        // Si ya tiene sesión y entra normal, ir directamente al dashboard
        window.location.href = 'dashboard.html';
    } else {
        // Modo edición: saltar el registro y rellenar con los datos actuales
        authToken = localStorage.getItem('vytal_token');
        const storedUser = JSON.parse(localStorage.getItem('vytal_user') || '{}');
        formData.name = storedUser.name || '';
        formData.email = storedUser.email || '';

        document.getElementById('submitBtn').textContent = updateMode ? 'Actualizar mi plan' : 'Continuar al pago';
        document.getElementById('step-1').style.display = 'none';
        currentStep = 2;
        document.getElementById('step-2').style.display = 'block';
        updateProgress();
        prefillForm();
    }
}
