// ============================================
//  EV Fleet Manager — app.js (v2 Premium)
// ============================================

let currentLang     = 'ar';
let activeTimer     = null;
let selectedVehicleForRent = null;

const DEFAULT_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; // "1234"

// ── Bootstrap ──────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('client') === '1') {
        initClientMode(urlParams);
        return;
    }

    await initFleetDB();
    setupEventListeners();
    applyTheme(UIState.get('theme') || 'dark');
    setLanguage(UIState.get('lang') || 'ar');
    renderFleet();
    checkActiveSessions();
    updateNavBadge();
});

// ── Audio ──────────────────────────────────
function playBeep(freq, duration, volume = 0.5) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = volume;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, duration);
    } catch(e) {}
}

function playAlert(type) {
    if (type === 'warning60') {
        playBeep(440, 300); setTimeout(() => playBeep(440, 300), 400);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else if (type === 'warning30') {
        playBeep(600, 200); setTimeout(() => playBeep(600, 200), 300); setTimeout(() => playBeep(600, 400), 600);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } else if (type === 'warning10') {
        for (let i = 0; i < 3; i++) setTimeout(() => playBeep(800, 150), i * 250);
        if (navigator.vibrate) navigator.vibrate([100, 80, 100, 80, 100]);
    } else if (type === 'expired') {
        playBeep(880, 400); setTimeout(() => playBeep(660, 600), 500); setTimeout(() => playBeep(440, 800), 1200);
        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]);
    }
}

// ── Client Mode (QR Scan Page) ─────────────
function initClientMode(params) {
    document.getElementById('app-content').classList.add('hidden');
    const clientView = document.getElementById('client-view');
    clientView.classList.remove('hidden');

    const vehicleName = params.get('v') || 'EV';
    document.getElementById('client-vehicle-name').textContent = vehicleName;

    const totalMs    = parseInt(params.get('total') || params.get('rem'));
    const remainingMsAtStart = parseInt(params.get('rem'));
    const startedAt  = Date.now() - (totalMs - remainingMsAtStart);
    const expiresAt  = Date.now() + remainingMsAtStart;
    const circumference = 2 * Math.PI * 88; // r=88

    // Elapsed display
    const elapsedEl   = document.getElementById('client-elapsed');
    const totalEl     = document.getElementById('client-total-time');
    const timerEl     = document.getElementById('client-timer');
    const ringEl      = document.getElementById('client-ring-progress');
    const alertBox    = document.getElementById('client-alert-banner');
    const alertText   = document.getElementById('client-alert-text');

    totalEl.textContent = formatMs(totalMs);
    ringEl.style.strokeDasharray = circumference;

    let alerts = {};
    let currentAlertLevel = null;

    const tick = () => {
        const now          = Date.now();
        const remainingMs  = expiresAt - now;
        const elapsedMs    = now - startedAt;
        const remainingSecs = Math.floor(remainingMs / 1000);

        // Elapsed
        elapsedEl.textContent = formatMs(elapsedMs);

        if (remainingMs <= 0) {
            timerEl.textContent = '00:00';
            timerEl.style.color = 'var(--danger)';
            ringEl.style.strokeDashoffset = circumference;
            ringEl.style.stroke = 'var(--danger)';
            showClientAlert('⛔ انتهى وقت التأجير!', 'expired');
            if (!alerts['0']) { alerts['0'] = true; playAlert('expired'); }
            clearInterval(clientInterval);
            return;
        }

        // Timer text
        timerEl.textContent = formatMs(remainingMs);

        // Ring progress
        const fraction = remainingMs / totalMs;
        ringEl.style.strokeDashoffset = circumference * (1 - fraction);

        // Color + alerts
        if (remainingSecs <= 10) {
            timerEl.style.color = 'var(--danger)';
            ringEl.style.stroke = 'var(--danger)';
            if (!alerts['10']) { alerts['10'] = true; playAlert('warning10'); showClientAlert('⚠️ تبقى 10 ثوانٍ!', 'critical'); }
        } else if (remainingSecs <= 30) {
            timerEl.style.color = 'var(--danger)';
            ringEl.style.stroke = 'var(--danger)';
            if (!alerts['30']) { alerts['30'] = true; playAlert('warning30'); showClientAlert('⏰ تبقى 30 ثانية!', 'danger'); }
        } else if (remainingSecs <= 60) {
            timerEl.style.color = 'var(--warning)';
            ringEl.style.stroke = 'var(--warning)';
            if (!alerts['60']) { alerts['60'] = true; playAlert('warning60'); showClientAlert('⚡ تبقى دقيقة واحدة!', 'warning'); }
        } else {
            timerEl.style.color = 'var(--accent)';
            ringEl.style.stroke = 'var(--accent)';
        }
    };

    function showClientAlert(msg, level) {
        alertText.textContent = msg;
        alertBox.classList.remove('hidden');
        currentAlertLevel = level;
    }

    tick();
    const clientInterval = setInterval(tick, 500);
}

// ── DB Init ────────────────────────────────
async function initFleetDB() {
    const storedFleet = await DB.getAll('fleet');
    if (storedFleet.length === 0) {
        for (const vehicle of initialFleet) await DB.saveRecord('fleet', vehicle);
    }
}

// ── Event Listeners ────────────────────────
function setupEventListeners() {
    // Nav tabs
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => { v.classList.add('hidden'); v.classList.remove('active'); });
            target.classList.add('active');
            const targetId = target.getAttribute('data-target');
            const section  = document.getElementById(targetId);
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
            btn.textContent = '❌ رمز خاطئ';
            btn.style.background = 'var(--danger)';
            setTimeout(() => { btn.textContent = '🔓 فتح'; btn.style.background = ''; }, 2000);
        }
    });

    document.getElementById('setup-da').addEventListener('input', (e) => {
        if (!selectedVehicleForRent) return;
        const da = parseFloat(e.target.value) || 0;
        const units = (da / selectedVehicleForRent.rate) * selectedVehicleForRent.unit;
        document.getElementById('setup-unit').value = parseFloat(units.toFixed(2));
        updatePreStartQR(units);
    });

    document.getElementById('setup-unit').addEventListener('input', (e) => {
        if (!selectedVehicleForRent) return;
        const units = parseFloat(e.target.value) || 0;
        const da = (units / selectedVehicleForRent.unit) * selectedVehicleForRent.rate;
        document.getElementById('setup-da').value = parseFloat(da.toFixed(2));
        updatePreStartQR(units);
    });

    document.getElementById('confirm-rent-btn').addEventListener('click', finalizeStartRental);
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);

    // Allow pressing Enter in PIN input
    document.getElementById('pin-input').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') document.getElementById('unlock-analytics-btn').click();
    });
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

    const t = translations[currentLang];
    const available = fleet.filter(v => v.status === 'available').length;
    document.getElementById('fleet-count').textContent = `${available} / ${fleet.length} ${t.available}`;

    fleet.forEach(v => {
        const card = document.createElement('div');
        card.className = 'fleet-card';
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
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;padding:10px;">🚗 لا يوجد QR للسيارات</p>';
        return;
    }

    const durationMs = units * 60000;
    const url = buildClientUrl(selectedVehicleForRent.name, durationMs, durationMs);
    new QRCode(container, { text: url, width: 160, height: 160, colorDark: '#000000', colorLight: '#ffffff' });
}

// ── Start Rental ───────────────────────────
async function finalizeStartRental() {
    const units = parseFloat(document.getElementById('setup-unit').value);
    const da    = parseFloat(document.getElementById('setup-da').value);

    if (isNaN(units) || units <= 0 || isNaN(da) || da < 0) {
        alert('يرجى إدخال قيم صحيحة');
        return;
    }

    selectedVehicleForRent.status = 'busy';
    await DB.saveRecord('fleet', selectedVehicleForRent);

    const durationMs = selectedVehicleForRent.billingType === 'timer' ? (units * 60000) : null;
    const sessions   = JSON.parse(UIState.get('activeSessions') || '[]');

    sessions.push({
        vehicleId:   selectedVehicleForRent.id,
        vehicleName: selectedVehicleForRent.name,
        vehicleType: selectedVehicleForRent.type,
        color:       selectedVehicleForRent.color,
        billingType: selectedVehicleForRent.billingType,
        price:       da,
        units:       units,
        totalMs:     durationMs,
        startTime:   Date.now(),
        expiresAt:   durationMs ? (Date.now() + durationMs) : null,
        alerts:      {}
    });

    UIState.set('activeSessions', JSON.stringify(sessions));
    closeModal('setup-modal');
    renderFleet();
    checkActiveSessions();
    updateNavBadge();
    document.querySelector('.nav-btn[data-target="rental-view"]').click();
}

// ── Active Sessions Display ────────────────
function checkActiveSessions() {
    const container = document.getElementById('active-rental-card');
    if (activeTimer) clearInterval(activeTimer);

    const render = () => {
        let sessions = JSON.parse(UIState.get('activeSessions') || '[]');
        updateNavBadge(sessions.length);

        if (sessions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🏁</span>
                    <h3>${translations[currentLang].activeSession}</h3>
                    <p>${currentLang === 'ar' ? 'لا توجد جلسات نشطة حالياً' : 'No active sessions'}</p>
                </div>`;
            return;
        }

        container.innerHTML = '';
        let needsSave = false;
        const circumference = 2 * Math.PI * 35; // r=35 for small ring

        sessions.forEach((s, idx) => {
            let timeDisplay = '';
            let timerClass  = '';
            let alertBanner = '';
            let ringOffset  = 0;
            let progressPct = 0;
            let cardClass   = 'session-card';
            let elapsedText = '';

            if (s.billingType === 'timer') {
                const remainingMs   = s.expiresAt - Date.now();
                const elapsedMs     = Date.now() - s.startTime;
                const remainingSecs = Math.floor(remainingMs / 1000);
                elapsedText = formatMs(elapsedMs);

                if (remainingMs <= 0) {
                    timeDisplay = '00:00';
                    timerClass  = 'danger';
                    cardClass   = 'session-card expired';
                    progressPct = 0;
                    alertBanner = `<div class="alert-banner">⛔ ${currentLang==='ar'?'انتهى الوقت!':'Time Expired!'}</div>`;
                    ringOffset  = circumference;
                    if (!s.alerts['0']) { s.alerts['0'] = true; needsSave = true; playAlert('expired'); }
                } else {
                    timeDisplay = formatMs(remainingMs);
                    progressPct = remainingMs / s.totalMs;
                    ringOffset  = circumference * (1 - progressPct);

                    if (remainingSecs <= 10) {
                        timerClass = 'danger'; cardClass = 'session-card expired';
                        alertBanner = `<div class="alert-banner">⚠️ ${currentLang==='ar'?'تبقى 10 ثوانٍ فقط!':'Only 10 seconds left!'}</div>`;
                        if (!s.alerts['10']) { s.alerts['10'] = true; needsSave = true; playAlert('warning10'); }
                    } else if (remainingSecs <= 30) {
                        timerClass = 'danger'; cardClass = 'session-card warning';
                        alertBanner = `<div class="alert-banner">⏰ ${currentLang==='ar'?'تبقى 30 ثانية!':'30 seconds left!'}</div>`;
                        if (!s.alerts['30']) { s.alerts['30'] = true; needsSave = true; playAlert('warning30'); }
                    } else if (remainingSecs <= 60) {
                        timerClass = 'warning'; cardClass = 'session-card warning';
                        alertBanner = `<div class="alert-banner" style="border-color:var(--warning);color:var(--warning);background:rgba(245,158,11,0.1);">⚡ ${currentLang==='ar'?'دقيقة أخيرة!':'Last minute!'}</div>`;
                        if (!s.alerts['60']) { s.alerts['60'] = true; needsSave = true; playAlert('warning60'); }
                    }
                }
            } else {
                timeDisplay = `${s.units} ${translations[currentLang].tour}`;
                progressPct = 0.7; // static for tours
                ringOffset  = circumference * 0.3;
                elapsedText = formatMs(Date.now() - s.startTime);
            }

            const qrBtn = s.billingType === 'timer'
                ? `<button class="btn btn-secondary btn-sm btn-icon" onclick="showActiveQR(${idx})">📱 QR</button>`
                : '';

            const fillClass = ['danger','warning'].includes(timerClass) ? 'danger-fill' : '';
            const barWidth  = s.billingType === 'timer' ? `${Math.max(0, progressPct * 100).toFixed(1)}%` : '70%';

            const card = document.createElement('div');
            card.className = cardClass;
            card.style.borderInlineStartColor = s.color || 'var(--accent)';

            card.innerHTML = `
                ${alertBanner}
                <div class="session-card-header">
                    <div>
                        <div class="session-vehicle-name">${s.vehicleType === 'scooter' ? '🛵' : '🚗'} ${s.vehicleName}</div>
                        <div class="elapsed-text">${currentLang==='ar'?'منذ':'since'} ${elapsedText}</div>
                    </div>
                    <div class="session-price-badge">${s.price} DA</div>
                </div>

                <div class="timer-container">
                    <div class="timer-ring">
                        <svg viewBox="0 0 80 80">
                            <circle class="ring-bg" cx="40" cy="40" r="35"/>
                            <circle class="ring-progress" cx="40" cy="40" r="35"
                                style="stroke-dasharray:${circumference};stroke-dashoffset:${ringOffset};stroke:${timerClass==='danger'?'var(--danger)':timerClass==='warning'?'var(--warning)':'var(--accent)'}"/>
                        </svg>
                        <div class="ring-text">${s.billingType==='timer' ? Math.max(0, Math.ceil((s.expiresAt - Date.now()) / 60000)) + 'm' : '🔁'}</div>
                    </div>
                    <div class="timer-info">
                        <div class="timer-display ${timerClass}" dir="ltr">${timeDisplay}</div>
                        <div class="timer-label">${currentLang==='ar'?'الوقت المتبقي':'Time Remaining'}</div>
                        <div class="progress-bar-wrap">
                            <div class="progress-bar-fill ${fillClass}" style="width:${barWidth}"></div>
                        </div>
                    </div>
                </div>

                <div class="session-actions">
                    ${qrBtn}
                    <button class="btn btn-danger btn-sm btn-icon" style="flex:1" onclick="endRental(${idx})">
                        🏁 ${translations[currentLang].endSession}
                    </button>
                </div>
            `;
            container.appendChild(card);
        });

        if (needsSave) UIState.set('activeSessions', JSON.stringify(sessions));
    };

    render();
    activeTimer = setInterval(render, 500);
}

// ── Show QR During Active Session ──────────
window.showActiveQR = function(index) {
    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    const s        = sessions[index];
    if (!s || s.billingType !== 'timer') return;

    const remainingMs = s.expiresAt - Date.now();
    if (remainingMs <= 0) {
        alert(currentLang === 'ar' ? 'الوقت منتهٍ' : 'Time expired');
        return;
    }

    const url = buildClientUrl(s.vehicleName, remainingMs, s.totalMs);
    const container = document.getElementById('active-qr-container');
    container.innerHTML = '';
    new QRCode(container, { text: url, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff' });

    document.getElementById('qr-modal-title').textContent = `📱 ${s.vehicleName}`;
    document.getElementById('qr-time-remaining').textContent = `⏱ ${formatMs(remainingMs)}`;
    document.getElementById('qr-modal').classList.remove('hidden');
};

// ── End Rental ─────────────────────────────
async function endRental(index) {
    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    const s        = sessions[index];

    const endTime   = Date.now();
    const elapsedMs = endTime - s.startTime;

    await DB.saveRecord('sessions', {
        vehicleName: s.vehicleName,
        vehicleId:   s.vehicleId,
        startTime:   s.startTime,
        endTime:     endTime,
        price:       s.price
    });

    const fleet   = await DB.getAll('fleet');
    const vehicle = fleet.find(v => v.id === s.vehicleId);
    if (vehicle) { vehicle.status = 'available'; await DB.saveRecord('fleet', vehicle); }

    sessions.splice(index, 1);
    UIState.set('activeSessions', JSON.stringify(sessions));
    renderFleet();
    checkActiveSessions();
    updateNavBadge(sessions.length);

    // Show summary
    showSessionSummary(s, elapsedMs);
}

function showSessionSummary(s, elapsedMs) {
    document.getElementById('summary-amount').textContent = `${s.price} DA`;
    const rows = [
        { label: currentLang==='ar'?'المركبة':'Vehicle', value: s.vehicleName },
        { label: currentLang==='ar'?'مدة التأجير':'Actual Duration', value: formatMs(elapsedMs) },
        { label: currentLang==='ar'?'النوع':'Type', value: s.billingType === 'timer' ? (currentLang==='ar'?'وقت':'Timed') : (currentLang==='ar'?'جولة':'Tours') },
        { label: currentLang==='ar'?'الوحدات':'Units', value: `${s.units} ${s.billingType==='timer'?translations[currentLang].min:translations[currentLang].tour}` },
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
    const sessions = await DB.getAll('sessions');
    const list     = document.getElementById('logs-list');
    list.innerHTML = '';

    if (sessions.length === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><h3>${currentLang==='ar'?'لا يوجد سجل':'No history'}</h3></div>`;
        return;
    }

    sessions.slice().reverse().forEach(s => {
        const li = document.createElement('li');
        const date = new Date(s.endTime).toLocaleDateString(currentLang === 'ar' ? 'ar-DZ' : 'en-GB');
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
    const sessions = await DB.getAll('sessions');
    if (sessions.length === 0) { alert(currentLang==='ar'?'لا توجد بيانات':'No data'); return; }

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
    if (ms < 0) ms = 0;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function buildClientUrl(name, remainingMs, totalMs) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?client=1&rem=${Math.max(0, remainingMs)}&total=${totalMs}&v=${encodeURIComponent(name)}`;
}

async function sha256(message) {
    const buf  = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}