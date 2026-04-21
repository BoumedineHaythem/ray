// ============================================
//  EV Fleet Manager — app.js v3
//  Static QR per vehicle · Supabase backend
// ============================================
let currentSessions = [];
let lastRenderedSig = '';
let currentLang            = 'ar';
let activeTimer            = null;
let supabasePollInterval   = null;
let selectedVehicleForRent = null;
let clientPollInterval     = null;

const DEFAULT_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; // "1234"
const GRACE_SECONDS    = 5;

// ── Bootstrap ──────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);

    // ?vehicle=v1  → client scans static QR on physical scooter
    if (params.get('vehicle')) {
        initStaticClientMode(params.get('vehicle'));
        return;
    }

    // Legacy: ?client=1&exp=...  (backwards compat)
    if (params.get('client') === '1') {
        initLegacyClientMode(params);
        return;
    }

    // ── Admin App ──
    await initFleetDB();
    setupEventListeners();
    applyTheme(UIState.get('theme') || 'dark');
    setLanguage(UIState.get('lang') || 'ar');
    renderFleet();
    checkActiveSessions();
    updateNavBadge();
    showSupabaseStatus();
});

// ── Status banner ──────────────────────────
function showSupabaseStatus() {
    const banner = document.getElementById('supabase-status');
    if (!banner) return;
    if (USE_SUPABASE) {
        banner.className = 'status-banner online';
        banner.textContent = '🟢 Supabase متصل — QR codes تعمل على جميع الأجهزة';
    } else {
        banner.className = 'status-banner offline';
        banner.textContent = '🟡 وضع محلي — QR codes تعمل على نفس الجهاز فقط (فعّل Supabase للمشاركة)';
    }
}

// ── Audio ──────────────────────────────────
function playBeep(freq, duration, volume = 0.5) {
    try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value     = volume;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, duration);
    } catch(e) {}
}

function playAlert(type) {
    if (type === 'warning60') {
        playBeep(440, 300);
        setTimeout(() => playBeep(440, 300), 400);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else if (type === 'warning30') {
        playBeep(600, 200);
        setTimeout(() => playBeep(600, 200), 300);
        setTimeout(() => playBeep(600, 400), 600);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } else if (type === 'warning10') {
        for (let i = 0; i < 3; i++) setTimeout(() => playBeep(800, 150), i * 250);
        if (navigator.vibrate) navigator.vibrate([100, 80, 100, 80, 100]);
    } else if (type === 'expired') {
        playBeep(880, 400);
        setTimeout(() => playBeep(660, 600), 500);
        setTimeout(() => playBeep(440, 800), 1200);
        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]);
    }
}

// ══════════════════════════════════════════════════════════
//  CLIENT MODE — Static QR (?vehicle=v1)
//  QR is permanent on the scooter; session fetched from server
// ══════════════════════════════════════════════════════════
async function initStaticClientMode(vehicleId) {
    document.getElementById('app-content').classList.add('hidden');
    const clientView = document.getElementById('client-view');
    clientView.classList.remove('hidden');

    applyTheme(UIState.get('theme') || 'dark');

    const timerEl    = document.getElementById('client-timer');
    const nameEl     = document.getElementById('client-vehicle-name');
    const alertBox   = document.getElementById('client-alert-banner');
    const alertText  = document.getElementById('client-alert-text');
    const elapsedEl  = document.getElementById('client-elapsed');
    const totalEl    = document.getElementById('client-total-time');
    const ringEl     = document.getElementById('client-ring-progress');
    const subtitleEl = document.getElementById('client-subtitle-text');

    // Show loading state
    nameEl.textContent     = '⏳ جاري التحميل...';
    timerEl.textContent    = '--:--';
    subtitleEl.textContent = vehicleId;

    const circumference = 2 * Math.PI * 88;
    ringEl.style.strokeDasharray = circumference;

    let session        = null;
    let alerts         = {};
    let countdownTimer = null;

    // Fetch session and start countdown
    async function loadSession() {
        const s = await SessionStore.getActiveForVehicle(vehicleId);

        if (!s) {
            // No active session
            if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
            nameEl.textContent     = vehicleId;
            timerEl.textContent    = '--:--';
            timerEl.style.color    = 'var(--text-secondary)';
            subtitleEl.textContent = '⛔ لا توجد جلسة نشطة حالياً';
            alertBox.classList.remove('hidden');
            alertBox.style.borderColor = 'var(--text-secondary)';
            alertBox.style.color       = 'var(--text-secondary)';
            alertText.textContent = '📞 تواصل مع المشغّل لبدء التأجير';
            ringEl.style.strokeDashoffset = circumference;
            ringEl.style.stroke = 'var(--border)';
            elapsedEl.textContent = '--:--';
            totalEl.textContent   = '--:--';
            session = null;
            return;
        }

        // New session started (or first load)
        const isNew = !session || session.supabaseId !== s.supabaseId;
        if (isNew) {
            session = s;
            alerts  = {};
            nameEl.textContent     = s.vehicleName;
            subtitleEl.textContent = currentLang === 'ar' ? 'وقت التأجير المتبقي' : 'Time Remaining';
            totalEl.textContent    = formatMs(s.totalMs);
            alertBox.classList.add('hidden');

            if (countdownTimer) clearInterval(countdownTimer);
            countdownTimer = setInterval(tick, 500);
            tick();
        }
    }

    function tick() {
        if (!session) return;
        const now           = Date.now();
        const remainingMs   = session.expiresAt - now;
        const elapsedMs     = now - session.startTime;
        const remainingSecs = Math.floor(remainingMs / 1000);
        const inGrace       = session.graceUntil && now < session.graceUntil;

        if (inGrace) {
            const gl = Math.ceil((session.graceUntil - now) / 1000);
            timerEl.textContent = formatMs(session.totalMs);
            timerEl.style.color = 'var(--accent)';
            ringEl.style.strokeDashoffset = 0;
            ringEl.style.stroke = 'var(--accent)';
            elapsedEl.textContent = '00:00';
            alertBox.classList.remove('hidden');
            alertBox.style.borderColor = 'var(--accent)';
            alertBox.style.color       = 'var(--accent)';
            alertText.textContent = `📷 امسح الكود الآن — يبدأ العداد في ${gl}s`;
            return;
        }

        const realElapsed = elapsedMs - (session.graceUntil ? session.graceUntil - session.startTime : 0);
        elapsedEl.textContent = formatMs(Math.max(0, realElapsed));

        if (remainingMs <= 0) {
            timerEl.textContent = '00:00';
            timerEl.style.color = 'var(--danger)';
            ringEl.style.strokeDashoffset = circumference;
            ringEl.style.stroke = 'var(--danger)';
            showClientAlert('⛔ انتهى وقت التأجير!', 'var(--danger)');
            if (!alerts['0']) { alerts['0'] = true; playAlert('expired'); }
            clearInterval(countdownTimer);
            countdownTimer = null;
            return;
        }

        timerEl.textContent = formatMs(remainingMs);
        const fraction = remainingMs / session.totalMs;
        ringEl.style.strokeDashoffset = circumference * (1 - fraction);

        if (remainingSecs <= 10) {
            timerEl.style.color = 'var(--danger)';
            ringEl.style.stroke = 'var(--danger)';
            showClientAlert('🚨 تبقى 10 ثوانٍ!', 'var(--danger)');
            if (!alerts['10']) { alerts['10'] = true; playAlert('warning10'); }
        } else if (remainingSecs <= 30) {
            timerEl.style.color = 'var(--danger)';
            ringEl.style.stroke = 'var(--danger)';
            showClientAlert('⏰ تبقى 30 ثانية!', 'var(--danger)');
            if (!alerts['30']) { alerts['30'] = true; playAlert('warning30'); }
        } else if (remainingSecs <= 60) {
            timerEl.style.color = 'var(--warning)';
            ringEl.style.stroke = 'var(--warning)';
            showClientAlert('⚡ تبقى دقيقة واحدة!', 'var(--warning)');
            if (!alerts['60']) { alerts['60'] = true; playAlert('warning60'); }
        } else {
            timerEl.style.color = 'var(--accent)';
            ringEl.style.stroke = 'var(--accent)';
            alertBox.classList.add('hidden');
        }
    }

    function showClientAlert(msg, color) {
        alertBox.classList.remove('hidden');
        alertBox.style.borderColor = color;
        alertBox.style.color       = color;
        alertText.textContent      = msg;
    }

    // Initial load + poll every 5s (detect session start/end)
    await loadSession();
    clientPollInterval = setInterval(loadSession, 5000);
}

// ── Legacy client mode (backwards compat) ─
function initLegacyClientMode(params) {
    document.getElementById('app-content').classList.add('hidden');
    document.getElementById('client-view').classList.remove('hidden');
    applyTheme(UIState.get('theme') || 'dark');

    const vehicleName   = params.get('v') || 'EV';
    const expiresAt     = parseInt(params.get('exp'));
    const startedAt     = parseInt(params.get('start'));
    const totalMs       = expiresAt - startedAt;
    const circumference = 2 * Math.PI * 88;

    document.getElementById('client-vehicle-name').textContent = vehicleName;
    document.getElementById('client-total-time').textContent   = formatMs(totalMs);

    const timerEl   = document.getElementById('client-timer');
    const ringEl    = document.getElementById('client-ring-progress');
    const alertBox  = document.getElementById('client-alert-banner');
    const alertText = document.getElementById('client-alert-text');
    const elapsedEl = document.getElementById('client-elapsed');

    ringEl.style.strokeDasharray = circumference;
    const graceUntil = expiresAt - totalMs;
    let alerts = {};

    const tick = () => {
        const now           = Date.now();
        const remainingMs   = expiresAt - now;
        const elapsedMs     = now - startedAt;
        const remainingSecs = Math.floor(remainingMs / 1000);
        const inGrace       = now < graceUntil;

        if (inGrace) {
            timerEl.textContent = formatMs(totalMs);
            timerEl.style.color = 'var(--accent)';
            ringEl.style.strokeDashoffset = 0;
            ringEl.style.stroke = 'var(--accent)';
            elapsedEl.textContent = '00:00';
            alertBox.classList.remove('hidden');
            alertText.textContent = `📷 يبدأ العداد في ${Math.ceil((graceUntil - now)/1000)}s`;
            return;
        }

        elapsedEl.textContent = formatMs(elapsedMs - (graceUntil - startedAt));

        if (remainingMs <= 0) {
            timerEl.textContent = '00:00';
            timerEl.style.color = 'var(--danger)';
            ringEl.style.strokeDashoffset = circumference;
            ringEl.style.stroke = 'var(--danger)';
            alertBox.classList.remove('hidden');
            alertText.textContent = '⛔ انتهى وقت التأجير!';
            if (!alerts['0']) { alerts['0'] = true; playAlert('expired'); }
            clearInterval(legacyInterval);
            return;
        }

        timerEl.textContent = formatMs(remainingMs);
        const fraction = remainingMs / totalMs;
        ringEl.style.strokeDashoffset = circumference * (1 - fraction);

        if (remainingSecs <= 10) {
            timerEl.style.color = 'var(--danger)'; ringEl.style.stroke = 'var(--danger)';
            if (!alerts['10']) { alerts['10'] = true; playAlert('warning10'); alertText.textContent = '🚨 تبقى 10 ثوانٍ!'; alertBox.classList.remove('hidden'); }
        } else if (remainingSecs <= 30) {
            timerEl.style.color = 'var(--danger)'; ringEl.style.stroke = 'var(--danger)';
            if (!alerts['30']) { alerts['30'] = true; playAlert('warning30'); alertText.textContent = '⏰ تبقى 30 ثانية!'; alertBox.classList.remove('hidden'); }
        } else if (remainingSecs <= 60) {
            timerEl.style.color = 'var(--warning)'; ringEl.style.stroke = 'var(--warning)';
            if (!alerts['60']) { alerts['60'] = true; playAlert('warning60'); alertText.textContent = '⚡ تبقى دقيقة!'; alertBox.classList.remove('hidden'); }
        } else {
            timerEl.style.color = 'var(--accent)'; ringEl.style.stroke = 'var(--accent)';
        }
    };
    tick();
    const legacyInterval = setInterval(tick, 500);
}

// ══════════════════════════════════════════════════════════
//  ADMIN APP
// ══════════════════════════════════════════════════════════

async function initFleetDB() {
    const storedFleet = await DB.getAll('fleet');
    if (storedFleet.length === 0) {
        for (const vehicle of initialFleet) await DB.saveRecord('fleet', vehicle);
    }
}

function setupEventListeners() {
    // Nav tabs
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target   = e.currentTarget;
            const targetId = target.getAttribute('data-target');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => {
                v.classList.add('hidden'); v.classList.remove('active');
            });
            target.classList.add('active');
            const section = document.getElementById(targetId);
            section.classList.remove('hidden');
            section.classList.add('active');
            if (targetId === 'logs-view') renderLogs();
        });
    });

    document.getElementById('theme-toggle').addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark-mode');
        applyTheme(isDark ? 'light' : 'dark');
    });

    document.getElementById('lang-toggle').addEventListener('click', () => {
        setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    });

    document.getElementById('unlock-analytics-btn').addEventListener('click', async () => {
        const hash = await sha256(document.getElementById('pin-input').value);
        if (hash === DEFAULT_PIN_HASH) {
            document.getElementById('pin-protection').classList.add('hidden');
            document.getElementById('analytics-dashboard').classList.remove('hidden');
            renderAnalytics();
        } else {
            const btn = document.getElementById('unlock-analytics-btn');
            btn.textContent       = '❌ رمز خاطئ';
            btn.style.background  = 'var(--danger)';
            setTimeout(() => { btn.textContent = '🔓 فتح'; btn.style.background = ''; }, 2000);
        }
    });
    document.getElementById('pin-input').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') document.getElementById('unlock-analytics-btn').click();
    });

    // Amount / unit bidirectional sync
    document.getElementById('setup-da').addEventListener('input', (e) => {
        if (!selectedVehicleForRent) return;
        const da    = parseFloat(e.target.value) || 0;
        const units = (da / selectedVehicleForRent.rate) * selectedVehicleForRent.unit;
        document.getElementById('setup-unit').value = parseFloat(units.toFixed(2));
        updatePreStartQR(units);
    });
    document.getElementById('setup-unit').addEventListener('input', (e) => {
        if (!selectedVehicleForRent) return;
        const units = parseFloat(e.target.value) || 0;
        const da    = (units / selectedVehicleForRent.unit) * selectedVehicleForRent.rate;
        document.getElementById('setup-da').value = parseFloat(da.toFixed(2));
        updatePreStartQR(units);
    });

    // Quick amount buttons
    document.querySelectorAll('.quick-da-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!selectedVehicleForRent) return;
            const da    = parseInt(btn.dataset.da);
            const units = (da / selectedVehicleForRent.rate) * selectedVehicleForRent.unit;
            document.getElementById('setup-da').value   = da;
            document.getElementById('setup-unit').value = parseFloat(units.toFixed(2));
            updatePreStartQR(units);
        });
    });

    document.getElementById('confirm-rent-btn').addEventListener('click', finalizeStartRental);
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
    document.getElementById('print-qr-btn').addEventListener('click', openPrintQRModal);
}

// ── Theme & Language ───────────────────────
function applyTheme(theme) {
    document.body.className = theme === 'dark' ? 'dark-mode' : '';
    document.getElementById('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    UIState.set('theme', theme);
}

function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('lang-toggle').textContent = lang === 'ar' ? 'EN' : 'AR';
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang]?.[key]) el.textContent = translations[lang][key];
    });
    UIState.set('lang', lang);
    renderFleet();
    checkActiveSessions();
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// ── Fleet Rendering ────────────────────────
async function renderFleet() {
    const fleet = await DB.getAll('fleet');
    const grid  = document.getElementById('fleet-grid');
    grid.innerHTML = '';

    const t         = translations[currentLang];
    const available = fleet.filter(v => v.status === 'available').length;
    document.getElementById('fleet-count').textContent =
        `${available} / ${fleet.length} ${t.available}`;

    fleet.forEach(v => {
        const card       = document.createElement('div');
        card.className   = 'fleet-card';
        const statusText  = v.status === 'available' ? t.available : t.busy;
        const statusClass = v.status === 'available' ? 'status-available' : 'status-busy';
        const typeIcon    = v.type === 'scooter' ? '🛵' : '🚗';

        card.innerHTML = `
            <div class="card-shine"></div>
            <div class="color-dot" style="background-color:${v.color};"></div>
            <img src="${v.img}" alt="${v.name}" loading="lazy" onerror="this.style.display='none'">
            <h3>${typeIcon} ${v.name}</h3>
            <p class="rate-text">${v.rate} DA / ${v.unit} ${v.billingType === 'timer' ? t.min : t.tour}</p>
            <span class="status-badge ${statusClass}">${statusText}</span>
            ${v.status === 'available'
                ? `<button class="btn btn-primary btn-sm" onclick="openRentalSetup('${v.id}')">${t.rentNow}</button>`
                : `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.5;">🔴 ${t.busy}</button>`}
        `;
        grid.appendChild(card);
    });
}

// ── Rental Setup Modal ─────────────────────
async function openRentalSetup(vehicleId) {
    const fleet = await DB.getAll('fleet');
    selectedVehicleForRent = fleet.find(v => v.id === vehicleId);

    const t = translations[currentLang];
    document.getElementById('setup-title').textContent = `🔧 ${selectedVehicleForRent.name}`;
    document.getElementById('setup-da').value   = selectedVehicleForRent.rate;
    document.getElementById('setup-unit').value = selectedVehicleForRent.unit;

    const label = selectedVehicleForRent.billingType === 'timer' ? t.min : t.tour;
    document.getElementById('setup-unit-label').textContent = `${t.rentTime.split(':')[0]} (${label}):`;

    updatePreStartQR(selectedVehicleForRent.unit);
    document.getElementById('setup-modal').classList.remove('hidden');
}

// Pre-start QR (shows full planned duration)
function updatePreStartQR(units) {
    const container = document.getElementById('setup-qr-container');
    container.innerHTML = '';

    if (selectedVehicleForRent.billingType !== 'timer') {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;padding:10px;">🚗 لا يوجد QR للسيارات (تأجير بالجولة)</p>';
        return;
    }

    const durationMs = units * 60000;
    const nowMs      = Date.now();
    // Show a preview QR (not the real session yet)
    const url = buildVehicleUrl(selectedVehicleForRent.id);
    new QRCode(container, { text: url, width: 150, height: 150, colorDark: '#000', colorLight: '#fff' });
    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:0.7rem;color:var(--text-secondary);margin-top:6px;';
    hint.textContent   = `⏱ ${formatMs(durationMs)} بعد البدء`;
    container.appendChild(hint);
}

// ── Start Rental ───────────────────────────
async function finalizeStartRental() {
    const units = parseFloat(document.getElementById('setup-unit').value);
    const da    = parseFloat(document.getElementById('setup-da').value);

    if (isNaN(units) || units <= 0 || isNaN(da) || da < 0) {
        alert('يرجى إدخال قيم صحيحة');
        return;
    }

    // Mark vehicle busy
    selectedVehicleForRent.status = 'busy';
    await DB.saveRecord('fleet', selectedVehicleForRent);

    const durationMs = selectedVehicleForRent.billingType === 'timer' ? (units * 60000) : null;
    const graceMs    = selectedVehicleForRent.billingType === 'timer' ? (GRACE_SECONDS * 1000) : 0;
    const startTime  = Date.now();
    const expiresAt  = durationMs ? (startTime + graceMs + durationMs) : null;
    const graceUntil = durationMs ? (startTime + graceMs) : null;

    const session = {
        vehicleId:   selectedVehicleForRent.id,
        vehicleName: selectedVehicleForRent.name,
        vehicleType: selectedVehicleForRent.type,
        color:       selectedVehicleForRent.color,
        billingType: selectedVehicleForRent.billingType,
        price:       da,
        units,
        totalMs:     durationMs,
        startTime,
        expiresAt,
        graceUntil,
        alerts:      {}
    };

    await SessionStore.saveActive(session);
    closeModal('setup-modal');

    if (durationMs) showGraceQR(session);

    renderFleet();
    checkActiveSessions();
    updateNavBadge();
    document.querySelector('.nav-btn[data-target="rental-view"]').click();
}

// Grace-period QR overlay (shown right after Start is pressed)
function showGraceQR(session) {
    const container = document.getElementById('active-qr-container');
    container.innerHTML = '';

    // Static URL — the QR on the scooter stays the same
    const url = buildVehicleUrl(session.vehicleId);
    new QRCode(container, { text: url, width: 200, height: 200, colorDark: '#000', colorLight: '#fff' });

    document.getElementById('qr-modal-title').textContent = `📱 ${session.vehicleName}`;

    const qrTimeEl = document.getElementById('qr-time-remaining');
    qrTimeEl.style.color = 'var(--warning)';
    let remaining = GRACE_SECONDS;

    const tick = () => {
        if (remaining > 0) {
            qrTimeEl.textContent = `⏳ ${currentLang === 'ar' ? 'العداد يبدأ في' : 'Timer starts in'} ${remaining}s`;
            remaining--;
        } else {
            qrTimeEl.textContent   = currentLang === 'ar' ? '✅ العداد يعمل الآن!' : '✅ Timer is running!';
            qrTimeEl.style.color   = 'var(--success)';
            clearInterval(graceInterval);
        }
    };
    tick();
    const graceInterval = setInterval(tick, 1000);
    document.getElementById('qr-modal').classList.remove('hidden');
}

// ── Active Sessions Display ────────────────
// ── Active Sessions Display (Fixed No-Blink Version) ────────────────
async function checkActiveSessions() {
    if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
    if (supabasePollInterval) { clearInterval(supabasePollInterval); supabasePollInterval = null; }

    currentSessions = await SessionStore.getActive();

    // Rebuild HTML ONLY if a session is added or removed
    const currentSig = currentSessions.map(s => s.vehicleId).join('|');
    if (currentSig !== lastRenderedSig) {
        buildCardsDOM(currentSessions);
        lastRenderedSig = currentSig;
    }

    // Merge local alerts
    const local = JSON.parse(UIState.get('activeSessions') || '[]');
    currentSessions.forEach(s => {
        const li = local.find(l => l.vehicleId === s.vehicleId);
        if (li) s.alerts = li.alerts || {};
    });

    updateNavBadge(currentSessions.length);
    updateTimerTick(); // immediate update
    
    activeTimer = setInterval(updateTimerTick, 500); // 0.5s updates

    if (USE_SUPABASE) {
        supabasePollInterval = setInterval(async () => {
            const updatedSessions = await SessionStore.getActive();
            const updatedSig = updatedSessions.map(s => s.vehicleId).join('|');
            if(updatedSig !== lastRenderedSig) checkActiveSessions(); 
            else {
                updatedSessions.forEach(us => {
                    const existing = currentSessions.find(cs => cs.vehicleId === us.vehicleId);
                    if (existing) { existing.expiresAt = us.expiresAt; existing.totalMs = us.totalMs; }
                });
            }
        }, 15000);
    }
}

// Builds the HTML framework exactly ONCE
function buildCardsDOM(sessions) {
    const container = document.getElementById('active-rental-card');
    container.innerHTML = ''; 

    if (sessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🏁</span>
                <h3>${translations[currentLang].activeSession}</h3>
                <p>${currentLang === 'ar' ? 'لا توجد جلسات نشطة حالياً' : 'No active sessions'}</p>
            </div>`;
        return;
    }

    sessions.forEach((s) => {
        const qrBtn = s.billingType === 'timer'
            ? `<button class="btn btn-secondary btn-sm btn-icon" onclick="showVehicleQR('${s.vehicleId}', '${s.vehicleName}')">📱 QR</button>` : '';

        const extendBtn = s.billingType === 'timer'
            ? `<button class="btn btn-secondary btn-sm btn-icon" onclick="openExtendModal('${s.vehicleId}')">+⏱</button>` : '';

        const card = document.createElement('div');
        card.className = 'session-card';
        card.id = `session-card-${s.vehicleId}`;
        card.style.borderInlineStartColor = s.color || 'var(--accent)';
        const circumference = 2 * Math.PI * 35;

        card.innerHTML = `
            <div id="alert-banner-${s.vehicleId}"></div>
            <div class="session-card-header">
                <div>
                    <div class="session-vehicle-name">${s.vehicleType === 'scooter' ? '🛵' : '🚗'} ${s.vehicleName}</div>
                    <div class="elapsed-text" id="elapsed-${s.vehicleId}"></div>
                </div>
                <div class="session-price-badge">${s.price} DA</div>
            </div>
            <div class="timer-container">
                <div class="timer-ring">
                    <svg viewBox="0 0 80 80">
                        <circle class="ring-bg" cx="40" cy="40" r="35"/>
                        <circle class="ring-progress" id="ring-${s.vehicleId}" cx="40" cy="40" r="35" style="stroke-dasharray:${circumference};"/>
                    </svg>
                    <div class="ring-text" id="ring-text-${s.vehicleId}"></div>
                </div>
                <div class="timer-info">
                    <div class="timer-display" id="timer-display-${s.vehicleId}" dir="ltr"></div>
                    <div class="timer-label">${currentLang === 'ar' ? 'الوقت المتبقي' : 'Time Remaining'}</div>
                    <div class="progress-bar-wrap">
                        <div class="progress-bar-fill" id="progress-bar-${s.vehicleId}"></div>
                    </div>
                </div>
            </div>
            <div class="session-actions">
                ${qrBtn}
                ${extendBtn}
                <button class="btn btn-danger btn-sm btn-icon" style="flex:1" onclick="endRental('${s.vehicleId}')">
                    🏁 ${translations[currentLang].endSession}
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

// Updates ONLY the text and progress bar smoothly every 0.5s
function updateTimerTick() {
    const circumference = 2 * Math.PI * 35;
    let needsAlertSave = false;

    currentSessions.forEach(s => {
        const cardEl = document.getElementById(`session-card-${s.vehicleId}`);
        if (!cardEl) return; 

        let timeDisplay = '', timerClass = '', alertHtml = '', ringOffset = 0, progressPct = 0, cardClass = 'session-card', elapsedText = '';

        if (s.billingType === 'timer') {
            const now = Date.now(), remainingMs = s.expiresAt - now, elapsedMs = now - s.startTime;
            const remainingSecs = Math.floor(remainingMs / 1000), inGrace = s.graceUntil && now < s.graceUntil;
            elapsedText = formatMs(elapsedMs);

            if (inGrace) {
                const graceLeft = Math.ceil((s.graceUntil - now) / 1000);
                timeDisplay = formatMs(s.totalMs);
                progressPct = 1; ringOffset = 0;
                alertHtml = `<div class="alert-banner" style="border-color:var(--accent);color:var(--accent);background:var(--accent-glow);">
                    📷 ${currentLang === 'ar' ? 'امسح QR — العداد يبدأ في' : 'Scan QR — timer starts in'} <strong>${graceLeft}s</strong>
                </div>`;
            } else if (remainingMs <= 0) {
                timeDisplay = '00:00'; timerClass = 'danger'; cardClass = 'session-card expired';
                progressPct = 0; ringOffset = circumference;
                alertHtml = `<div class="alert-banner">⛔ ${currentLang === 'ar' ? 'انتهى الوقت!' : 'Time Expired!'}</div>`;
                if (!s.alerts['0']) { s.alerts['0'] = true; needsAlertSave = true; playAlert('expired'); }
            } else {
                timeDisplay = formatMs(remainingMs);
                progressPct = remainingMs / s.totalMs;
                ringOffset  = circumference * (1 - progressPct);

                if (remainingSecs <= 10) {
                    timerClass = 'danger'; cardClass = 'session-card expired';
                    alertHtml = `<div class="alert-banner">🚨 ${currentLang === 'ar' ? 'تبقى 10 ثوانٍ!' : '10 seconds left!'}</div>`;
                    if (!s.alerts['10']) { s.alerts['10'] = true; needsAlertSave = true; playAlert('warning10'); }
                } else if (remainingSecs <= 30) {
                    timerClass = 'danger'; cardClass = 'session-card warning';
                    alertHtml = `<div class="alert-banner">⏰ ${currentLang === 'ar' ? 'تبقى 30 ثانية!' : '30 seconds left!'}</div>`;
                    if (!s.alerts['30']) { s.alerts['30'] = true; needsAlertSave = true; playAlert('warning30'); }
                } else if (remainingSecs <= 60) {
                    timerClass = 'warning'; cardClass = 'session-card warning';
                    alertHtml = `<div class="alert-banner" style="border-color:var(--warning);color:var(--warning);background:rgba(245,158,11,0.1);">⚡ ${currentLang === 'ar' ? 'دقيقة أخيرة!' : 'Last minute!'}</div>`;
                    if (!s.alerts['60']) { s.alerts['60'] = true; needsAlertSave = true; playAlert('warning60'); }
                }
            }
        } else {
            timeDisplay = `${s.units} ${translations[currentLang].tour}`;
            progressPct = 0.7; ringOffset = circumference * 0.3;
            elapsedText = formatMs(Date.now() - s.startTime);
        }

        if (cardEl.className !== cardClass) cardEl.className = cardClass;
        
        const alertBanner = document.getElementById(`alert-banner-${s.vehicleId}`);
        if (alertBanner.innerHTML !== alertHtml) alertBanner.innerHTML = alertHtml;
        
        document.getElementById(`elapsed-${s.vehicleId}`).textContent = `${currentLang === 'ar' ? 'منذ' : 'since'} ${elapsedText}`;
        document.getElementById(`ring-text-${s.vehicleId}`).textContent = s.billingType === 'timer' ? Math.max(0, Math.ceil((s.expiresAt - Date.now()) / 60000)) + 'm' : '🔁';
        
        const timerDisplayEl = document.getElementById(`timer-display-${s.vehicleId}`);
        if (timerDisplayEl.textContent !== timeDisplay) timerDisplayEl.textContent = timeDisplay;
        timerDisplayEl.className = `timer-display ${timerClass}`;

        const ringEl = document.getElementById(`ring-${s.vehicleId}`);
        ringEl.style.strokeDashoffset = ringOffset;
        ringEl.style.stroke = timerClass === 'danger' ? 'var(--danger)' : timerClass === 'warning' ? 'var(--warning)' : 'var(--accent)';

        const progressBarEl = document.getElementById(`progress-bar-${s.vehicleId}`);
        const fillClass = ['danger', 'warning'].includes(timerClass) ? 'danger-fill' : '';
        progressBarEl.className = `progress-bar-fill ${fillClass}`;
        progressBarEl.style.width = s.billingType === 'timer' ? `${Math.max(0, progressPct * 100).toFixed(1)}%` : '70%';
    });

    if (needsAlertSave) SessionStore.saveLocalAlerts(currentSessions);
}

// ── Show QR for vehicle (static link) ─────
window.showVehicleQR = function(vehicleId, vehicleName) {
    const url       = buildVehicleUrl(vehicleId);
    const container = document.getElementById('active-qr-container');
    container.innerHTML = '';
    new QRCode(container, { text: url, width: 200, height: 200, colorDark: '#000', colorLight: '#fff' });

    document.getElementById('qr-modal-title').textContent = `📱 ${vehicleName}`;
    document.getElementById('qr-time-remaining').textContent = `🔗 ${url}`;
    document.getElementById('qr-modal').classList.remove('hidden');
};

// ── Extend Session ─────────────────────────
// ── Extend Session ─────────────────────────
let extendTargetVehicleId = null;

window.openExtendModal = function(vehicleId) {
    extendTargetVehicleId = vehicleId;
    document.getElementById('extend-modal').classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.extend-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!extendTargetVehicleId) return;
            const addMinutes = parseInt(btn.dataset.min);
            const addMs      = addMinutes * 60000;
            const sessions   = await SessionStore.getActive();
            const session    = sessions.find(s => s.vehicleId === extendTargetVehicleId);
            if (!session) return;

            session.expiresAt += addMs;
            session.totalMs   += addMs;

            await SessionStore.extendSession(session);
            closeModal('extend-modal');
            extendTargetVehicleId = null;
            checkActiveSessions();
        });
    });
});
// ── End Rental ─────────────────────────────
window.endRental = async function(vehicleId) {
    const sessions = await SessionStore.getActive();
    const s = sessions.find(sess => sess.vehicleId === vehicleId);
    if (!s) return;

    const endTime   = Date.now();
    const elapsedMs = endTime - s.startTime;

    await SessionStore.endSession(s, endTime);

    // Mark vehicle available
    const fleet   = await DB.getAll('fleet');
    const vehicle = fleet.find(v => v.id === s.vehicleId);
    if (vehicle) { vehicle.status = 'available'; await DB.saveRecord('fleet', vehicle); }

    renderFleet();
    checkActiveSessions();
    updateNavBadge();
    showSessionSummary(s, elapsedMs);
};

function showSessionSummary(s, elapsedMs) {
    document.getElementById('summary-amount').textContent = `${s.price} DA`;
    const rows = [
        { label: currentLang === 'ar' ? 'المركبة'       : 'Vehicle',         value: s.vehicleName },
        { label: currentLang === 'ar' ? 'مدة التأجير'   : 'Duration',        value: formatMs(elapsedMs) },
        { label: currentLang === 'ar' ? 'النوع'         : 'Type',            value: s.billingType === 'timer' ? (currentLang === 'ar' ? 'وقت' : 'Timed') : (currentLang === 'ar' ? 'جولة' : 'Tours') },
        { label: currentLang === 'ar' ? 'الوحدات'       : 'Units',           value: `${s.units} ${s.billingType === 'timer' ? translations[currentLang].min : translations[currentLang].tour}` },
    ];
    document.getElementById('summary-rows').innerHTML = rows.map(r =>
        `<div class="summary-row">
            <span class="sr-label">${r.label}</span>
            <span class="sr-value">${r.value}</span>
        </div>`
    ).join('');
    document.getElementById('summary-modal').classList.remove('hidden');
}

// ── Logs ───────────────────────────────────
async function renderLogs() {
    const sessions = await SessionStore.getCompleted();
    const list     = document.getElementById('logs-list');
    list.innerHTML = '';

    if (!sessions.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><h3>${currentLang === 'ar' ? 'لا يوجد سجل' : 'No history'}</h3></div>`;
        return;
    }

    sessions.slice().reverse().forEach(s => {
        const li       = document.createElement('li');
        const date     = new Date(s.endTime).toLocaleDateString(currentLang === 'ar' ? 'ar-DZ' : 'en-GB');
        const duration = formatMs(s.endTime - s.startTime);
        li.innerHTML = `
            <div class="log-info">
                <div class="log-name">🚗 ${s.vehicleName}</div>
                <div class="log-date">📅 ${date} · ⏱ ${duration}</div>
            </div>
            <div class="log-price">+${s.price} DA</div>
        `;
        list.appendChild(li);
    });
}

// ── CSV Export ─────────────────────────────
async function exportCSV() {
    const sessions = await SessionStore.getCompleted();
    if (!sessions.length) { alert(currentLang === 'ar' ? 'لا توجد بيانات' : 'No data'); return; }

    const header = ['Vehicle', 'Start', 'End', 'Duration (min)', 'Price (DA)'];
    const rows   = sessions.map(s => [
        s.vehicleName,
        new Date(s.startTime).toISOString(),
        new Date(s.endTime).toISOString(),
        ((s.endTime - s.startTime) / 60000).toFixed(1),
        s.price
    ]);

    const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ev_rentals_${Date.now()}.csv`;
    a.click();
}

// ── Print QR Labels ───────────────────────
async function openPrintQRModal() {
    const fleet     = await DB.getAll('fleet');
    const container = document.getElementById('print-qr-grid');
    container.innerHTML = '';

    fleet.forEach(v => {
        const label = document.createElement('div');
        label.className = 'qr-label';

        const qrDiv = document.createElement('div');
        qrDiv.className = 'qr-label-code';

        label.innerHTML = `
            <div class="qr-label-header">⚡ EV Fleet</div>
            <div class="qr-label-name">${v.type === 'scooter' ? '🛵' : '🚗'} ${v.name}</div>
        `;
        label.appendChild(qrDiv);

        const info = document.createElement('div');
        info.className = 'qr-label-info';
        info.innerHTML = `
            <span>${v.rate} DA / ${v.unit} ${v.billingType === 'timer' ? 'دقيقة' : 'جولة'}</span>
            <span style="font-size:0.65rem;opacity:0.6;">ID: ${v.id}</span>
        `;
        label.appendChild(info);
        container.appendChild(label);

        // Generate QR code for this vehicle
        const url = buildVehicleUrl(v.id);
        new QRCode(qrDiv, { text: url, width: 160, height: 160, colorDark: '#000', colorLight: '#fff' });
    });

    document.getElementById('print-qr-modal').classList.remove('hidden');
}

window.printQRLabels = function() {
    window.print();
};

// ── Nav Badge ──────────────────────────────
function updateNavBadge(count) {
    if (count === undefined) {
        count = (JSON.parse(UIState.get('activeSessions') || '[]')).length;
    }
    const badge = document.getElementById('active-badge');
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ── Helpers ────────────────────────────────
function formatMs(ms) {
    if (!ms || ms < 0) ms = 0;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Static vehicle URL — permanent QR on the scooter
function buildVehicleUrl(vehicleId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?vehicle=${encodeURIComponent(vehicleId)}`;
}

// Legacy session URL (for backwards compat)
function buildClientUrl(name, expiresAt, startTime) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?client=1&exp=${expiresAt}&start=${startTime}&v=${encodeURIComponent(name)}`;
}

async function sha256(message) {
    const buf  = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}