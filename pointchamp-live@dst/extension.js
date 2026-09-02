import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PointChampClient, buildRows, sortRows, formatDuration, describeAbsence, addDays} from './api.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const BAR_WIDTH = 300;
const BAR_HEIGHT = 14;
const ABSENCE_LOOKAHEAD_DAYS = 60;
const STARTUP_DELAY_SECONDS = 10;   // Schlüsselbund und Netz nach dem Login erst ankommen lassen
const PASSWORD_RETRY_SECONDS = 20;  // erneuter Versuch, wenn der Schlüsselbund noch nicht bereit war
const PASSWORD_RETRY_MAX = 6; // Fenster, um anschließende Abwesenheiten zu erkennen
const NAME_WIDTH = 150;
const ICON_WIDTH = 16;
const ROW_SPACING = 12;
const COLORS = {
    work: [0.341, 0.890, 0.537, 1],        // #57e389
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
            if (done)
                color = seg.pause ? COLORS.donePause : COLORS.doneWork;
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
        this.add_child(this._icon);

        this.menu.box.add_style_class_name('pointchamp-menu');
        this._buildStaticMenu();

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._refresh(false);
        });
        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (['server-url', 'username'].includes(key))
                this._client = null;
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

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const legendItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const legend = new St.BoxLayout({style_class: 'pointchamp-legend', x_expand: true});
        legend.add_child(this._legendEntry('Arbeit', 'pointchamp-dot-work'));
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
            const [tracking, absences] = await Promise.all([
                client.trackingDays(key, this._cancellable),
                client.absences(key, addDays(key, ABSENCE_LOOKAHEAD_DAYS), this._cancellable),
            ]);
            if (this._cancellable.is_cancelled())
                return;
            const depts = [...new Set(tracking.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
            if (JSON.stringify(depts) !== JSON.stringify(this._settings.get_strv('known-departments')))
                this._settings.set_strv('known-departments', depts);
            this._cache.set(key, {tracking, absences, fetchedAt: nowSec, wallClock: GLib.DateTime.new_now_local()});
            this._lastError = null;
            this._icon.remove_style_class_name('pointchamp-indicator-error');
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
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
        rows = rows.filter(r => !hidden.has(r.name) && (!depts.length || depts.includes(r.department)));
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
        this._statusLabel.text = this._lastError
            ? `Fehler · Stand ${cached.wallClock.format('%H:%M')}`
            : `${present} da · ${pause} Pause · ${cached.wallClock.format('%H:%M')}`;
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
        item.add_child(new St.Label({text: row.name, style_class: 'pointchamp-row-name', y_align: Clutter.ActorAlign.CENTER}));
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

    _statusMarker(row) {
        let iconName = null;
        if (row.status === 'pause')
            iconName = 'pc-coffee';
        else if (row.plannedHome)
            iconName = 'pc-house';
        else if (row.status === 'absent')
            iconName = /krank/i.test(row.absence ?? '') ? 'pc-plus' : 'pc-case';
        if (iconName) {
            const icon = new St.Icon({gicon: this._ext.icon(iconName), style_class: 'pointchamp-status-icon', y_align: Clutter.ActorAlign.CENTER});
            icon.add_style_class_name(row.status);
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
        for (const key of ['_startupId', '_retryId']) {
            if (this[key]) {
                GLib.source_remove(this[key]);
                this[key] = 0;
            }
        }
        this._cancellable.cancel();
        if (this._settingsChangedId)
            this._settings.disconnect(this._settingsChangedId);
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
