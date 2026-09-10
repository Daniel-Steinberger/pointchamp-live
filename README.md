# PointChamp Live – GNOME-Shell-Erweiterung

Zeigt im Panel ein Personen-Symbol. Ein Klick öffnet die Tagesleiste (Design „Option C"):
je Person eine Zeitachse mit Arbeits- und Pausensegmenten aus der PointChamp-API,
offenes Segment läuft bis „jetzt", Abwesende schraffiert mit Ende, Resttagen und Rückkehrtag,
geplantes Homeoffice mit Haus-Symbol. Pfeile im Kopf blättern durch vergangene Tage.

Funktionen (Stand 2026-09-10, alles auf `main`):

- **Live-Status** je Person: arbeitet, Pause, heute fertig, noch nicht da, abwesend
- **Abteilungsfilter** und **Tags** je Person (z. B. Bestand, medVS, StBVS) als farbige Badges
- **Schnelles, fortlaufendes Laden**: nur die Personen der gewählten Abteilungen, jede
  Antwort erscheint sofort (erste Zeile nach ~2 s, alle nach ~4 s statt 10 s)
- **Anträge zur Überprüfung** (Urlaub, Freizeitausgleich …) mit Genehmigen/Ablehnen direkt im
  Menü, rotem Punkt am Panel-Symbol und GNOME-Benachrichtigung; opt-in, läuft über die
  Web-Oberfläche mit dem eigenen Konto. Erste echte Freigabe am 2026-09-10 erfolgreich.

Verzeichnisse:

- `pointchamp-live@dst/` – die Erweiterung (ESM, GNOME Shell 50, Soup 3, libadwaita)
- `design/` – Designvorschläge als Design-Canvas (`build_artboards.py` erzeugt die Artboards),
  `design/screenshots/` – Bilder aus der headless Shell mit fiktiven Namen
- `docs/api-recherche.md` – API-Recherche (Endpunkte, Feldsemantik, Grenzen)
- `docs/2026-09-10-panel-unsichtbar.md` – Analyse des Panel-Bugs durch negativen Rand
- `CLAUDE.md` – Projektregeln für die Arbeit mit Claude Code

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

### Schlüsselbund nur außerhalb der Shell

libsecret darf **nicht** im Shell-Prozess laufen: Beim Login (Schlüsselbund noch nicht bereit)
stürzte GNOME Shell mit `free(): invalid pointer` in `libgcr-4`/`libgcrypt` ab, GNOME schaltete
daraufhin alle Erweiterungen ab. Deshalb liest die Erweiterung das Passwort über den
Helfer-Prozess `secret-helper.js` (`gjs -m secret-helper.js lookup <server> <user>`, Exit 0/2/1).
`secret.js` mit dem libsecret-Code wird nur vom Helfer und von `prefs.js` importiert.
Die erste Abfrage startet 10 s nach dem Laden, bei fehlendem Passwort wird bis zu sechsmal
im Abstand von 20 s erneut versucht.

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

## Gelernte Regeln für St/Clutter

- **Kein libsecret im Shell-Prozess** (Absturz beim Login, siehe oben).
- **Keine negativen Ränder in St-CSS**: `margin: … -6px` ließ die bevorzugte Breite auf 2^32
  überlaufen, das gesamte Panel wurde per Culling nicht mehr gezeichnet
  (`docs/2026-09-10-panel-unsichtbar.md`). Überlagerungen mit `Clutter.BinLayout` + `x_align`/`y_align`.
- **Symbolische Icons müssen Flächen sein**: das Recoloring füllt alle Pfade; Strich-SVGs per
  Inkscape `object-stroke-to-path` wandeln.
- Bei Merge-Konflikten im Settings-Handler: `known-*`-Schlüssel dürfen kein Neuladen auslösen.

## Anträge zur Überprüfung

Die externe API kennt keine Anträge. Die Erweiterung meldet sich deshalb optional mit dem eigenen
Konto in der Web-Oberfläche an (`web.js`, Session-Cookie, Re-Login nach 15 min Inaktivität) und liest
die Admin-Seiten `/de/administration/holiday/` (Urlaubsanträge) und `/de/administration/illness/open`
(sonstige Ab-/Anwesenheiten wie Freizeitausgleich). Aus dem „Open"-Bereich werden Zähler und
Tabellenzeilen mit Checkbox-IDs geparst.

Genehmigen/Ablehnen nutzt dieselben Aufrufe wie die Web-Oberfläche:
`POST /de/administration/holiday/batch/acceppt|decline` mit `holidaysIDS[]` bzw.
`POST /de/administration/absence/batch/acceppt|decline` mit `absenceIDS[]` (Antwort JSON mit den
noch offenen IDs). Im Menü hat jede Antragszeile zwei Knöpfe mit zweistufiger Bestätigung
(„Wirklich?" innerhalb von 5 s). Offene Anträge zeigen einen roten Punkt am Panel-Symbol und
optional eine GNOME-Benachrichtigung. Einschalten unter Einstellungen → Anträge.

Der Zeilen-Parser wurde zunächst gegen eine nachgebaute Zeile geprüft. Am 2026-09-10 wurde der
erste echte Urlaubsantrag über das Menü genehmigt; PointChamp führt ihn seitdem als „Antrag
akzeptiert" mit dem Zeitstempel der Freigabe, der Antrag verschwand aus der Warteschlange und
der Urlaub erschien in der Abwesenheitsliste der API.

## Tags je Person

Unter Einstellungen → Personen → Tags bekommt jede Person der eingeschalteten Abteilungen ein
Eingabefeld für kommagetrennte Tags. Gespeichert wird in `person-tags` (GSettings `a{sas}`,
Name → Liste). Im Menü erscheinen sie als Badges hinter dem Namen; die Farbe wird stabil aus dem
Tag-Namen abgeleitet (GNOME-Palette in `api.js`). Die Personenliste kommt aus den Stammdaten
(`known-persons`, bei jedem Abruf aktualisiert).

## Bekannte Grenzen

- Die tatsächliche Stempel-Kategorie (Homeoffice/Office/Unterwegs) liefert die externe API nicht;
  gezeigt wird nur geplantes Homeoffice aus den Abwesenheiten (`Homeoffice*`). Nicht jeder
  Homeoffice-Eintrag der Web-Live-Ansicht taucht dort auf.
- Abteilungen und Personen (für Tags) sind erst nach dem ersten erfolgreichen Abruf bekannt.
- Kein Zähler im Panel (bewusst nur das Symbol, plus roter Punkt bei offenen Anträgen).
- Der Rückkehrtag nach einer Abwesenheit ist der nächste Werktag Mo–Fr; Feiertage werden nicht
  berücksichtigt. Resttage zählen Kalendertage.
- Geänderter Erweiterungscode wird von der Shell erst nach Ab- und Anmelden geladen; ein
  Aus-/Einschalten lädt nur das Stylesheet neu.
