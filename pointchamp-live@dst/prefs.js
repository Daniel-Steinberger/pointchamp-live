import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {PointChampClient} from './api.js';
import {lookupPassword, storePassword} from './secret.js';

export default class PointChampLivePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);
        window.add(this._accountPage(settings));
        window.add(this._peoplePage(settings));
        window.add(this._displayPage(settings));
        window.add(this._approvalsPage(settings));
    }

    // ------------------------------------------------------------ Konto
    _accountPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Konto', icon_name: 'dialog-password-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'PointChamp-Zugang',
            description: 'Das Passwort wird im GNOME-Schlüsselbund gespeichert, nicht in den Einstellungen.',
        });
        page.add(group);

        const server = new Adw.EntryRow({title: 'Server'});
        settings.bind('server-url', server, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(server);

        const user = new Adw.EntryRow({title: 'Benutzername'});
        settings.bind('username', user, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(user);

        const pw = new Adw.PasswordEntryRow({title: 'Passwort'});
        group.add(pw);
        lookupPassword(settings.get_string('server-url'), settings.get_string('username'))
            .then(p => { if (p) pw.text = p; })
            .catch(e => console.warn(`[pointchamp-live] Schlüsselbund: ${e.message}`));

        const status = new Adw.ActionRow({title: 'Verbindung', subtitle: 'Noch nicht geprüft'});
        const testBtn = new Gtk.Button({label: 'Speichern & prüfen', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        status.add_suffix(testBtn);
        group.add(status);

        testBtn.connect('clicked', async () => {
            testBtn.sensitive = false;
            status.subtitle = 'Prüfe …';
            try {
                await storePassword(server.text, user.text, pw.text);
                const client = new PointChampClient(server.text, user.text, pw.text);
                const today = GLib.DateTime.new_now_local().format('%Y-%m-%d');
                const data = await client.trackingDays(today);
                const depts = [...new Set(data.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
                settings.set_strv('known-departments', depts);
                status.subtitle = `Verbunden · ${data.length} Personen, ${depts.length} Abteilungen`;
            } catch (e) {
                status.subtitle = `Fehler: ${e.message}`;
            } finally {
                testBtn.sensitive = true;
            }
        });
        return page;
    }

    // ------------------------------------------------------------ Personen
    _peoplePage(settings) {
        const page = new Adw.PreferencesPage({title: 'Personen', icon_name: 'system-users-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Abteilungen',
            description: 'Nur Personen aus eingeschalteten Abteilungen erscheinen im Panel-Menü. Nichts eingeschaltet = alle.',
        });
        page.add(group);

        const rows = [];
        const rebuild = () => {
            for (const r of rows)
                group.remove(r);
            rows.length = 0;
            const known = settings.get_strv('known-departments');
            const active = new Set(settings.get_strv('departments'));
            if (!known.length) {
                const hint = new Adw.ActionRow({title: 'Noch keine Abteilungen bekannt', subtitle: 'Unter „Konto" die Verbindung prüfen, dann erscheint die Liste hier.'});
                group.add(hint);
                rows.push(hint);
                return;
            }
            for (const dept of known) {
                const row = new Adw.SwitchRow({title: dept, active: active.has(dept)});
                row.connect('notify::active', () => {
                    const cur = new Set(settings.get_strv('departments'));
                    if (row.active)
                        cur.add(dept);
                    else
                        cur.delete(dept);
                    settings.set_strv('departments', [...cur].sort((a, b) => a.localeCompare(b, 'de')));
                });
                group.add(row);
                rows.push(row);
            }
        };
        rebuild();
        const id = settings.connect('changed::known-departments', rebuild);
        page.connect('destroy', () => settings.disconnect(id));

        const single = new Adw.PreferencesGroup({title: 'Einzelne Personen'});
        page.add(single);
        const hidden = new Adw.EntryRow({title: 'Ausblenden (kommagetrennt)', text: settings.get_strv('hidden-names').join(', ')});
        hidden.connect('changed', () => {
            settings.set_strv('hidden-names', hidden.text.split(',').map(s => s.trim()).filter(Boolean));
        });
        single.add(hidden);
        return page;
    }

    // ------------------------------------------------------------ Anträge
    _approvalsPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Anträge', icon_name: 'emblem-ok-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Anträge zur Überprüfung',
            description: 'Urlaubsanträge und sonstige Ab-/Anwesenheiten (z. B. Freizeitausgleich) aus dem Adminstudio. '
                + 'Dafür meldet sich die Erweiterung mit deinem Konto in der Web-Oberfläche an; Genehmigen und Ablehnen erfolgen in deinem Namen.',
        });
        page.add(group);
        const enable = new Adw.SwitchRow({title: 'Anträge abrufen', subtitle: 'Nur sinnvoll, wenn dein Konto Anträge genehmigen darf'});
        settings.bind('approvals-enabled', enable, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enable);
        const interval = new Adw.SpinRow({
            title: 'Intervall', subtitle: 'Sekunden zwischen zwei Abfragen',
            adjustment: new Gtk.Adjustment({lower: 60, upper: 3600, step_increment: 60}),
        });
        settings.bind('approvals-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(interval);
        const notify = new Adw.SwitchRow({title: 'Benachrichtigung bei neuen Anträgen'});
        settings.bind('approvals-notify', notify, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(notify);
        return page;
    }

    // ------------------------------------------------------------ Anzeige
    _displayPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Anzeige', icon_name: 'preferences-system-time-symbolic'});

        const refresh = new Adw.PreferencesGroup({title: 'Aktualisierung'});
        page.add(refresh);
        const interval = new Adw.SpinRow({
            title: 'Intervall', subtitle: 'Sekunden zwischen zwei Abfragen (heute)',
            adjustment: new Gtk.Adjustment({lower: 15, upper: 900, step_increment: 15}),
        });
        settings.bind('refresh-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        refresh.add(interval);

        const axis = new Adw.PreferencesGroup({title: 'Zeitachse'});
        page.add(axis);
        for (const [key, title] of [['day-start', 'Beginn (Stunde)'], ['day-end', 'Ende (Stunde)']]) {
            const row = new Adw.SpinRow({title, adjustment: new Gtk.Adjustment({lower: 0, upper: 24, step_increment: 1})});
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            axis.add(row);
        }

        const show = new Adw.PreferencesGroup({title: 'Zeilen'});
        page.add(show);
        for (const [key, title, subtitle] of [
            ['show-finished', 'Heute Beendete anzeigen', 'Personen, die ausgestempelt haben'],
            ['show-absent', 'Abwesende anzeigen', 'Urlaub, Krankheit, Elternzeit, Freistellung'],
            ['show-not-stamped', 'Ohne Buchung anzeigen', 'Noch nicht eingestempelt, z. B. geplantes Homeoffice'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            show.add(row);
        }
        return page;
    }
}
