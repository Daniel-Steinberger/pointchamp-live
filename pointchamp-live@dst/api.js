// PointChamp-Client für die externe API (Soup 3). Wird von extension.js und prefs.js benutzt,
// darf daher nichts aus der Shell importieren.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Secret from 'gi://Secret';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const TOKEN_TTL_SECONDS = 50 * 60; // Token gilt 60 min, wir erneuern nach 50

export const SECRET_SCHEMA = new Secret.Schema(
    'org.gnome.shell.extensions.pointchamp-live',
    Secret.SchemaFlags.NONE,
    {server: Secret.SchemaAttributeType.STRING, username: Secret.SchemaAttributeType.STRING});

export function lookupPassword(server, username) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(SECRET_SCHEMA, {server, username}, null, (_src, res) => {
            try {
                resolve(Secret.password_lookup_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function storePassword(server, username, password) {
    return new Promise((resolve, reject) => {
        Secret.password_store(SECRET_SCHEMA, {server, username}, Secret.COLLECTION_DEFAULT,
            `PointChamp Live (${username})`, password, null, (_src, res) => {
                try {
                    resolve(Secret.password_store_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

export class PointChampClient {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.username = username;
        this.password = password;
        this._token = null;
        this._tokenTime = 0;
        this._session = new Soup.Session({timeout: 25, user_agent: 'pointchamp-live-gnome/1'});
    }

    async _request(method, path, {params = null, json = null, bearer = null, cancellable = null} = {}) {
        let url = `${this.baseUrl}${path}`;
        if (params)
            url += `?${Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
        const msg = Soup.Message.new(method, url);
        msg.request_headers.append('Accept', 'application/json');
        if (bearer)
            msg.request_headers.append('Authorization', `Bearer ${bearer}`);
        if (json !== null)
            msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify(json))));
        const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
        const status = msg.get_status();
        const text = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
        if (status < 200 || status >= 300)
            throw new ApiError(`${method} ${path} → HTTP ${status}`, status);
        return JSON.parse(text);
    }

    async token(cancellable = null) {
        const now = GLib.get_monotonic_time() / 1e6;
        if (this._token && now - this._tokenTime < TOKEN_TTL_SECONDS)
            return this._token;
        const data = await this._request('POST', '/external/api/login_check', {
            json: {username: this.username, password: this.password}, cancellable,
        });
        this._token = data.token;
        this._tokenTime = now;
        return this._token;
    }

    invalidateToken() {
        this._token = null;
    }

    async _get(path, params, cancellable) {
        const bearer = await this.token(cancellable);
        try {
            return await this._request('GET', path, {params, bearer, cancellable});
        } catch (e) {
            if (e instanceof ApiError && e.status === 401) {
                this.invalidateToken();
                const fresh = await this.token(cancellable);
                return this._request('GET', path, {params, bearer: fresh, cancellable});
            }
            throw e;
        }
    }

    /** Stempelsegmente aller Mitarbeiter für einen Tag (YYYY-MM-DD). */
    trackingDays(date, cancellable = null) {
        return this._get('/external/api/time/tracking/days', {start: date, end: date}, cancellable);
    }

    /** Abwesenheiten, die den Tag berühren. */
    absences(date, cancellable = null) {
        return this._get('/external/api/employee/absence/', {start: date, end: date}, cancellable);
    }
}

// ---------------------------------------------------------------- Auswertung

function parseHms(s) {
    const [h, m, sec] = s.split(':').map(Number);
    return h + m / 60 + (sec || 0) / 3600;
}

function parseDeDate(s) {
    const [d, m, y] = s.split('.').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function normalizeName(name) {
    return name.replace(/\s+/g, ' ').trim();
}

/**
 * Baut aus den Rohdaten eine Zeile je Person.
 * @returns {Array<{name, department, status, segments, absence, plannedHome, workedMinutes, dayStart, dayEnd}>}
 *   status ∈ 'work' | 'pause' | 'done' | 'absent' | 'none'
 */
export function buildRows(tracking, absences, date, nowHours) {
    const absByName = new Map();
    for (const a of absences ?? []) {
        const von = parseDeDate(a.von), bis = parseDeDate(a.bis);
        if (von <= date && date <= bis) {
            const key = normalizeName(a.name);
            if (!absByName.has(key))
                absByName.set(key, []);
            absByName.get(key).push(a.art);
        }
    }

    const rows = [];
    for (const p of tracking ?? []) {
        const name = normalizeName(p.name);
        const day = Array.isArray(p.days) ? null : p.days?.[date] ?? null;
        const arts = absByName.get(name) ?? [];
        const plannedHome = arts.includes('Homeoffice*');
        const absence = arts.find(a => a !== 'Homeoffice*') ?? null;

        let segments = [];
        if (day?.detail) {
            const raw = Array.isArray(day.detail[0]) ? day.detail.flat() : day.detail;
            for (const seg of raw) {
                if (typeof seg.minutes === 'number' && seg.minutes < 0)
                    continue; // Pausenkorrektur nach Tagesende
                const open = seg.minutes === null || seg.minutes === undefined;
                segments.push({
                    start: parseHms(seg.start),
                    end: open ? nowHours : parseHms(seg.end),
                    pause: !!seg.break,
                    open,
                });
            }
        }

        let status = 'none';
        const openSeg = segments.find(s => s.open);
        if (openSeg)
            status = openSeg.pause ? 'pause' : 'work';
        else if (segments.length)
            status = 'done';
        else if (absence)
            status = 'absent';

        const workedMinutes = Math.round(segments.filter(s => !s.pause).reduce((sum, s) => sum + (s.end - s.start) * 60, 0));
        rows.push({
            name, department: p.department, status, segments, absence, plannedHome, workedMinutes,
            dayStart: day?.start ?? null, dayEnd: day?.end ?? null,
        });
    }
    return rows;
}

export function formatDuration(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return `${h} h ${String(m).padStart(2, '0')}`;
}

export const STATUS_ORDER = {work: 0, pause: 1, done: 2, none: 3, absent: 4};

export function sortRows(rows) {
    return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, 'de'));
}
