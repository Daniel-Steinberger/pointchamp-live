import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PointChampClient, buildRows, sortRows, formatDuration, describeAbsence, addDays, namesForDepartments, tagColor} from './api.js';
import {PointChampWeb, REQUEST_KINDS} from './web.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const BAR_WIDTH = 300;
const BAR_HEIGHT = 14;
const ABSENCE_LOOKAHEAD_DAYS = 60;
const STARTUP_DELAY_SECONDS = 10;   // Schlüsselbund und Netz nach dem Login erst ankommen lassen
const PASSWORD_RETRY_SECONDS = 20;  // erneuter Versuch, wenn der Schlüsselbund noch nicht bereit war
const PASSWORD_RETRY_MAX = 6;
const ROSTER_TTL_SECONDS = 6 * 3600;
const CATEGORY_PARALLEL = 3;             // Detailseiten sind ~2,5 MB, nicht alle auf einmal   // Stammdaten (wer ist in welcher Abteilung) so lange wiederverwenden
const MAX_TARGETED_PEOPLE = 40;         // darüber ist der volle Abruf nicht langsamer als viele Einzelabfragen // Fenster, um anschließende Abwesenheiten zu erkennen
const NAME_WIDTH = 210;
const ICON_WIDTH = 16;
const ROW_SPACING = 12;
const COLORS = {
    work: [0.341, 0.890, 0.537, 1],        // #57e389 Arbeit ohne Kategorie / Office
    home: [0.384, 0.627, 0.918, 1],        // #62a0ea Homeoffice
    travel: [0.863, 0.541, 0.867, 1],      // #dc8add Unterwegs
    pause: [1.0, 0.639, 0.282, 1],         // #ffa348
    doneWork: [1, 1, 1, 0.35],
    donePause: [1, 1, 1, 0.18],
    bg: [1, 1, 1, 0.06],
    hatch: [1, 1, 1, 0.18],
    now: [1, 1, 1, 0.7],
};
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

/** Tagesleiste einer Person (Cairo). */
const Timeline = GObject.registerClass(
class Timeline extends St.DrawingArea {
    _init(row, dayStart, dayEnd, nowHours) {
        super._init({width: BAR_WIDTH, height: BAR_HEIGHT, y_align: Clutter.ActorAlign.CENTER});
        this._row = row;
        this._dayStart = dayStart;
        this._dayEnd = dayEnd;
        this._now = nowHours; // null, wenn nicht heute
        this.connect('repaint', () => this._paint());
    }

    _x(hours) {
        return (hours - this._dayStart) / (this._dayEnd - this._dayStart) * BAR_WIDTH;
    }

    _paint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        roundedRect(cr, 0, 0, w, h, 4);
        cr.clip();
        cr.setSourceRGBA(...COLORS.bg);
        cr.paint();

        const row = this._row;
        if (row.status === 'absent') {
            cr.setSourceRGBA(...COLORS.hatch);
            cr.setLineWidth(3);
            for (let x = -h; x < w + h; x += 7) {
                cr.moveTo(x, h);
                cr.lineTo(x + h, 0);
            }
            cr.stroke();
        }

        const done = row.status === 'done';
        for (const seg of row.segments) {
            const x0 = this._x(seg.start), x1 = this._x(seg.end);
            const width = Math.max(x1 - x0, 2);
            let color = seg.pause ? COLORS.pause : COLORS.work;
            if (!seg.pause && seg.category === 'Homeoffice')
                color = COLORS.home;
            else if (!seg.pause && seg.category === 'Unterwegs')
                color = COLORS.travel;
            if (done) {
                // beendete Tage gedimmt; nur Homeoffice und Unterwegs behalten ihre Farbe,
                // Office und „keine Kategorie" sind auch im laufenden Tag nicht unterscheidbar
                const keepColor = !seg.pause && (seg.category === 'Homeoffice' || seg.category === 'Unterwegs');
                color = seg.pause ? COLORS.donePause : (keepColor ? [color[0], color[1], color[2], 0.45] : COLORS.doneWork);
            }
            if (seg.open) {
                const grad = new Cairo.LinearGradient(x0, 0, x0 + width, 0);
                grad.addColorStopRGBA(0, ...color);
                grad.addColorStopRGBA(0.7, ...color);
                grad.addColorStopRGBA(1, color[0], color[1], color[2], 0);
                cr.setSource(grad);
            } else {
                cr.setSourceRGBA(...color);
            }
            roundedRect(cr, x0, 0, width, h, 3);
            cr.fill();
        }

        if (this._now !== null) {
            const nx = Math.round(this._x(this._now));
            cr.setSourceRGBA(...COLORS.now);
            cr.rectangle(nx - 0.75, 0, 1.5, h);
            cr.fill();
        }
        cr.$dispose();
    }
});

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'PointChamp Live');
        this._ext = extension;
        this._settings = extension.getSettings();
        this._client = null;
        this._cancellable = new Gio.Cancellable();
        this._cache = new Map(); // date → {rows, fetchedAt}
        this._date = GLib.DateTime.new_now_local();
        this._timerId = 0;
        this._lastError = null;

        this._icon = new St.Icon({gicon: this._ext.icon('pc-people'), style_class: 'system-status-icon'});
        // Icon und Punkt in derselben BinLayout-Zelle: der Punkt sitzt oben rechts über dem Icon,
        // ohne eigene Breite zu belegen. Kein negativer Rand: St rechnet Ränder in die bevorzugte
        // Breite ein, ein negativer Wert ließ sie auf 2^32 überlaufen und das ganze Panel wurde
        // per Culling nicht mehr gezeichnet (siehe docs/2026-09-10-panel-unsichtbar.md).
        this._dot = new St.Widget({
            style_class: 'pointchamp-panel-dot', visible: false,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START,
        });
        const box = new St.Widget({style_class: 'pointchamp-panel-box', layout_manager: new Clutter.BinLayout()});
        box.add_child(this._icon);
        box.add_child(this._dot);
        this.add_child(box);

        this._web = null;
        this._webCaps = null;          // {timeTracking, approvals} nach Klassifikation des Kontos
        this._catCache = new Map();    // Segment-ID → Kategorie
        this._catPending = new Set();  // Personen, für die gerade Kategorien geladen werden
        this._uidCache = null;         // {date, map: Name → User-ID}
        this._requests = [];          // offene Anträge (zuletzt abgerufen)
        this._requestsError = null;
        this._seenRequestIds = new Set();
        this._requestsTimerId = 0;
        this._notificationSource = null;

        this.menu.box.add_style_class_name('pointchamp-menu');
        this._buildStaticMenu();

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._refresh(false);
                this._renderRequests();
                if (this._settings.get_boolean('approvals-enabled'))
                    this._refreshRequests();
            }
        });
        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (['server-url', 'username'].includes(key)) {
                this._client = null;
                this._web = null;
                this._webCaps = null;
                this._catCache.clear();
                this._uidCache = null;
            }
            if (key === 'categories-enabled') {
                const cached = this._cache.get(this._dateKey());
                if (cached && !cached.loading)
                    this._enrichCategories(this._dateKey(), cached.tracking).catch(() => {});
                this._render();
                return;
            }
            if (key === 'web-capabilities')
                return;
            if (key.startsWith('known-'))
                return;
            if (key === 'person-tags') {
                this._render();
                return;
            }
            if (key.startsWith('approvals-')) {
                this._startRequestsTimer();
                this._renderRequests();
                return;
            }
            this._cache.clear();
            this._render();
            this._refresh(true);
        });

        this._passwordRetries = 0;
        this._retryId = 0;
        this._render();
        this._startupId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, STARTUP_DELAY_SECONDS, () => {
            this._startupId = 0;
            this._refresh(true);
            return GLib.SOURCE_REMOVE;
        });
        this._startTimer();
        this._startRequestsTimer();
    }

    // ------------------------------------------------------------ Anträge (Web-Oberfläche)
    _startRequestsTimer() {
        if (this._requestsTimerId) {
            GLib.source_remove(this._requestsTimerId);
            this._requestsTimerId = 0;
        }
        if (!this._settings.get_boolean('approvals-enabled')) {
            this._requests = [];
            this._requestsError = null;
            this._updateDot();
            return;
        }
        const interval = this._settings.get_int('approvals-interval');
        this._requestsTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refreshRequests();
            return GLib.SOURCE_CONTINUE;
        });
        // erste Abfrage kurz nach dem Start bzw. Einschalten
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, STARTUP_DELAY_SECONDS + 5, () => {
            this._refreshRequests();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _getWeb() {
        if (this._web)
            return this._web;
        const server = this._settings.get_string('server-url');
        const username = this._settings.get_string('username');
        if (!server || !username)
            throw new Error('Zugangsdaten fehlen.');
        const password = await this._lookupPassword(server, username);
        if (!password)
            throw new Error(`Kein Passwort für ${username} im Schlüsselbund.`);
        this._web = new PointChampWeb(server, username, password);
        return this._web;
    }

    /** Konto klassifizieren (einmal je Web-Sitzung) und Ergebnis für die Einstellungen spiegeln. */
    async _getWebCaps() {
        if (this._webCaps)
            return this._webCaps;
        const web = await this._getWeb();
        this._webCaps = await web.capabilities(this._cancellable);
        const list = Object.entries({'time-tracking': this._webCaps.timeTracking, approvals: this._webCaps.approvals})
            .filter(([, ok]) => ok).map(([k]) => k);
        if (JSON.stringify(list) !== JSON.stringify(this._settings.get_strv('web-capabilities')))
            this._settings.set_strv('web-capabilities', list);
        return this._webCaps;
    }

    /**
     * Zeitkategorien (Homeoffice/Office/Unterwegs) je Segment aus der Admin-Zeiterfassung nachladen.
     * Läuft nur, wenn das Konto die Zeiterfassung sehen darf; sonst bleibt alles wie bisher.
     * Geladen wird nur für Personen mit unbekannten Segment-IDs, im Normalbetrieb also selten.
     */
    async _enrichCategories(date, tracking) {
        if (!this._settings.get_boolean('categories-enabled'))
            return;
        if (!this._settings.get_string('username'))
            return;
        let caps;
        try {
            caps = await this._getWebCaps();
        } catch (e) {
            console.warn(`[pointchamp-live] Konto-Klassifikation: ${e.message}`);
            return;
        }
        if (!caps.timeTracking)
            return;
        const web = await this._getWeb();
        const todo = [];
        for (const p of tracking) {
            const day = Array.isArray(p.days) ? null : p.days?.[date];
            if (!day?.detail)
                continue;
            const segs = Array.isArray(day.detail[0]) ? day.detail.flat() : day.detail;
            const name = p.name.replace(/\s+/g, ' ').trim();
            if (segs.some(sg => !sg.break && !this._catCache.has(sg.id)) && !this._catPending.has(name))
                todo.push(name);
        }
        if (!todo.length)
            return;
        if (!this._uidCache || this._uidCache.date !== date || todo.some(n => !this._uidCache.map.has(n)))
            this._uidCache = {date, map: await web.trackingUserIds(date, this._cancellable)};
        const queue = todo.filter(n => this._uidCache.map.has(n));
        for (const n of queue)
            this._catPending.add(n);
        const worker = async () => {
            while (queue.length) {
                const name = queue.shift();
                try {
                    const cats = await web.segmentCategories(this._uidCache.map.get(name), date, this._cancellable);
                    for (const [id, cat] of cats)
                        this._catCache.set(id, cat);
                    this._scheduleRender();
                } catch (e) {
                    console.warn(`[pointchamp-live] Kategorien für ${name}: ${e.message}`);
                } finally {
                    this._catPending.delete(name);
                }
            }
        };
        await Promise.all(Array.from({length: CATEGORY_PARALLEL}, worker));
    }

    async _refreshRequests() {
        if (!this._settings.get_boolean('approvals-enabled') || this._requestsLoading)
            return;
        this._requestsLoading = true;
        try {
            const web = await this._getWeb();
            const caps = await this._getWebCaps();
            if (!caps.approvals) {
                this._requestsError = 'Konto ohne Berechtigung für Anträge';
                this._requests = [];
                return;
            }
            const {requests, errors} = await web.allOpenRequests(this._cancellable);
            if (this._cancellable.is_cancelled())
                return;
            this._requestsError = errors.length ? errors.join(' · ') : null;
            const fresh = requests.filter(r => !this._seenRequestIds.has(`${r.kind}:${r.id}`));
            this._requests = requests;
            for (const r of requests)
                this._seenRequestIds.add(`${r.kind}:${r.id}`);
            if (fresh.length && this._settings.get_boolean('approvals-notify'))
                this._notifyRequests(fresh);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            this._requestsError = e.message ?? String(e);
            console.warn(`[pointchamp-live] Anträge: ${this._requestsError}`);
        } finally {
            this._requestsLoading = false;
        }
        this._updateDot();
        this._renderRequests();
    }

    _updateDot() {
        this._dot.visible = this._requests.length > 0;
    }

    _notifyRequests(fresh) {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({title: 'PointChamp Live', iconName: 'system-users-symbolic'});
            this._notificationSource.connect('destroy', () => (this._notificationSource = null));
            Main.messageTray.add(this._notificationSource);
        }
        const title = fresh.length === 1 ? 'Neuer Antrag zur Überprüfung' : `${fresh.length} neue Anträge zur Überprüfung`;
        const body = fresh.slice(0, 4).map(r => `${r.name}: ${r.type} ${r.from}${r.to && r.to !== r.from ? ` – ${r.to}` : ''}`).join('\n');
        const notification = new MessageTray.Notification({source: this._notificationSource, title, body});
        notification.connect('activated', () => this.menu.open());
        this._notificationSource.addNotification(notification);
    }

    _renderRequests() {
        this._requestsSection.removeAll();
        if (!this._settings.get_boolean('approvals-enabled'))
            return;
        const heading = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const label = this._requestsError && !this._requests.length
            ? `Anträge: ${this._requestsError}`
            : `Anträge zur Überprüfung · ${this._requests.length}`;
        heading.add_child(new St.Label({text: label, style_class: 'pointchamp-heading', x_expand: true}));
        this._requestsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._requestsSection.addMenuItem(heading);
        for (const req of this._requests)
            this._requestsSection.addMenuItem(this._makeRequestRow(req));
    }

    _makeRequestRow(req) {
        const item = new PopupMenu.PopupBaseMenuItem({style_class: 'pointchamp-request-row', can_focus: false, activate: false});
        item.add_child(new St.Icon({gicon: this._ext.icon(req.kind === 'holiday' ? 'pc-case' : 'pc-out'), style_class: 'pointchamp-status-icon', y_align: Clutter.ActorAlign.CENTER}));
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        text.add_child(new St.Label({text: req.name, style_class: 'pointchamp-request-text'}));
        const range = req.to && req.to !== req.from ? `${req.from} – ${req.to}` : req.from;
        const time = req.time ? `, ${req.time}` : '';
        const days = req.days ? ` · ${req.days} ${req.days === '1' ? 'Tag' : 'Tage'}` : '';
        text.add_child(new St.Label({text: `${req.type} · ${range}${time}${days}${req.department ? ` · ${req.department}` : ''}`, style_class: 'pointchamp-request-sub'}));
        item.add_child(text);
        item.add_child(this._actionButton('Genehmigen', 'accept', req));
        item.add_child(this._actionButton('Ablehnen', 'decline', req));
        return item;
    }

    /** Knopf mit zweistufiger Bestätigung: erster Klick fragt „Wirklich?", zweiter Klick führt aus. */
    _actionButton(label, action, req) {
        const btn = new St.Button({label, style_class: `pointchamp-request-button ${action}`, can_focus: true, y_align: Clutter.ActorAlign.CENTER});
        let armed = 0;
        btn.connect('clicked', () => {
            if (!armed) {
                btn.label = 'Wirklich?';
                btn.add_style_class_name('confirm');
                armed = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                    armed = 0;
                    btn.label = label;
                    btn.remove_style_class_name('confirm');
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            GLib.source_remove(armed);
            armed = 0;
            btn.label = '…';
            btn.reactive = false;
            this._performRequestAction(action, req).catch(e => {
                console.warn(`[pointchamp-live] ${action} fehlgeschlagen: ${e.message}`);
                btn.label = 'Fehler';
                btn.reactive = true;
            });
        });
        btn.connect('destroy', () => {
            if (armed)
                GLib.source_remove(armed);
        });
        return btn;
    }

    async _performRequestAction(action, req) {
        const web = await this._getWeb();
        const left = await web[action](req.kind, [req.id], this._cancellable);
        if (left.length)
            throw new Error(`PointChamp meldet den Antrag weiterhin als offen`);
        this._requests = this._requests.filter(r => !(r.kind === req.kind && r.id === req.id));
        this._updateDot();
        this._renderRequests();
        // Abwesenheiten neu laden, damit ein genehmigter Urlaub in der Tagesleiste erscheint
        this._cache.clear();
        this._refresh(true);
        this._refreshRequests();
    }

    // ------------------------------------------------------------ Menü-Gerüst
    _buildStaticMenu() {
        const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        header.add_style_class_name('pointchamp-header');
        this._prevBtn = this._navButton('pc-back', () => this._shiftDate(-1));
        this._title = new St.Label({style_class: 'pointchamp-header-title', y_align: Clutter.ActorAlign.CENTER});
        this._titleBtn = new St.Button({child: this._title, can_focus: true});
        this._titleBtn.connect('clicked', () => this._setDate(GLib.DateTime.new_now_local()));
        this._nextBtn = this._navButton('pc-next', () => this._shiftDate(1));
        this._deptPill = new St.Label({style_class: 'pointchamp-dept-pill', y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._prevBtn);
        header.add_child(this._titleBtn);
        header.add_child(this._nextBtn);
        header.add_child(new St.Widget({x_expand: true}));
        header.add_child(this._deptPill);
        this.menu.addMenuItem(header);

        this._axis = new St.BoxLayout({style_class: 'pointchamp-axis'});
        const axisItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'pointchamp-axis-item'});
        axisItem.add_child(this._axis);
        this.menu.addMenuItem(axisItem);

        this._rowsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._rowsSection);

        this._requestsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._requestsSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const legendItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const legend = new St.BoxLayout({style_class: 'pointchamp-legend', x_expand: true});
        legend.add_child(this._legendEntry('Arbeit', 'pointchamp-dot-work'));
        this._legendHome = this._legendEntry('Homeoffice', 'pointchamp-dot-home');
        this._legendTravel = this._legendEntry('Unterwegs', 'pointchamp-dot-travel');
        legend.add_child(this._legendHome);
        legend.add_child(this._legendTravel);
        legend.add_child(this._legendEntry('Pause', 'pointchamp-dot-pause'));
        legend.add_child(this._legendEntry('beendet', 'pointchamp-dot-done'));
        this._nowLabel = new St.Label({text: 'jetzt', y_align: Clutter.ActorAlign.CENTER});
        const nowBox = new St.BoxLayout({style_class: 'pointchamp-legend-item'});
        nowBox.add_child(new St.Widget({style_class: 'pointchamp-now-swatch', y_align: Clutter.ActorAlign.CENTER}));
        nowBox.add_child(this._nowLabel);
        legend.add_child(nowBox);
        legend.add_child(new St.Widget({x_expand: true}));
        this._statusLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        legend.add_child(this._statusLabel);
        legend.add_child(this._iconButton('pc-refresh', 'Aktualisieren', () => this._refresh(true)));
        legend.add_child(this._iconButton('pc-ext', 'In PointChamp öffnen', () => this._openWeb()));
        legend.add_child(this._iconButton('pc-gear', 'Einstellungen', () => this._ext.openPreferences()));
        legendItem.add_child(legend);
        this.menu.addMenuItem(legendItem);
    }

    _navButton(icon, cb) {
        const btn = new St.Button({
            style_class: 'pointchamp-nav-button', can_focus: true,
            child: new St.Icon({gicon: this._ext.icon(icon), icon_size: 12}),
        });
        btn.connect('clicked', cb);
        return btn;
    }

    _iconButton(icon, tooltip, cb) {
        const btn = new St.Button({
            style_class: 'pointchamp-nav-button', can_focus: true, accessible_name: tooltip,
            child: new St.Icon({gicon: this._ext.icon(icon), icon_size: 14}),
        });
        btn.connect('clicked', cb);
        return btn;
    }

    _legendEntry(text, dotClass) {
        const box = new St.BoxLayout({style_class: 'pointchamp-legend-item'});
        box.add_child(new St.Widget({style_class: `pointchamp-legend-dot ${dotClass}`, y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        return box;
    }

    // ------------------------------------------------------------ Datum
    _dateKey(dt = this._date) {
        return dt.format('%Y-%m-%d');
    }

    _isToday() {
        return this._dateKey() === this._dateKey(GLib.DateTime.new_now_local());
    }

    _shiftDate(days) {
        this._setDate(this._date.add_days(days));
    }

    _setDate(dt) {
        this._date = dt;
        this._render();
        this._refresh(false);
    }

    _titleText() {
        const key = this._dateKey();
        const today = GLib.DateTime.new_now_local();
        const label = `${WEEKDAYS[this._date.get_day_of_week() % 7]}, ${this._date.format('%d.%m.')}`;
        if (key === this._dateKey(today))
            return `Heute · ${label}`;
        if (key === this._dateKey(today.add_days(-1)))
            return `Gestern · ${label}`;
        return label;
    }

    // ------------------------------------------------------------ Daten
    /** Passwort über den Helfer-Prozess holen (libsecret läuft dort, nicht in der Shell). */
    async _lookupPassword(server, username) {
        const helper = GLib.build_filenamev([this._ext.path, 'secret-helper.js']);
        const proc = Gio.Subprocess.new(
            ['gjs', '-m', helper, 'lookup', server, username],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const [stdout, stderr] = await proc.communicate_utf8_async(null, this._cancellable);
        const status = proc.get_exit_status();
        if (status === 0)
            return stdout.replace(/\n$/, '');
        if (status === 2)
            return null;
        // Auch Helfer-Fehler (z. B. Schlüsselbund noch nicht gestartet) werden nach dem Login erneut versucht
        const e = new Error(`Schlüsselbund-Helfer: ${stderr.trim() || `Exit ${status}`}`);
        e.passwordMissing = true;
        throw e;
    }

    async _getClient() {
        if (this._client)
            return this._client;
        const server = this._settings.get_string('server-url');
        const username = this._settings.get_string('username');
        if (!server || !username)
            throw new Error('Zugangsdaten fehlen. Bitte in den Einstellungen eintragen.');
        const password = await this._lookupPassword(server, username);
        if (!password) {
            const e = new Error(`Kein Passwort für ${username} im Schlüsselbund.`);
            e.passwordMissing = true;
            throw e;
        }
        this._client = new PointChampClient(server, username, password);
        return this._client;
    }

    /** Stammdaten: welche Person gehört zu welcher Abteilung. Wird selten neu geladen. */
    async _getRoster(client) {
        const nowSec = GLib.get_monotonic_time() / 1e6;
        if (this._roster && nowSec - this._rosterTime < ROSTER_TTL_SECONDS)
            return this._roster;
        this._roster = await client.mastaData(this._cancellable);
        this._rosterTime = nowSec;
        return this._roster;
    }

    async _refresh(force) {
        const key = this._dateKey();
        const cached = this._cache.get(key);
        const nowSec = GLib.get_monotonic_time() / 1e6;
        if (!force && cached && (!this._isToday() || nowSec - cached.fetchedAt < 30))
            return;
        if (this._loading)
            return;
        this._loading = true;
        this._statusLabel.text = 'Lade …';
        try {
            const client = await this._getClient();
            const roster = await this._getRoster(client);
            const selected = this._settings.get_strv('departments');
            const names = selected.length ? namesForDepartments(roster, selected, key) : [];
            const targeted = selected.length > 0 && names.length > 0 && names.length <= MAX_TARGETED_PEOPLE;
            // Fortlaufende Anzeige: Gibt es für den Tag noch keine vollständigen Daten, wird jede
            // eintreffende Antwort sofort gezeigt. Bei einer Hintergrund-Aktualisierung mit vorhandenen
            // Daten wird dagegen erst am Ende umgeschaltet, damit nichts flackert.
            const progressive = !cached;
            const partial = {tracking: [], absences: [], fetchedAt: 0, wallClock: GLib.DateTime.new_now_local(), loading: true, done: 0, total: targeted ? names.length : 1, names};
            if (progressive) {
                this._cache.set(key, partial);
                this._render();
            }
            const showPartial = () => {
                if (progressive && this._cache.get(key) === partial && key === this._dateKey())
                    this._scheduleRender();
            };
            const trackingPromise = targeted
                ? client.trackingDaysFor(key, names, this._cancellable, (list, done, total) => {
                    partial.tracking = list;
                    partial.done = done;
                    partial.total = total;
                    showPartial();
                })
                : client.trackingDays(key, this._cancellable);
            const absencePromise = client.absences(key, addDays(key, ABSENCE_LOOKAHEAD_DAYS), this._cancellable)
                .then(list => {
                    partial.absences = list;
                    showPartial();
                    return list;
                });
            const [tracking, absences] = await Promise.all([trackingPromise, absencePromise]);
            if (this._cancellable.is_cancelled())
                return;
            const depts = [...new Set(roster.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
            if (JSON.stringify(depts) !== JSON.stringify(this._settings.get_strv('known-departments')))
                this._settings.set_strv('known-departments', depts);
            const persons = roster
                .filter(p => !p.leavingDate || p.leavingDate >= key)
                .map(p => `${p.firstname} ${p.lastname}`.replace(/\s+/g, ' ').trim() + '\t' + (p.department ?? ''))
                .sort((a, b) => a.localeCompare(b, 'de'));
            if (JSON.stringify(persons) !== JSON.stringify(this._settings.get_strv('known-persons')))
                this._settings.set_strv('known-persons', persons);
            this._cache.set(key, {tracking, absences, fetchedAt: nowSec, wallClock: GLib.DateTime.new_now_local()});
            this._lastError = null;
            this._enrichCategories(key, tracking).catch(e => console.warn(`[pointchamp-live] Kategorien: ${e.message}`));
            this._icon.remove_style_class_name('pointchamp-indicator-error');
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            if (this._cache.get(key)?.loading)
                this._cache.delete(key);
            this._lastError = e.message ?? String(e);
            this._icon.add_style_class_name('pointchamp-indicator-error');
            console.warn(`[pointchamp-live] ${this._lastError}`);
            if (e.passwordMissing && this._passwordRetries < PASSWORD_RETRY_MAX && !this._retryId) {
                // Direkt nach dem Login ist der Schlüsselbund oft noch nicht entsperrt
                this._passwordRetries++;
                this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PASSWORD_RETRY_SECONDS, () => {
                    this._retryId = 0;
                    this._refresh(true);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } finally {
            this._loading = false;
        }
        this._render();
    }

    _startTimer() {
        this._stopTimer();
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            if (this._isToday())
                this._refresh(true);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    // ------------------------------------------------------------ Darstellung
    /** Rendern bündeln, wenn viele Antworten kurz hintereinander eintreffen. */
    _scheduleRender() {
        if (this._renderId)
            return;
        this._renderId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._renderId = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        this._title.text = this._titleText();
        const depts = this._settings.get_strv('departments');
        this._deptPill.text = depts.length ? depts.join(' + ') : 'Alle Abteilungen';
        this._nextBtn.reactive = !this._isToday();
        this._nextBtn.opacity = this._isToday() ? 80 : 255;

        const dayStart = this._settings.get_int('day-start');
        const dayEnd = Math.max(this._settings.get_int('day-end'), dayStart + 1);
        const now = GLib.DateTime.new_now_local();
        const nowHours = now.get_hour() + now.get_minute() / 60;
        this._nowLabel.text = `jetzt ${now.format('%H:%M')}`;
        this._nowLabel.get_parent().visible = this._isToday();

        const catsAvailable = this._catCache.size > 0;
        this._legendHome.visible = catsAvailable;
        this._legendTravel.visible = catsAvailable;
        this._renderAxis(dayStart, dayEnd);
        this._rowsSection.removeAll();

        const cached = this._cache.get(this._dateKey());
        if (!cached) {
            this._addMessage(this._lastError ?? 'Lade …', !!this._lastError);
            this._statusLabel.text = '';
            return;
        }

        const hidden = new Set(this._settings.get_strv('hidden-names'));
        let rows = buildRows(cached.tracking, cached.absences, this._dateKey(), this._isToday() ? nowHours : dayEnd);
        for (const r of rows) {
            for (const sg of r.segments)
                sg.category = this._catCache.get(sg.id) ?? null;
            const open = r.segments.find(sg => sg.open);
            r.currentCategory = open && !open.pause ? open.category : null;
        }
        if (cached.loading && cached.names?.length) {
            // Noch nicht geladene Personen der gewählten Abteilungen als Platzhalter zeigen
            const have = new Set(rows.map(r => r.name));
            for (const name of cached.names) {
                if (!have.has(name))
                    rows.push({name, department: depts[0] ?? '', status: 'loading', segments: [], absence: null, plannedHome: false, workedMinutes: 0});
            }
        }
        rows = rows.filter(r => !hidden.has(r.name) && (!depts.length || r.status === 'loading' || depts.includes(r.department)));
        if (!this._settings.get_boolean('show-finished'))
            rows = rows.filter(r => r.status !== 'done');
        if (!this._settings.get_boolean('show-absent'))
            rows = rows.filter(r => r.status !== 'absent');
        if (!this._settings.get_boolean('show-not-stamped'))
            rows = rows.filter(r => r.status !== 'none');
        sortRows(rows);

        if (!rows.length)
            this._addMessage('Keine Personen für diesen Filter.', false);
        for (const row of rows)
            this._rowsSection.addMenuItem(this._makeRow(row, dayStart, dayEnd, this._isToday() ? nowHours : null));

        const present = rows.filter(r => r.status === 'work').length;
        const pause = rows.filter(r => r.status === 'pause').length;
        if (cached.loading)
            this._statusLabel.text = cached.total > 1 ? `Lade … ${cached.done}/${cached.total}` : 'Lade …';
        else if (this._lastError)
            this._statusLabel.text = `Fehler · Stand ${cached.wallClock.format('%H:%M')}`;
        else
            this._statusLabel.text = `${present} da · ${pause} Pause · ${cached.wallClock.format('%H:%M')}`;
    }

    _renderAxis(dayStart, dayEnd) {
        this._axis.destroy_all_children();
        // Platzhalter in Breite von Icon + Name, dann die Achse mit fixen Positionen
        this._axis.add_child(new St.Widget({width: ICON_WIDTH + ROW_SPACING + NAME_WIDTH}));
        const axis = new St.Widget({width: BAR_WIDTH, height: 14});
        for (let h = dayStart; h <= dayEnd; h += 2) {
            const label = new St.Label({text: String(h), style_class: 'pointchamp-axis-label'});
            axis.add_child(label);
            const x = (h - dayStart) / (dayEnd - dayStart) * BAR_WIDTH;
            label.set_position(Math.round(x - 4), 0);
        }
        this._axis.add_child(axis);
    }

    _addMessage(text, isError) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: isError});
        item.label.add_style_class_name('pointchamp-message');
        if (isError)
            item.connect('activate', () => this._ext.openPreferences());
        this._rowsSection.addMenuItem(item);
    }

    _makeRow(row, dayStart, dayEnd, nowHours) {
        const item = new PopupMenu.PopupBaseMenuItem({style_class: 'pointchamp-row', can_focus: true});
        item.add_child(this._statusMarker(row));
        item.add_child(this._nameColumn(row));
        const timeline = new Timeline(row, dayStart, dayEnd, nowHours);
        if (row.status === 'absent') {
            // Beschriftung über der schraffierten Leiste
            const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), width: BAR_WIDTH, height: BAR_HEIGHT, y_align: Clutter.ActorAlign.CENTER});
            stack.add_child(timeline);
            stack.add_child(new St.Label({
                text: describeAbsence(row, this._dateKey()), style_class: 'pointchamp-bar-text',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            }));
            item.add_child(stack);
        } else {
            item.add_child(timeline);
        }
        item.add_child(new St.Label({text: this._rightText(row), style_class: 'pointchamp-row-right', y_align: Clutter.ActorAlign.CENTER}));
        item.connect('activate', () => this._openWeb());
        return item;
    }

    /** Name plus Tag-Badges aus den Einstellungen. */
    _nameColumn(row) {
        const box = new St.BoxLayout({style_class: 'pointchamp-row-name', y_align: Clutter.ActorAlign.CENTER});
        const name = new St.Label({text: row.name, y_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        box.add_child(name);
        const tags = this._personTags()[row.name] ?? [];
        for (const tag of tags) {
            box.add_child(new St.Label({
                text: tag, style_class: 'pointchamp-tag', y_align: Clutter.ActorAlign.CENTER,
                style: `background-color: ${tagColor(tag)};`,
            }));
        }
        return box;
    }

    _personTags() {
        if (!this._tagsCache) {
            this._tagsCache = this._settings.get_value('person-tags').deepUnpack();
            this._tagsCacheId = this._settings.connect('changed::person-tags', () => (this._tagsCache = null));
        }
        return this._tagsCache;
    }

    _statusMarker(row) {
        let iconName = null;
        let extraClass = null;
        if (row.status === 'pause')
            iconName = 'pc-coffee';
        else if (row.status === 'work' && row.currentCategory === 'Homeoffice') {
            iconName = 'pc-house';
            extraClass = 'home';
        } else if (row.status === 'work' && row.currentCategory === 'Unterwegs') {
            iconName = 'pc-out';
            extraClass = 'travel';
        } else if (row.plannedHome)
            iconName = 'pc-house';
        else if (row.status === 'absent')
            iconName = /krank/i.test(row.absence ?? '') ? 'pc-plus' : 'pc-case';
        if (iconName) {
            const icon = new St.Icon({gicon: this._ext.icon(iconName), style_class: 'pointchamp-status-icon', y_align: Clutter.ActorAlign.CENTER});
            icon.add_style_class_name(extraClass ?? row.status);
            return icon;
        }
        const dotClass = {work: 'pointchamp-dot-work', done: 'pointchamp-dot-done'}[row.status] ?? 'pointchamp-dot-done';
        return new St.Widget({style_class: `pointchamp-dot ${dotClass}`, y_align: Clutter.ActorAlign.CENTER, opacity: row.status === 'none' ? 60 : 255});
    }

    _rightText(row) {
        switch (row.status) {
        case 'work': case 'done': return formatDuration(row.workedMinutes);
        case 'pause': return 'Pause';
        case 'absent': return row.absence.replace('Freizeitausgleich', 'FZA').replace('Krankheit', 'Krank');
        case 'loading': return '…';
        default: return row.plannedHome ? 'HO geplant' : '–';
        }
    }

    _openWeb() {
        const server = this._settings.get_string('server-url');
        Gio.AppInfo.launch_default_for_uri_async(`${server}/de/time/tracking/`, null, null, null);
        this.menu.close();
    }

    destroy() {
        this._stopTimer();
        for (const key of ['_startupId', '_retryId', '_renderId', '_requestsTimerId']) {
            if (this[key]) {
                GLib.source_remove(this[key]);
                this[key] = 0;
            }
        }
        this._cancellable.cancel();
        if (this._settingsChangedId)
            this._settings.disconnect(this._settingsChangedId);
        this._notificationSource?.destroy();
        if (this._tagsCacheId)
            this._settings.disconnect(this._tagsCacheId);
        super.destroy();
    }
});

export default class PointChampLiveExtension extends Extension {
    icon(name) {
        return Gio.icon_new_for_string(`${this.path}/icons/${name}-symbolic.svg`);
    }

    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
