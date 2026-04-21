// ============================================
//  storage.js — IndexedDB + Supabase hybrid
// ============================================

const DB_NAME    = 'EVRentalDB';
const DB_VERSION = 1;

const DB = {
    async init() {
        return new Promise((resolve, reject) => {
            const r = indexedDB.open(DB_NAME, DB_VERSION);
            r.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('sessions'))
                    db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('fleet'))
                    db.createObjectStore('fleet', { keyPath: 'id' });
            };
            r.onsuccess = (e) => resolve(e.target.result);
            r.onerror   = (e) => reject(e.target.error);
        });
    },
    async saveRecord(storeName, data) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(data);
            tx.oncomplete = () => resolve(true);
            tx.onerror    = () => reject(tx.error);
        });
    },
    async getAll(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }
};

const UIState = {
    get:    (k)   => localStorage.getItem(k),
    set:    (k,v) => localStorage.setItem(k, v),
    remove: (k)   => localStorage.removeItem(k)
};

// ── Supabase REST helpers ──────────────────
const SupaDB = {
    _h() {
        return {
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=representation'
        };
    },
    async get(table, qs = '') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: this._h() });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async post(table, data) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST', headers: this._h(), body: JSON.stringify(data)
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async patch(table, qs, data) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
            method: 'PATCH', headers: this._h(), body: JSON.stringify(data)
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    }
};

// ── Session Store ──────────────────────────
const SessionStore = {
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
            graceUntil:  row.grace_until || null,
            alerts:      {}
        };
    },

    async getActive() {
        if (USE_SUPABASE) {
            try {
                const rows = await SupaDB.get('sessions', 'status=eq.active&order=created_at.asc');
                return rows.map(r => this._fromRow(r));
            } catch(e) { console.warn('Supabase getActive failed:', e.message); }
        }
        return JSON.parse(UIState.get('activeSessions') || '[]');
    },

    async getActiveForVehicle(vehicleId) {
        if (USE_SUPABASE) {
            try {
                const rows = await SupaDB.get('sessions',
                    `vehicle_id=eq.${vehicleId}&status=eq.active&order=created_at.desc&limit=1`);
                return rows.length ? this._fromRow(rows[0]) : null;
            } catch(e) { console.warn('Supabase vehicle fetch failed:', e.message); return null; }
        }
        const sessions = JSON.parse(UIState.get('activeSessions') || '[]');
        return sessions.find(s => s.vehicleId === vehicleId) || null;
    },

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
            } catch(e) { console.warn('Supabase save failed:', e.message); }
        }
        // FIX: Always save locally for offline fallback
        const active = JSON.parse(UIState.get('activeSessions') || '[]');
        active.push(session);
        UIState.set('activeSessions', JSON.stringify(active));
        return session;
    },

    async endSession(session, endTime) {
        session.endTime = endTime; // Attach for analytics
        
        if (USE_SUPABASE && session.supabaseId) {
            try {
                await SupaDB.patch('sessions', `id=eq.${session.supabaseId}`,
                    { status: 'completed', end_time: endTime });
            } catch(e) { console.warn('Supabase end failed:', e.message); }
        }
        
        // FIX: Remove from active UI state
        const active = JSON.parse(UIState.get('activeSessions') || '[]');
        const updated = active.filter(s => s.vehicleId !== session.vehicleId);
        UIState.set('activeSessions', JSON.stringify(updated));

        // FIX: Save to IndexedDB so Analytics & History tab work
        await DB.saveRecord('sessions', session);
    },

    async extendSession(session) {
        if (USE_SUPABASE && session.supabaseId) {
            try {
                await SupaDB.patch('sessions', `id=eq.${session.supabaseId}`,
                    { expires_at: session.expiresAt, total_ms: session.totalMs });
            } catch(e) { console.warn('Supabase extend failed:', e.message); }
        }
        
        // FIX: Update local storage
        const active = JSON.parse(UIState.get('activeSessions') || '[]');
        const idx = active.findIndex(s => s.vehicleId === session.vehicleId);
        if (idx > -1) {
            active[idx] = session;
            UIState.set('activeSessions', JSON.stringify(active));
        }
    },

    // FIX: Add missing function expected by app.js
    saveLocalAlerts(sessions) {
        UIState.set('activeSessions', JSON.stringify(sessions));
    },

    async getCompleted() {
        return DB.getAll('sessions');
    }
};