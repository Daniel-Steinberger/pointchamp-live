# PointChamp – Recherche für eine GNOME-Panel-Erweiterung „Wer ist da?"

Stand: 2026-09-02. Getestet gegen https://dvs.pointchamp.de mit dem Service-Konto aus
`~/src/dvs/dvs-ansible/playbooks/files/dvs-config-local.py` (Abschnitt `pointchamp`).
Zugangsdaten stehen dort im Klartext – **nicht** hierher kopieren.

## Vorhandener Code im Monorepo `~/src/dvs`

| Ort | Inhalt |
|---|---|
| `dvs_pointchamp/api.py` | Minimaler Client: Login → Bearer-Token, GET auf absence / tracking/days / statistic / holiday/days |
| `dvs_pointchamp/tests/test_api_characterization.py` | Charakterisierungstests (gemocktes HTTP) |
| `anwvs/web/blueprints_intranet/pointchamp.py` | Intranet-Seite + Excel-Export der Statistik |
| `anwvs/bin/hr_report.py` | HR-Report auf Basis statistic + holiday/days |
| `anwvs/bin/pointchamp_abwesenheiten_sync.py`, `dvs_openproject/op_abwesenheiten.py` | Abwesenheiten → OpenProject |
| `dvs-ansible/playbooks/files/dvs-config@*.py` | Konfiguration (URLs, Login) |

Technischer Ansprechpartner steht im Docstring von `dvs_pointchamp/api.py`.

## Externe API (`/external/api/…`, Swagger 2.0 unter `/api/doc`, nur nach Web-Login sichtbar)

Auth: `POST /external/api/login_check` mit `{"username","password"}` → `{"token"}` (JWT, **1 h gültig**,
`sub` = User-ID 57, `roles: []`). Danach `Authorization: Bearer <token>`.

| Endpunkt | Parameter | Liefert |
|---|---|---|
| `GET /external/api/time/tracking/days` | `start`, `end` (Y-m-d, Default heute), `search` | pro Mitarbeiter: id, personnelNumber, name, department, workingTimeAccount, `days` |
| `GET /external/api/employee/absence/` | `start`, `end`, `search`, `absence` | Abwesenheiten: id, personalnummer, name, von, bis (dd.mm.yyyy), tage, art, konto |
| `GET /external/api/employee/holiday/days` | `year` | Urlaubskonten je Mitarbeiter |
| `GET /external/api/employee/statistic/` | `start`, `end`, `search` | Statistik je Abteilung/Mitarbeiter (Minuten) |
| `GET /external/api/employee/masta/data/` | `search` | Stammdaten inkl. department, telephone, mobile, jobTitle |
| `GET /external/api/employee/training/courses/`, `/happy/index/`, `/kvp/`, `/.well-known/jwks.json` | | für dieses Vorhaben irrelevant |

### `tracking/days` im Detail (Kern für die Live-Ansicht)

```json
{"id": 1, "personnelNumber": "1234", "name": "Vorname Nachname", "department": "IT",
 "workingTimeAccount": 792,
 "days": {"2026-09-02": {"date": "2026-09-02", "start": "09:13:47", "end": "13:09:44",
    "break": "0", "sum": "517", "must": 480, "actual": 286, "difference": -194,
    "detail": [[
      {"id": 134301, "start": "09:13:47", "end": "13:09:44", "break": false, "minutes": 236},
      {"id": 134346, "start": "13:09:44", "end": "13:59:31", "break": true,  "minutes": 50},
      {"id": 134362, "start": "13:59:31", "end": "17:51:07", "break": false, "minutes": null}
    ]]}}}
```

Beobachtete Semantik (heute verifiziert gegen die Web-Live-Ansicht, 5 von 5 Treffer):

- **Aktuell eingestempelt** ⇔ letztes `detail`-Segment hat `minutes: null` (das `end` ist dann
  „jetzt"). `break: false` → arbeitet, `break: true` → in Pause.
- **Heute schon gearbeitet, jetzt ausgestempelt** ⇔ Tag vorhanden, kein offenes Segment.
  Pausen-Historie ist über die Segmente vollständig sichtbar.
- **Noch nicht eingestempelt** ⇔ `days` leer.
- Quirks: `days` ist ein **dict** wenn befüllt, aber eine **leere Liste** wenn leer.
  `detail` ist eine Liste mit einer Liste. Nach Tagesende hängt PointChamp ein
  Korrektursegment mit negativen Pausenminuten an (z. B. `-45`), ignorieren.
  Doppelte Leerzeichen in Namen (`"Baris  Üctas"`).
- `search` matcht Teilstrings in Name **oder** Abteilung („IT" trifft auch „Debitorenmanagement").
  Abteilungsfilter daher clientseitig exakt über `department`.
- Anzahl heute: 81 Mitarbeiter, 9 Abteilungen: Debitorenmanagement, Finance, Geschäftsleitung, IT,
  IT Systemadministration, Kanzlei, Kundenbetreuung / Erfassung, Marketing / Vertrieb, Stab.

### `absence` – Abwesenheitsarten (beobachtet −30/+60 Tage)

Urlaub, Resturlaub, Sonderurlaub, Freizeitausgleich, Krankheit, Krankheit Kind, Elternzeit,
Freistellung, **Homeoffice\*** (geplanter Homeoffice-Tag wird als Abwesenheit geführt).

## Web-Live-Ansicht („LIVE-Übersicht")

- `GET /de/time/tracking/live?department=<id>&search=` (Session-Cookie nötig, Formular-Login über
  `/login_check` mit CSRF-Token). Liefert **HTML-Fragment**, kein JSON. Wird im Browser alle 30 s neu
  geladen. Abteilungs-IDs: 0 alle, 1 IT, 2 Stab, 3 Kanzlei, 4 Kundenbetreuung / Erfassung,
  5 Debitorenmanagement, 6 Geschäftsleitung, 7 Marketing / Vertrieb, 8 IT Systemadministration, 9 Finance.
- Zeigt nur: eingestempelte Personen (Status `Start` grün / `Pause` rosa / `Homeoffice` + Uhrzeit des
  aktuellen Segments) sowie Personen mit Abwesenheit (Urlaub, Krankheit, Elternzeit, Freistellung,
  Homeoffice\*). Wer regulär ausgestempelt ist, fehlt komplett.
- Beim Einstempeln wählt man eine **Zeitkategorie: Homeoffice / Office / Unterwegs**. Diese
  Kategorie erscheint **nur** in der Web-Live-Ansicht (z. B. „Homeoffice | Homeoffice* | Homeoffice*"),
  **nicht** in der externen API. Was „Start" genau bedeutet (Office oder „keine Kategorie") ist noch offen.
- Die Web-App nutzt Mercure (Cookie `mercureAuthorization`) für Push – für uns nicht nötig.

## Nachtrag 2026-09-10: Anträge über die Web-Oberfläche

Für Anträge zur Überprüfung gibt es keine API. Die Web-Oberfläche liefert sie unter
`/de/administration/holiday/` (Urlaub) und `/de/administration/illness/open` (sonstige
Ab-/Anwesenheiten); Genehmigen/Ablehnen läuft über `POST …/holiday/batch/acceppt|decline`
mit `holidaysIDS[]` bzw. `…/absence/batch/acceppt|decline` mit `absenceIDS[]`, Antwort JSON mit
den noch offenen IDs. Login per Formular mit CSRF-Token, Sitzung endet nach 15 min Inaktivität.
Implementiert in `web.js`, erste echte Freigabe am 2026-09-10 erfolgreich.

## Nachtrag 2026-09-21: Stempel-Kategorie je Segment

Die Kategorie (Homeoffice / Office / Unterwegs / keine) steht weder in `tracking/days` noch im
CSV-Export; die Web-Live-Ansicht zeigt sie nur für das laufende Segment. Vollständig je Segment
liefert sie die Admin-Detailansicht `/de/administration/time/tracking/detail/<user>/<datum>`
(Tabelle mit Spalte „Zeitkategorie"). Die Zeilen-IDs `id-<n>` sind die Segment-IDs der API,
die Zuordnung ist damit eindeutig. Die User-IDs stehen in den Detail-Links der Übersichtsseite
`/de/administration/time/tracking/?date=…&department=0`. Beide Seiten liefern ohne Berechtigung
HTTP 403 (mit dem Service-Konto verifiziert), was die Erweiterung zur Klassifikation des Kontos nutzt.
Kosten: ~2,5 MB je Detailseite, daher nur bei neuen Segment-IDs nachladen.

## Bewertung

| Wunsch | Externe API | Web-Scraping |
|---|---|---|
| Wer ist gerade eingestempelt | ✅ offenes Segment | ✅ |
| Wer war heute da / ist in Pause / kommt vermutlich wieder | ✅ Segment-Historie | ⚠️ nur Pause-Status, keine Historie |
| Filter nach Abteilung | ✅ `department`-Feld | ✅ `department=<id>` |
| Urlaub / Krankheit / Abwesenheit | ✅ `absence` | ✅ (nur heutiger Tag) |
| Homeoffice vs. vor Ort | ⚠️ nur **geplant** (Abwesenheitsart `Homeoffice*`) | ✅ je Segment in der Admin-Detailansicht (Nachtrag 2026-09-21) |
| Historie vergangener Tage | ✅ `start`/`end` | ❌ |
| Stabilität | ✅ dokumentierte JSON-API | ⚠️ HTML-Struktur, Session-Login |

Umgesetzt (Stand 2026-09-21): **Externe API als Grundlage**, geplantes Homeoffice aus `absence`,
Stempel-Kategorien je Segment und Anträge aus der Web-Oberfläche mit dem persönlichen Konto des
Nutzers. Das Passwort liegt im GNOME-Schlüsselbund und wird über einen Helfer-Prozess gelesen.
Eine API-Erweiterung um die Kategorie in `tracking/days.detail` würde die Web-Abhängigkeit
für diesen Teil überflüssig machen.
