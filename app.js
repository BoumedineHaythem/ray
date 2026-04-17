let currentLang = 'ar';
let activeTimer = null;
let selectedVehicleForRent = null;
const DEFAULT_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; 

document.addEventListener('DOMContentLoaded', async () => {
    // Check Client Mode (QR Scan)
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
});

// --- Client Mode ---
function initClientMode(params) {
    document.getElementById('app-content').classList.add('hidden');
    const clientView = document.getElementById('client-view');
    clientView.classList.remove('hidden');
    
    document.getElementById('client-vehicle-name').textContent = params.get('v');
    const expiresAt = parseInt(params.get('expiresAt'));
    
    setInterval(() => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            document.getElementById('client-timer').textContent = "00:00";
            document.getElementById('client-timer').style.color = "red";
        } else {
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            document.getElementById('client-timer').textContent = 
                `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }, 1000);
}

// --- Data Setup ---
async function initFleetDB() {
    const storedFleet = await DB.getAll('fleet');
    if (storedFleet.length === 0) {
        for (const vehicle of initialFleet) {
            await DB.saveRecord('fleet', vehicle);
        }
    }
}

// --- Events ---
function setupEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');
            if (targetId === 'logs-view') renderLogs();
        });
    });

    document.getElementById('theme-toggle').addEventListener('click', () => {
        applyTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark');
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
        } else alert("Invalid PIN");
    });

    // Auto-calculate logic in modal
    document.getElementById('setup-da').addEventListener('input', (e) => {
        if (!selectedVehicleForRent) return;
        const da = parseFloat(e.target.value) || 0;
        const units = (da / selectedVehicleForRent.rate) * selectedVehicleForRent.unit;
        document.getElementById('setup-unit').value = units;
    });

    document.getElementById('setup-unit').addEventListener('input', (e) => {
        if (!selectedVehicleForRent) return;
        const units = parseFloat(e.target.value) || 0;
        const da = (units / selectedVehicleForRent.unit) * selectedVehicleForRent.rate;
        document.getElementById('setup-da').value = da;
    });

    document.getElementById('confirm-rent-btn').addEventListener('click', finalizeStartRental);
}

// --- UI Logic ---
function applyTheme(theme) {
    document.body.className = theme === 'dark' ? 'dark-mode' : '';
    UIState.set('theme', theme);
}

function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('lang-toggle').textContent = lang === 'ar' ? 'EN' : 'AR';
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) el.textContent = translations[lang][key];
    });
    UIState.set('lang', lang);
    renderFleet();
    checkActiveSessions();
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// --- Fleet Render ---
async function renderFleet() {
    const fleet = await DB.getAll('fleet');
    const grid = document.getElementById('fleet-grid');
    grid.innerHTML = '';

    fleet.forEach(v => {
        const card = document.createElement('div');
        card.className = 'card';
        const t = translations[currentLang];
        const statusText = v.status === 'available' ? t.available : t.busy;
        const statusClass = v.status === 'available' ? 'status-available' : 'status-busy';
        
        card.innerHTML = `
            <div class="color-sticker" style="background-color: ${v.color};"></div>
            <img src="${v.img}" alt="${v.name}" loading="lazy">
            <h3>${v.name}</h3>
            <p>${v.rate} DA / ${v.unit} ${v.billingType === 'timer' ? t.min : t.tour}</p>
            <span class="status-badge ${statusClass}">${statusText}</span>
            ${v.status === 'available' ? `<button class="btn btn-primary" onclick="openRentalSetup('${v.id}')">${t.rentNow}</button>` : ''}
        `;
        grid.appendChild(card);
    });
}

// --- Rental Setup ---
async function openRentalSetup(vehicleId) {
    const fleet = await DB.getAll('fleet');
    selectedVehicleForRent = fleet.find(v => v.id === vehicleId);
    
    document.getElementById('setup-title').textContent = selectedVehicleForRent.name;
    document.getElementById('setup-da').value = selectedVehicleForRent.rate;
    document.getElementById('setup-unit').value = selectedVehicleForRent.unit;
    
    const label = selectedVehicleForRent.billingType === 'timer' ? translations[currentLang].min : translations[currentLang].tour;
    document.getElementById('setup-unit-label').textContent = label + ":";

    document.getElementById('setup-modal').classList.remove('hidden');
}

async function finalizeStartRental() {
    const units = parseFloat(document.getElementById('setup-unit').value);
    const da = parseFloat(document.getElementById('setup-da').value);
    
    selectedVehicleForRent.status = 'busy';
    await DB.saveRecord('fleet', selectedVehicleForRent);

    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    
    // Calculate expiration if timer based
    const durationMs = selectedVehicleForRent.billingType === 'timer' ? (units * 60000) : null;
    
    const newSession = {
        vehicleId: selectedVehicleForRent.id,
        vehicleName: selectedVehicleForRent.name,
        color: selectedVehicleForRent.color,
        price: da, // Fixed amount based on custom setup
        units: units,
        billingType: selectedVehicleForRent.billingType,
        startTime: Date.now(),
        expiresAt: durationMs ? (Date.now() + durationMs) : null,
        alerts: {} // To track 60s, 30s, 10s alerts
    };
    
    sessions.push(newSession);
    UIState.set('activeSessions', JSON.stringify(sessions));
    
    closeModal('setup-modal');
    renderFleet();
    checkActiveSessions();
    document.querySelector('.nav-btn[data-target="rental-view"]').click();
}

// --- Beep Sound Generator ---
function playBeep(freq, duration) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(ctx.destination);
        osc.start();
        setTimeout(() => osc.stop(), duration);
    } catch(e) {}
}

// --- Multi-Session Monitor (Countdown & Alerts) ---
function checkActiveSessions() {
    const container = document.getElementById('active-rental-card');
    
    if (activeTimer) clearInterval(activeTimer);
    
    activeTimer = setInterval(() => {
        let sessions = JSON.parse(UIState.get('activeSessions') || '[]');
        if (sessions.length === 0) {
            container.innerHTML = `<p style="padding:20px; color:var(--text-secondary); text-align:center;">لا توجد جلسات</p>`;
            return;
        }

        container.innerHTML = ''; 
        let needsSave = false;

        sessions.forEach((s, index) => {
            let timeDisplay = "";
            let timerClass = "";

            if (s.billingType === 'timer') {
                const remainingMs = s.expiresAt - Date.now();
                const remainingSecs = Math.floor(remainingMs / 1000);

                // --- ALERTS LOGIC ---
                if (remainingSecs === 60 && !s.alerts['60']) {
                    s.alerts['60'] = true; needsSave = true;
                    if(navigator.vibrate) navigator.vibrate([200, 100, 200]);
                    playBeep(440, 500);
                } else if (remainingSecs === 30 && !s.alerts['30']) {
                    s.alerts['30'] = true; needsSave = true;
                    if(navigator.vibrate) navigator.vibrate([100, 100, 100, 100, 100]);
                    playBeep(600, 300); setTimeout(() => playBeep(600, 300), 400);
                } else if (remainingSecs === 10 && !s.alerts['10']) {
                    s.alerts['10'] = true; needsSave = true;
                    playBeep(800, 200); setTimeout(() => playBeep(800, 200), 300); setTimeout(() => playBeep(800, 500), 600);
                }

                if (remainingMs <= 0) {
                    timeDisplay = "00:00 (منتهي)";
                    timerClass = "text-danger";
                } else {
                    const m = Math.floor(remainingMs / 60000);
                    const sec = Math.floor((remainingMs % 60000) / 1000);
                    timeDisplay = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
                    if(remainingSecs <= 30) timerClass = "text-danger";
                }
            } else {
                timeDisplay = `${s.units} ${translations[currentLang].tour}`;
            }

            const card = document.createElement('div');
            card.className = `card`;
            card.style.borderInlineStart = `5px solid ${s.color}`;
            card.style.marginBottom = "12px";
            
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="text-align: ${currentLang === 'ar' ? 'right' : 'left'}; width:100%">
                        <strong>${s.vehicleName}</strong>
                        <p class="${timerClass}" style="font-size: 1.5rem; margin: 5px 0;" dir="ltr">${timeDisplay}</p>
                        <p><strong>${s.price} DA</strong></p>
                        <div style="margin-top:10px; display:flex; gap:10px;">
                            <button class="btn btn-secondary" style="margin:0; padding:8px;" onclick="showQR('${s.expiresAt}', '${s.vehicleName}')">QR</button>
                            <button class="btn btn-danger" style="margin:0; padding:8px; flex:1;" onclick="endRental(${index})">
                                ${translations[currentLang].endSession}
                            </button>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

        if (needsSave) UIState.set('activeSessions', JSON.stringify(sessions));

    }, 1000);
}

// --- Generate QR ---
function showQR(expiresAt, vName) {
    if(!expiresAt || expiresAt === 'null') {
        alert("QR متوفر فقط للمركبات بالوقت"); return;
    }
    const qrContainer = document.getElementById('qr-container');
    qrContainer.innerHTML = ''; 
    
    // بناء الرابط الخاص بالعميل
    const currentUrl = window.location.origin + window.location.pathname;
    const clientUrl = `${currentUrl}?client=1&expiresAt=${expiresAt}&v=${encodeURIComponent(vName)}`;
    
    new QRCode(qrContainer, {
        text: clientUrl,
        width: 200,
        height: 200
    });
    
    document.getElementById('qr-modal').classList.remove('hidden');
}

// --- End Rental ---
async function endRental(index) {
    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    const session = sessions[index];
    
    await DB.saveRecord('sessions', {
        vehicleName: session.vehicleName,
        vehicleId: session.vehicleId,
        startTime: session.startTime,
        endTime: Date.now(),
        price: session.price
    });

    const fleet = await DB.getAll('fleet');
    const vehicle = fleet.find(v => v.id === session.vehicleId);
    if (vehicle) {
        vehicle.status = 'available';
        await DB.saveRecord('fleet', vehicle);
    }

    sessions.splice(index, 1);
    UIState.set('activeSessions', JSON.stringify(sessions));
    
    renderFleet();
    checkActiveSessions();
}

// --- Utilities ---
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);                    
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}