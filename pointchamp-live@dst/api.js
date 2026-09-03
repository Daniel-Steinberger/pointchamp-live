// PointChamp-Client für die externe API (Soup 3). Wird von extension.js und prefs.js benutzt,
// darf daher nichts aus der Shell importieren – und kein libsecret (siehe secret.js).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const TOKEN_TTL_SECONDS = 50 * 60; // Token gilt 60 min, wir erneuern nach 50

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
        this._session = new Soup.Session({timeout: 25, user_agent: 'pointchamp-live-gnome/1', max_conns_per_host: 8});
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

    /** Stammdaten aller Mitarbeiter (schnell, ~0,2 s): Name, Abteilung, Austrittsdatum. */
    mastaData(cancellable = null) {
        return this._get('/external/api/employee/masta/data/', {}, cancellable);
    }

    /**
     * Tagesbuchungen nur für die genannten Personen. Der volle Abruf braucht ~10 s (81 Personen),
     * eine Namenssuche unter 1 s; parallel sind 15 Personen in ~2 s da.
     * Namenssuche ist Teilstring-Suche, daher wird nach id dedupliziert.
     */
    async trackingDaysFor(date, names, cancellable = null, onProgress = null) {
        const byId = new Map();
        let done = 0;
        await Promise.all(names.map(async n => {
            const list = await this._get('/external/api/time/tracking/days', {start: date, end: date, search: n}, cancellable);
            for (const p of list)
                byId.set(p.id, p);
            done++;
            // Teilergebnis melden, damit die Oberfläche schon anzeigen kann, was da ist
            onProgress?.([...byId.values()], done, names.length);
        }));
        return [...byId.values()];
    }

    /** Abwesenheiten im Zeitraum (Standard: nur der Tag). Ein größeres Fenster erlaubt es,
     *  direkt anschließende Abwesenheiten zusammenzufassen. */
    absences(date, endDate = null, cancellable = null) {
        return this._get('/external/api/employee/absence/', {start: date, end: endDate ?? date}, cancellable);
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

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function isoToDateTime(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return GLib.DateTime.new_local(y, m, d, 0, 0, 0);
}

export function addDays(iso, n) {
    return isoToDateTime(iso).add_days(n).format('%Y-%m-%d');
}

export function daysBetween(fromIso, toIso) {
    return Math.round(isoToDateTime(toIso).difference(isoToDateTime(fromIso)) / GLib.TIME_SPAN_DAY);
}

/** „Fr, 04.09." */
export function formatDateShort(iso) {
    const dt = isoToDateTime(iso);
    return `${WEEKDAYS[dt.get_day_of_week() % 7]}, ${dt.format('%d.%m.')}`;
}

/** Nächster Werktag (Mo–Fr) nach dem Datum; Feiertage werden nicht berücksichtigt. */
export function nextWorkday(iso) {
    let dt = isoToDateTime(iso).add_days(1);
    while (dt.get_day_of_week() >= 6)
        dt = dt.add_days(1);
    return dt.format('%Y-%m-%d');
}

/** Namen (wie in tracking/days) der aktiven Mitarbeiter in den gewählten Abteilungen. */
export function namesForDepartments(masta, departments, today) {
    const wanted = new Set(departments);
    return masta
        .filter(p => wanted.has(p.department))
        .filter(p => !p.leavingDate || p.leavingDate >= today)
        .map(p => normalizeName(`${p.firstname} ${p.lastname}`));
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
    const absByName = new Map(); // Name → Arten, die den Tag berühren
    const allByName = new Map(); // Name → alle Abwesenheiten {von, bis, art}
    for (const a of absences ?? []) {
        const von = parseDeDate(a.von), bis = parseDeDate(a.bis);
        const key = normalizeName(a.name);
        if (!allByName.has(key))
            allByName.set(key, []);
        allByName.get(key).push({von, bis, art: a.art});
        if (von <= date && date <= bis) {
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

        const workedMinutes = Math.max(0, Math.round(segments.filter(s => !s.pause).reduce((sum, s) => sum + (s.end - s.start) * 60, 0)));

        // Ende der zusammenhängenden Abwesenheit: direkt anschließende Einträge (z. B. Urlaub + Resturlaub) zusammenfassen
        let absenceUntil = null;
        if (absence) {
            const own = (allByName.get(name) ?? []).filter(a => a.art !== 'Homeoffice*');
            absenceUntil = own.filter(a => a.von <= date && date <= a.bis).map(a => a.bis).sort().pop();
            let extended = true;
            while (extended) {
                extended = false;
                // Wochenenden überbrücken: eine Abwesenheit ab dem nächsten Werktag schließt an
                const next = nextWorkday(absenceUntil);
                for (const a of own) {
                    if (a.von <= next && a.bis > absenceUntil) {
                        absenceUntil = a.bis;
                        extended = true;
                    }
                }
            }
        }
        rows.push({
            name, department: p.department, status, segments, absence, plannedHome, workedMinutes,
            absenceUntil, returnDate: absenceUntil ? nextWorkday(absenceUntil) : null,
            dayStart: day?.start ?? null, dayEnd: day?.end ?? null,
        });
    }
    return rows;
}

export function formatDuration(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Beschriftung über der Abwesenheitsleiste, z. B. „bis Fr, 04.09. · noch 3 Tage · zurück Mo, 07.09." */
export function describeAbsence(row, date) {
    if (!row.absenceUntil)
        return '';
    const back = `zurück ${formatDateShort(row.returnDate)}`;
    if (row.absenceUntil === date)
        return `letzter Tag · ${back}`;
    const remaining = daysBetween(date, row.absenceUntil) + 1;
    return `bis ${formatDateShort(row.absenceUntil)} · noch ${remaining} Tage · ${back}`;
}

export const STATUS_ORDER = {work: 0, pause: 1, done: 2, none: 3, absent: 4, loading: 5};

export function sortRows(rows) {
    return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, 'de'));
}
