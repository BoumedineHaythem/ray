// ============================================
//  storage.js — IndexedDB + Supabase hybrid
// ============================================

const DB_NAME    = 'EVRentalDB';
const DB_VERSION = 1;

// ── IndexedDB (local backup + analytics) ──
const DB = {
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('sessions'))
                    db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('fleet'))
                    db.createObjectStore('fleet', { keyPath: 'id' });
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror   = (e) => reject(e.target.error);
        });
    },
    async saveRecord(storeName, data) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put(data);
            tx.oncomplete = () => resolve(true);
            tx.onerror    = () => reject(tx.error);
        });
    },
    async getAll(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx      = db.transaction(storeName, 'readonly');
            const store   = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror   = () => reject(request.error);
        });
    }
};

// ── localStorage helpers ──────────────────
const UIState = {
    get:    (key)        => localStorage.getItem(key),
    set:    (key, value) => localStorage.setItem(key, value),
    remove: (key)        => localStorage.removeItem(key)
};

// ── Supabase REST API (no SDK needed) ─────
const SupaDB = {
    _headers() {
        return {
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=representation'
        };
    },
    async get(table, qs = '') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
            headers: this._headers()
        });
        if (!r.ok) throw new Error(`GET ${table}: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async post(table, data) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method:  'POST',
            headers: this._headers(),
            body:    JSON.stringify(data)
        });
        if (!r.ok) throw new Error(`POST ${table}: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async patch(table, qs, data) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
            method:  'PATCH',
            headers: this._headers(),
            body:    JSON.stringify(data)
        });
        if (!r.ok) throw new Error(`PATCH ${table}: ${r.status} ${await r.text()}`);
        return r.json();
    }
};

// ── Session Store (abstraction layer) ─────
// Maps between Supabase snake_case and local camelCase
const SessionStore = {

    // Convert Supabase row → local session object
    _fromRow(row) {
        return {
            supabaseId:  row.id,
            vehicleId:   row.vehicle_id,
            vehicleName: row.vehicle_name,
            vehicleType: row.vehicle_type,
            billingType: row.billing_type,
            color:       row.color,
            price:       row.price,
            units:       row.units,
            totalMs:     row.total_ms,
            startTime:   row.start_time,
            expiresAt:   row.expires_at,
            graceUntil:  row.grace_until,
            alerts:      {}
        };
    },

    // Get all active sessions (admin view)
    async getActive() {
        if (USE_SUPABASE) {
            try {
                const rows = await SupaDB.get('sessions',
                    'status=eq.active&order=created_at.asc');
                return rows.map(r => this._fromRow(r));
            } catch(e) {
                console.warn('Supabase offline → localStorage fallback:', e.message);
            }
        }
        return JSON.parse(UIState.get('activeSessions') || '[]');
    },

    // Get active session for a specific vehicle (client QR view — cross-device)
    async getActiveForVehicle(vehicleId) {
        if (USE_SUPABASE) {
            try {
                const rows = await SupaDB.get('sessions',
                    `vehicle_id=eq.${vehicleId}&status=eq.active&order=created_at.desc&limit=1`);
                return rows.length ? this._fromRow(rows[0]) : null;
            } catch(e) {
                console.warn('Supabase vehicle fetch failed:', e.message);
                return null;
            }
        }
        // Offline fallback (only works if same device as admin)
        const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
        return sessions.find(s => s.vehicleId === vehicleId) || null;
    },

    // Save new active session
    async saveActive(session) {
        if (USE_SUPABASE) {
            try {
                const rows = await SupaDB.post('sessions', {
                    vehicle_id:   session.vehicleId,
                    vehicle_name: session.vehicleName,
                    vehicle_type: session.vehicleType,
                    billing_type: session.billingType,
                    color:        session.color,
                    price:        session.price,
                    units:        session.units,
                    total_ms:     session.totalMs,
                    start_time:   session.startTime,
                    expires_at:   session.expiresAt,
                    grace_until:  session.graceUntil,
                    status:       'active'
                });
                if (rows[0]) session.supabaseId = rows[0].id;
            } catch(e) {
                console.warn('Supabase save failed → localStorage only:', e.message);
            }
        }
        // Always mirror to localStorage (offline backup + alerts state)
        const local = JSON.parse(UIState.get('activeSessions') || '[]');
        local.push(session);
        UIState.set('activeSessions', JSON.stringify(local));
        return session;
    },

    // End a session
    async endSession(session, endTime) {
        if (USE_SUPABASE && session.supabaseId) {
            try {
                await SupaDB.patch('sessions',
                    `id=eq.${session.supabaseId}`,
                    { status: 'completed', end_time: endTime }
                );
            } catch(e) {
                console.warn('Supabase end session failed:', e.message);
            }
        }
        // Local IndexedDB (for analytics/logs)
        await DB.saveRecord('sessions', {
            vehicleName: session.vehicleName,
            vehicleId:   session.vehicleId,
            startTime:   session.startTime,
            endTime,
            price:       session.price
        });
        // Remove from localStorage
        const local = JSON.parse(UIState.get('activeSessions') || '[]');
        UIState.set('activeSessions',
            JSON.stringify(local.filter(s => s.vehicleId !== session.vehicleId)));
    },

    // Extend session duration (add minutes)
    async extendSession(session, addMs) {
        session.expiresAt += addMs;
        session.totalMs   += addMs;
        if (USE_SUPABASE && session.supabaseId) {
            try {
                await SupaDB.patch('sessions',
                    `id=eq.${session.supabaseId}`,
                    { expires_at: session.expiresAt, total_ms: session.totalMs }
                );
            } catch(e) {
                console.warn('Supabase extend failed:', e.message);
            }
        }
        // Update localStorage
        const local = JSON.parse(UIState.get('activeSessions') || '[]');
        const idx   = local.findIndex(s => s.vehicleId === session.vehicleId);
        if (idx >= 0) {
            local[idx].expiresAt = session.expiresAt;
            local[idx].totalMs   = session.totalMs;
            UIState.set('activeSessions', JSON.stringify(local));
        }
        return session;
    },

    // Persist alert state (local only — no need to sync)
    saveLocalAlerts(sessions) {
        const local = JSON.parse(UIState.get('activeSessions') || '[]');
        sessions.forEach(s => {
            const li = local.find(l => l.vehicleId === s.vehicleId);
            if (li) li.alerts = s.alerts;
        });
        UIState.set('activeSessions', JSON.stringify(local));
    },

    // Get completed sessions for analytics
    async getCompleted() {
        // Always read from local IndexedDB (mirrors Supabase completed sessions)
        return DB.getAll('sessions');
    }
};