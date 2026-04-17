let currentLang = 'ar';
let activeTimer = null;
const DEFAULT_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; // "1234" in SHA-256

// --- Init Application ---
document.addEventListener('DOMContentLoaded', async () => {
    await initFleetDB();
    setupEventListeners();
    applyTheme(UIState.get('theme') || 'dark');
    setLanguage(UIState.get('lang') || 'ar');
    renderFleet();
    checkActiveSessions();
    updateOnlineStatus();
});

// --- Data & State Setup ---
async function initFleetDB() {
    const storedFleet = await DB.getAll('fleet');
    if (storedFleet.length === 0) {
        for (const vehicle of initialFleet) {
            await DB.saveRecord('fleet', vehicle);
        }
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');

            if (targetId === 'logs-view') renderLogs();
            if (targetId === 'analytics-view') document.getElementById('pin-input').value = '';
        });
    });

    // Theme & Lang
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
        applyTheme(newTheme);
    });

    document.getElementById('lang-toggle').addEventListener('click', () => {
        currentLang = currentLang === 'ar' ? 'en' : 'ar';
        setLanguage(currentLang);
    });

    // Analytics PIN
    document.getElementById('unlock-analytics-btn').addEventListener('click', async () => {
        const pin = document.getElementById('pin-input').value;
        const hash = await sha256(pin);
        if (hash === DEFAULT_PIN_HASH) {
            document.getElementById('pin-protection').classList.add('hidden');
            document.getElementById('analytics-dashboard').classList.remove('hidden');
            renderAnalytics();
        } else {
            showAlert(translations[currentLang].enterPin, "Invalid PIN");
        }
    });

    // Offline / Online
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Modal
    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('alert-modal').classList.add('hidden');
    });

    // CSV Export
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
}

// --- UI Logic ---
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    UIState.set('theme', theme);
}

function setLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('lang-toggle').textContent = lang === 'ar' ? 'EN' : 'AR';
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });
    UIState.set('lang', lang);
    renderFleet(); // re-render to translate statuses
    checkActiveSessions();
}

function updateOnlineStatus() {
    const banner = document.getElementById('offline-banner');
    if (navigator.onLine) banner.classList.add('hidden');
    else banner.classList.remove('hidden');
}

function showAlert(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('alert-modal').classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// --- Core Features ---
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
        const priceText = v.billingType === 'timer' ? `${v.rate} DA / ${v.unit} min` : `${v.rate} DA / Tour`;
        
        card.innerHTML = `
            <img src="${v.img}" alt="${v.name}" loading="lazy">
            <h3>${v.name}</h3>
            <p>${priceText}</p>
            <span class="status-badge ${statusClass}">${statusText}</span>
            ${v.status === 'available' ? `<button class="btn btn-primary" onclick="startRental('${v.id}')">${t.rentNow}</button>` : ''}
        `;
        grid.appendChild(card);
    });
}

// --- Start Rental ---
async function startRental(vehicleId) {
    const fleet = await DB.getAll('fleet');
    const vehicle = fleet.find(v => v.id === vehicleId);
    
    vehicle.status = 'busy';
    await DB.saveRecord('fleet', vehicle);

    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    
    const newSession = {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        rate: vehicle.rate,
        unit: vehicle.unit,
        billingType: vehicle.billingType,
        startTime: Date.now()
    };
    
    sessions.push(newSession);
    UIState.set('activeSessions', JSON.stringify(sessions));
    
    renderFleet();
    checkActiveSessions();
    
    // Switch to Rental View
    document.querySelector('.nav-btn[data-target="rental-view"]').click();
}

function calculateCurrentPrice(session) {
    if (session.billingType === 'flat') {
        return session.rate;
    } else {
        const elapsedMs = Date.now() - session.startTime;
        const elapsedMins = Math.max(0, elapsedMs / 60000);
        const blocks = Math.ceil(elapsedMins / session.unit);
        return (blocks === 0 ? 1 : blocks) * session.rate;
    }
}

// --- Multi-Session Monitor ---
function checkActiveSessions() {
    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    const container = document.getElementById('active-rental-card');
    
    if (sessions.length > 0) {
        if (activeTimer) clearInterval(activeTimer);
        
        activeTimer = setInterval(() => {
            const currentSessions = JSON.parse(UIState.get('activeSessions') || '[]');
            container.innerHTML = ''; 

            currentSessions.forEach((s, index) => {
                let timeDisplay = "";
                const currentPrice = calculateCurrentPrice(s);

                if (s.billingType === 'timer') {
                    // Count up timer
                    const elapsedMs = Date.now() - s.startTime;
                    const m = Math.floor(elapsedMs / 60000);
                    const sec = Math.floor((elapsedMs % 60000) / 1000);
                    timeDisplay = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
                } else {
                    timeDisplay = currentLang === 'ar' ? "جولة واحدة" : "One Tour";
                }

                const card = document.createElement('div');
                card.className = `card`;
                card.style.borderInlineStart = s.billingType === 'timer' ? "5px solid var(--accent)" : "5px solid var(--success)";
                card.style.marginBottom = "12px";
                
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="text-align: ${currentLang === 'ar' ? 'right' : 'left'};">
                            <strong>${s.vehicleName}</strong>
                            <p style="font-size: 1.5rem; margin: 5px 0;" dir="ltr">${timeDisplay}</p>
                            <p>${currentLang === 'ar' ? 'السعر' : 'Price'}: <strong>${currentPrice} DA</strong></p>
                        </div>
                        <button class="btn btn-danger" style="width:auto; padding: 10px 20px; margin: 0;" onclick="endRental(${index})">
                            ${currentLang === 'ar' ? 'إنهاء' : 'End'}
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });
        }, 1000);
    } else {
        container.innerHTML = `<p style="padding:20px; color:var(--text-secondary); text-align:center;">${currentLang === 'ar' ? 'لا توجد جلسات نشطة حالياً' : 'No active sessions'}</p>`;
        if (activeTimer) clearInterval(activeTimer);
    }
}

// --- End Rental ---
async function endRental(index) {
    const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
    const session = sessions[index];
    
    const finalPrice = calculateCurrentPrice(session);
    const durationMins = (Date.now() - session.startTime) / 60000;

    // Save to History (IndexedDB)
    await DB.saveRecord('sessions', {
        vehicleName: session.vehicleName,
        vehicleId: session.vehicleId,
        startTime: session.startTime,
        endTime: Date.now(),
        durationMins: durationMins,
        price: finalPrice
    });

    // Make vehicle available again
    const fleet = await DB.getAll('fleet');
    const vehicle = fleet.find(v => v.id === session.vehicleId);
    if (vehicle) {
        vehicle.status = 'available';
        await DB.saveRecord('fleet', vehicle);
    }

    // Remove from active list
    sessions.splice(index, 1);
    UIState.set('activeSessions', JSON.stringify(sessions));
    
    renderFleet();
    checkActiveSessions();
    
    showAlert(translations[currentLang].rental, translations[currentLang].sessionEnded + ` ${finalPrice} DA`);
}

async function renderLogs() {
    const sessions = await DB.getAll('sessions');
    const list = document.getElementById('logs-list');
    list.innerHTML = '';
    
    // Reverse chronological
    sessions.sort((a,b) => b.endTime - a.endTime).forEach(session => {
        const li = document.createElement('li');
        const date = new Date(session.startTime).toLocaleString(currentLang === 'ar' ? 'ar-SA' : 'en-US');
        li.innerHTML = `
            <div>
                <strong>${session.vehicleName}</strong><br>
                <small>${date}</small>
            </div>
            <div style="text-align: ${currentLang === 'ar' ? 'left' : 'right'};">
                <strong>${session.price.toFixed(2)} DA</strong><br>
                <small>${Math.ceil(session.durationMins || 0)} min</small>
            </div>
        `;
        list.appendChild(li);
    });
}

// --- Utilities ---
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);                    
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function exportCSV() {
    const sessions = await DB.getAll('sessions');
    if (sessions.length === 0) return showAlert('Export', 'No data available');

    let csv = 'ID,Vehicle,Start,End,Duration(min),Revenue(DA)\n';
    sessions.forEach((s, idx) => {
        csv += `${idx + 1},${s.vehicleName},${new Date(s.startTime).toISOString()},${new Date(s.endTime).toISOString()},${(s.durationMins||0).toFixed(2)},${s.price.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'ev_revenue_logs.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}