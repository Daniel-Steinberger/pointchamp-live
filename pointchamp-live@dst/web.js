// Web-Sitzung mit der PointChamp-Oberfläche (Session-Cookie). Nötig für Anträge zur Überprüfung:
// die externe API kennt dafür keine Endpunkte. Kein Shell-Import, kein libsecret.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

export class WebError extends Error {}

/** Antragsarten: Urlaubsanträge und sonstige Ab-/Anwesenheiten (z. B. Freizeitausgleich). */
export const REQUEST_KINDS = {
    holiday: {
        page: '/de/administration/holiday/?linesPerPageOpen=100',
        accept: '/de/administration/holiday/batch/acceppt', // Tippfehler ist Teil der PointChamp-URL
        decline: '/de/administration/holiday/batch/decline',
        idsField: 'holidaysIDS[]',
        leftField: 'holidaysLeft',
        checkboxClass: 'holidayCheckbox',
        label: 'Urlaub',
    },
    absence: {
        page: '/de/administration/illness/open?linesPerPageOpen=100',
        accept: '/de/administration/absence/batch/acceppt',
        decline: '/de/administration/absence/batch/decline',
        idsField: 'absenceIDS[]',
        leftField: 'absenceLeft',
        checkboxClass: 'absenceCheckbox',
        label: 'Ab-/Anwesenheit',
    },
};

function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
    return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Liest aus dem „Open"-Bereich einer Antragsseite die Tabelle: Zähler, Spaltenköpfe und Zeilen.
 * Struktur (aus der Seite abgeleitet): <tr class="kt-datatable__row" id="id-N"> mit
 * <input class="holidayCheckbox|absenceCheckbox" value="N"> und Zellen Name (kt-user-card-v2__name),
 * PN, Abteilung, Von, Bis, Tage, Art. Zeilen ohne Checkbox werden ignoriert.
 */
export function parseOpenRequests(html, kind) {
    const spec = REQUEST_KINDS[kind];
    const start = html.indexOf('id="Open"');
    const section = start >= 0 ? html.slice(start, html.indexOf('id="Closed"', start) > 0 ? html.indexOf('id="Closed"', start) : undefined) : html;
    const badge = /kt-badge--danger[^>]*>\s*(\d+)\s*<\/span>\s*Anträge zur Überprüfung/.exec(section) ?? /kt-badge--danger[^>]*>\s*(\d+)\s*<\/span>/.exec(section);
    const count = badge ? Number(badge[1]) : 0;

    const headers = [...section.matchAll(/<th[^>]*>(.*?)<\/th>/gs)].map(m => stripTags(m[1]));
    const requests = [];
    for (const rowMatch of section.matchAll(/<tr[^>]*class="[^"]*kt-datatable__row[^"]*"[^>]*>(.*?)<\/tr>/gs)) {
        const row = rowMatch[0];
        const cb = new RegExp(`<input[^>]*class="[^"]*${spec.checkboxClass}[^"]*"[^>]*value="(\\d+)"`, 's').exec(row)
            ?? new RegExp(`<input[^>]*value="(\\d+)"[^>]*class="[^"]*${spec.checkboxClass}[^"]*"`, 's').exec(row);
        if (!cb)
            continue;
        const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m => m[1]);
        const nameMatch = /kt-user-card-v2__name[^>]*>(.*?)<\/span>/s.exec(row);
        const deptMatch = /kt-user-card-v2__desc[^>]*>(.*?)<\/span>/s.exec(row);
        const texts = cells.map(stripTags);
        const dates = texts.filter(t => /^\d{2}\.\d{2}\.\d{4}$/.test(t));
        const days = texts.find((t, i) => /^\d+(,\d+)?$/.test(t) && i > 0 && dates.length && texts.indexOf(dates[dates.length - 1]) < i);
        requests.push({
            id: cb[1],
            kind,
            name: nameMatch ? stripTags(nameMatch[1]) : texts[0] ?? '',
            department: deptMatch ? stripTags(deptMatch[1]) : '',
            from: dates[0] ?? '',
            to: dates[1] ?? dates[0] ?? '',
            days: days ?? '',
            type: texts.length ? texts[texts.length - 1] : spec.label,
            cells: texts,
            headers,
        });
    }
    return {count: Math.max(count, requests.length), requests};
}

export class PointChampWeb {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.username = username;
        this.password = password;
        this._session = new Soup.Session({timeout: 30, user_agent: 'pointchamp-live-gnome/1'});
        this._jar = new Soup.CookieJar();
        this._session.add_feature(this._jar);
        this._loggedIn = false;
    }

    async _send(method, path, {form = null, ajax = false, cancellable = null} = {}) {
        const msg = Soup.Message.new(method, `${this.baseUrl}${path}`);
        if (ajax)
            msg.request_headers.append('X-Requested-With', 'XMLHttpRequest');
        if (form) {
            const body = Object.entries(form).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');
            msg.set_request_body_from_bytes('application/x-www-form-urlencoded', new GLib.Bytes(new TextEncoder().encode(body)));
        }
        const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
        const text = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
        return {status: msg.get_status(), text, uri: msg.get_uri().to_string()};
    }

    /** Login; parallele Aufrufer teilen sich einen laufenden Login, sonst kollidieren CSRF-Token und Sitzung. */
    login(cancellable = null) {
        if (!this._loginPromise) {
            this._loginPromise = this._doLogin(cancellable).finally(() => {
                this._loginPromise = null;
            });
        }
        return this._loginPromise;
    }

    async _doLogin(cancellable) {
        const page = await this._send('GET', '/login', {cancellable});
        const csrf = /name="_csrf_token" value="([^"]*)"/.exec(page.text);
        if (!csrf)
            throw new WebError('Login-Seite ohne CSRF-Token');
        const res = await this._send('POST', '/login_check', {
            form: {_csrf_token: csrf[1], _username: this.username, _password: this.password}, cancellable,
        });
        if (res.uri.includes('/login') || /name="_username"/.test(res.text))
            throw new WebError('Web-Login fehlgeschlagen (Zugangsdaten?)');
        this._loggedIn = true;
    }

    /** GET mit automatischem (Re-)Login; die Web-Sitzung läuft nach 15 min Inaktivität ab. */
    async get(path, cancellable = null) {
        if (!this._loggedIn)
            await this.login(cancellable);
        let res = await this._send('GET', path, {cancellable});
        if (res.uri.includes('/login') || /name="_username"[^>]*class="form-control"/.test(res.text)) {
            this._loggedIn = false;
            await this.login(cancellable);
            res = await this._send('GET', path, {cancellable});
        }
        if (res.status === 403)
            throw new WebError(`Keine Berechtigung für ${path}`);
        if (res.status !== 200)
            throw new WebError(`GET ${path} → HTTP ${res.status}`);
        return res.text;
    }

    /**
     * Klassifiziert das Konto: welche Admin-Bereiche darf es sehen? 403 = keine Berechtigung.
     * Ergebnis wird je Web-Instanz gecacht.
     */
    async capabilities(cancellable = null) {
        if (this._caps)
            return this._caps;
        if (!this._loggedIn)
            await this.login(cancellable);
        const probe = async path => {
            const res = await this._send('GET', path, {cancellable});
            return res.status === 200 && !res.uri.includes('/login');
        };
        const [timeTracking, approvals] = await Promise.all([
            probe('/de/administration/time/tracking/?linesPerPage=4'),
            probe('/de/administration/holiday/?linesPerPageOpen=4'),
        ]);
        this._caps = {timeTracking, approvals};
        return this._caps;
    }

    /** Übersichtsseite der Admin-Zeiterfassung: Name → PointChamp-User-ID (nur Personen mit Buchung am Tag). */
    async trackingUserIds(date, cancellable = null) {
        const html = await this.get(`/de/administration/time/tracking/?date=${date}&type=1&department=0&linesPerPage=1000`, cancellable);
        const map = new Map();
        for (const row of html.matchAll(/<tr[^>]*class="[^"]*kt-datatable__row[^"]*"[^>]*>(.*?)<\/tr>/gs)) {
            const uid = /\/de\/administration\/time\/tracking\/detail\/(\d+)\//.exec(row[1]);
            const name = /kt-user-card-v2__name[^>]*>(.*?)<\/span>/s.exec(row[1]);
            if (uid && name)
                map.set(stripTags(name[1]).replace(/\s+/g, ' '), uid[1]);
        }
        return map;
    }

    /**
     * Zeitkategorie je Segment aus der Tages-Detailansicht. Die Zeilen-IDs (`id-138200`) sind die
     * Segment-IDs der externen API. Rückgabe: Map(segmentId → 'Homeoffice' | 'Office' | 'Unterwegs' | null).
     */
    async segmentCategories(uid, date, cancellable = null) {
        const html = await this.get(`/de/administration/time/tracking/detail/${uid}/${date}?timeType=Zeiterfassung&typeID=0`, cancellable);
        const start = html.indexOf('Zeitkategorie');
        const map = new Map();
        for (const row of html.slice(start).matchAll(/<tr[^>]*id="id-(\d+)"[^>]*>(.*?)<\/tr>/gs)) {
            const cells = [...row[2].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m => stripTags(m[1]));
            const cat = cells[1] ?? '';
            if (cat === 'Pause')
                continue;
            map.set(Number(row[1]), cat && cat !== '-' ? cat : null);
        }
        return map;
    }

    async openRequests(kind, cancellable = null) {
        const html = await this.get(REQUEST_KINDS[kind].page, cancellable);
        return parseOpenRequests(html, kind);
    }

    /** Alle Antragsarten abrufen; Fehler einer Art blockieren die andere nicht. */
    async allOpenRequests(cancellable = null) {
        const results = await Promise.allSettled(Object.keys(REQUEST_KINDS).map(k => this.openRequests(k, cancellable)));
        const requests = [];
        const errors = [];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled')
                requests.push(...r.value.requests);
            else
                errors.push(`${Object.keys(REQUEST_KINDS)[i]}: ${r.reason.message}`);
        });
        return {requests, errors};
    }

    async _batch(kind, action, ids, cancellable) {
        const spec = REQUEST_KINDS[kind];
        if (!this._loggedIn)
            await this.login(cancellable);
        const res = await this._send('POST', spec[action], {form: {[spec.idsField]: ids}, ajax: true, cancellable});
        if (res.status !== 200)
            throw new WebError(`${action} ${kind} → HTTP ${res.status}`);
        try {
            return JSON.parse(res.text)[spec.leftField] ?? [];
        } catch {
            throw new WebError(`Unerwartete Antwort auf ${action}: ${res.text.slice(0, 120)}`);
        }
    }

    /** Genehmigen. PointChamp arbeitet die IDs stückweise ab und liefert die noch offenen zurück. */
    async accept(kind, ids, cancellable = null) {
        let left = ids;
        for (let i = 0; i < 10 && left.length; i++)
            left = await this._batch(kind, 'accept', left, cancellable);
        return left;
    }

    async decline(kind, ids, cancellable = null) {
        let left = ids;
        for (let i = 0; i < 10 && left.length; i++)
            left = await this._batch(kind, 'decline', left, cancellable);
        return left;
    }
}
