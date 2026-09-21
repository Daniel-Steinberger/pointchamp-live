# PointChamp Live – Projektregeln

GNOME-Shell-50-Erweiterung (`pointchamp-live@dst/`), die aus der PointChamp-Zeiterfassung der
DVS anzeigt, wer eingestempelt ist, plus Anträge zur Überprüfung. Überblick, Installation und
Testablauf stehen in `README.md`; die API-Fakten in `docs/api-recherche.md`.

## Sprache und Stil

- Deutsch in Doku, Commit-Messages, Kommentaren und UI-Texten; Code-Bezeichner Englisch.
- Commit-Messages: Betreff als Aussage, Body erklärt das Warum. Anführungszeichen im Body
  als „…“ schreiben oder die Message per `git commit -F <datei>` übergeben, sonst zerlegt die
  Shell den Befehl.
- Kein Emoji, keine negativen Ränder, keine Abkürzungen in UI-Texten außer FZA/HO.

## Harte Regeln (jede hat schon einmal geschadet)

1. **Kein libsecret im Shell-Prozess.** `extension.js` und `api.js` importieren nie `gi://Secret`.
   Das Passwort kommt über `secret-helper.js` (eigener gjs-Prozess); `secret.js` nur in
   `prefs.js` und im Helfer. Hintergrund: Absturz `free(): invalid pointer` in libgcr-4 beim Login.
2. **Keine negativen Ränder in St-CSS.** Überlauf der bevorzugten Breite auf 2^32, das ganze
   Panel wurde nicht mehr gezeichnet. Überlagerungen mit `Clutter.BinLayout` und `x_align`/`y_align`.
3. **Symbolische Icons als Flächen.** Neue SVGs unter `icons/` mit
   `inkscape --actions="select-all;object-stroke-to-path;export-plain-svg;export-filename:X;export-do"`
   wandeln, sonst werden Striche vom Recoloring zu Klecksen gefüllt.
4. **Keine Zugangsdaten, keine echten Kollegennamen ins Repo.** Screenshots und Beispieldaten
   nur mit fiktiven Namen; Personalnummern neutralisieren. Das Repo ist öffentlich
   (github.com/Daniel-Steinberger/pointchamp-live).
5. **Web-Login nur mit Erlaubnis.** Das persönliche Konto des Nutzers darf für die
   Web-Oberfläche verwendet werden (erteilt am 2026-09-03); Aktionen, die etwas verändern
   (Genehmigen/Ablehnen), nur auf ausdrücklichen Wunsch auslösen. Recherche immer nur lesend.

## Arbeitsweise

- **Testen ohne Neuanmeldung**: headless Shell mit eigener D-Bus-Sitzung und keyfile-GSettings
  (`dbus-run-session -- tools/headless/run.sh <ausgabeverzeichnis>`, Beispieldaten in `tools/headless/inject.js`;
  danach `menu.png` ansehen und `shell.log` auf `JS ERROR` prüfen). Nie `gsettings`/`gdbus` gegen
  die laufende Sitzung richten, außer der Nutzer will genau das. `DCONF_PROFILE` nicht verwenden.
- Vor jedem Commit: `glib-compile-schemas schemas/` und `node --input-type=module --check < datei.js`
  für alle geänderten Module, dann der headless Smoke-Test.
- **Geänderter Code wirkt erst nach Ab- und Anmelden.** `gnome-extensions disable/enable` lädt
  nur `stylesheet.css` neu. Dem Nutzer das explizit sagen.
- Die Erweiterung ist per Symlink aus diesem Arbeitsverzeichnis installiert; der ausgecheckte
  Branch ist also der, den die Shell beim nächsten Login lädt.
- Ein Shell-Absturz landet als Apport-Report unter `/var/crash/_usr_bin_gnome-shell.1000.crash`;
  `apport-unpack` + `gdb -batch -ex "bt 40" /usr/bin/gnome-shell CoreDump` liefert den Stacktrace.
  Nach einem Absturz beim Start setzt GNOME `disable-user-extensions` auf `true`.

## Datenquellen (Kurzfassung)

- Externe API (`/external/api/…`, JWT 1 h): `time/tracking/days` (offenes Segment = `minutes: null`),
  `employee/absence/` (inkl. Art `Homeoffice*` für geplantes Homeoffice), `employee/masta/data/`
  (Stammdaten, schnell). Der volle Tagesabruf dauert ~10 s, deshalb pro Person per `search` laden.
- Web-Oberfläche (Session-Cookie, 15 min Timeout): Anträge unter `/de/administration/holiday/`
  und `/de/administration/illness/open`, Aktionen `…/batch/acceppt|decline` (Tippfehler ist Teil
  der URL). Stempel-Kategorien je Segment nur in der Admin-Detailansicht
  `/de/administration/time/tracking/detail/<user>/<datum>`; Zeilen-ID = Segment-ID der API.
  Admin-Bereiche antworten ohne Berechtigung mit 403, darauf baut `web.capabilities()`.
- Alles, was die Web-Oberfläche braucht, muss ohne Berechtigung stillschweigend entfallen; die
  Grundfunktion (Tagesleiste aus der externen API) darf nie davon abhängen.
- Der bestehende Python-Client im Monorepo liegt unter `~/src/dvs/dvs_pointchamp/api.py`,
  die Service-Zugangsdaten in `~/src/dvs/dvs-ansible/playbooks/files/dvs-config-local.py`
  (nie kopieren, nur zum Testen lesen).
