# PointChamp Live – GNOME-Shell-Erweiterung (Prototyp)

Zeigt im Panel ein Personen-Symbol. Ein Klick öffnet die Tagesleiste (Design „Option C"):
je Person eine Zeitachse mit Arbeits- und Pausensegmenten aus der PointChamp-API,
offenes Segment läuft bis „jetzt", Abwesende schraffiert, geplantes Homeoffice mit Haus-Symbol.
Pfeile im Kopf blättern durch vergangene Tage, Klick aufs Datum springt zurück auf heute.

Verzeichnisse:

- `pointchamp-live@dst/` – die Erweiterung (ESM, GNOME Shell 50, Soup 3, libsecret, libadwaita)
- `design/` – Designvorschläge als Design-Canvas (`build_artboards.py` erzeugt die Artboards)
- `RECHERCHE.md` – API-Recherche (Endpunkte, Feldsemantik, Grenzen)

## Installation

```bash
ln -sfn ~/src/gnome/pointchamp/pointchamp-live@dst ~/.local/share/gnome-shell/extensions/pointchamp-live@dst
glib-compile-schemas ~/src/gnome/pointchamp/pointchamp-live@dst/schemas
gnome-extensions enable pointchamp-live@dst   # wirkt unter Wayland erst nach Ab- und Anmelden
```

Danach in den Einstellungen (Zahnrad im Menü oder `gnome-extensions prefs pointchamp-live@dst`)
Benutzername und Passwort eintragen und „Speichern & prüfen" klicken. Das Passwort landet im
GNOME-Schlüsselbund, die Abteilungsliste wird beim ersten erfolgreichen Abruf gefüllt und kann
unter „Personen" gefiltert werden.

## Testen ohne Ab- und Anmelden

Headless-Shell mit eigener D-Bus-Sitzung und isolierten GSettings (keyfile-Backend), damit die
laufende Sitzung unberührt bleibt:

```bash
export GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME=/tmp/pc-test-config
dbus-run-session -- bash -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"pointchamp-live@dst\"]"
  gnome-shell --headless --wayland --virtual-monitor 1280x800 --unsafe-mode &
  sleep 8
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "import(\"resource:///org/gnome/shell/ui/main.js\").then(({panel}) => panel.statusArea[\"pointchamp-live@dst\"].menu.open())"
  sleep 3
  gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false /tmp/pc-menu.png
  kill %1'
```

Für ein Bild mit Daten ohne Schlüsselbund lässt sich der Cache per `Eval` füllen
(`ind._cache.set(datum, {tracking, absences, fetchedAt, wallClock}); ind._render()`), siehe
`_refresh()`/`_render()` in `extension.js`. Wichtig: `departments` **vor** dem Cache setzen,
der `changed`-Handler leert den Cache.

Alternativ: `dbus-run-session -- gnome-shell --nested --wayland` öffnet die Shell in einem Fenster.

## Bekannte Grenzen des Prototyps

- Die tatsächliche Stempel-Kategorie (Homeoffice/Office/Unterwegs) liefert die externe API nicht;
  gezeigt wird nur geplantes Homeoffice aus den Abwesenheiten (`Homeoffice*`). Nicht jeder
  Homeoffice-Eintrag der Web-Live-Ansicht taucht dort auf.
- Abteilungen sind erst nach dem ersten erfolgreichen Abruf bekannt.
- Keine Benachrichtigungen, kein Zähler im Panel (bewusst nur das Symbol).
