# Bug: negativer Rand am Panel-Punkt macht das gesamte Panel unsichtbar

> **Behoben am 2026-09-10** nach dem Vorschlag unten: Icon und Punkt liegen in einer
> `Clutter.BinLayout`-Zelle, der Punkt hat `x_align: END`, `y_align: START` und keinen negativen
> Rand mehr. Headless verifiziert: bevorzugte Breite des Punktes 12 px statt 2^32, Panel wird
> mit sichtbarem Punkt gezeichnet.

Gefunden am 2026-09-10, GNOME Shell 50.1 auf Wayland, zusammen mit Dash to Panel v73
(vertikales Panel am rechten Rand). Der Fehler liegt in dieser Erweiterung, nicht in
Dash to Panel.

## Symptom

Das komplette Panel wird nicht mehr gezeichnet, funktioniert aber weiter:

- kein Panelhintergrund, keine Icons, keine Uhr, an der Stelle ist die Tapete zu sehen
- der Platz bleibt reserviert, Fenster laufen nicht darunter
- Klick auf eine Menüposition öffnet das Menü, Hover zeigt Fenstervorschauen

Also ein reines Zeichenproblem. Eingaben sind nicht betroffen.

## Ursache

`stylesheet.css:33`

```css
.pointchamp-panel-dot { width: 8px; height: 8px; border-radius: 999px;
                        background-color: #f66151; margin: 3px 0 0 -6px; }
```

Der **negative linke Rand** von `-6px` soll den Punkt als Abzeichen über das Icon
ziehen. St rechnet Ränder in die bevorzugte Breite ein und läuft dabei über.

Gemessene Werte am lebenden Aktor:

| Aktor | bevorzugte Breite (min, natural) |
|---|---|
| `.pointchamp-panel-dot` (StWidget) | **4294967296, 4294967296** |
| derselbe, nach Entfernen des Rands | 8, 8 |

4294967296 ist exakt 2^32, also ein übergelaufener Wert.

Von dort wandert er nach oben in das **Malvolumen**:

| Aktor | Malvolumen (Breite x Höhe) |
|---|---|
| Wrapper um die panelBox | 48 x 1080 (korrekt) |
| panelBox | **4294967296** x 1080 |
| panel | **4294967296** x 1080 |
| Taskbar | 48 x 384 (korrekt) |

Clutter benutzt das Malvolumen fürs Culling, also um zu entscheiden, welche Aktoren
überhaupt gezeichnet werden müssen. Mit 2^32 Breite scheitert diese Berechnung und der
gesamte Panel-Teilbaum wird übersprungen. Culling betrifft ausschließlich das Zeichnen,
nicht die Eingabe. Das erklärt „unsichtbar, reagiert aber".

## Warum das erst jetzt aufgetreten ist

`extension.js:254`

```js
this._dot.visible = this._requests.length > 0
```

Der Punkt ist normalerweise unsichtbar und liefert dann keinen Beitrag zur
Größenberechnung. Erst beim ersten offenen Antrag wird er sichtbar, und ab diesem
Moment vergiftet seine Größenanforderung das Panel. Der Fehler schlummerte also seit
dem Einbau des Punktes und wurde durch den ersten echten Antrag ausgelöst.

## Beweisführung

In dieser Reihenfolge ausgeschlossen und belegt, jeweils über `org.gnome.Shell.Eval`
bei aktivem Unsafe Mode:

1. Alle Aktoreigenschaften des Panels sind in Ordnung: `opacity 255`, `visible`,
   `mapped`, `paint_visibility true`, Skalierung 1, korrekte absolute Position
   (5712, 0, 48 x 1080), keine Effekte, Clipping korrekt mit `[0, 0, 48, 1080]`.
2. Kein Aktor liegt darüber: die beiden `MetaWindowGroup` oberhalb in `uiGroup` sind
   leer, `global.window_group` liegt korrekt darunter auf Index 0.
3. Ein frisch eingefügtes rotes Rechteck an derselben Position wird vollständig
   gezeichnet. Der Bildschirmbereich rendert also einwandfrei.
4. Ein `Clutter.Clone` des Panels an anderer Stelle zeigt den kompletten Inhalt mit
   allen Icons. Der Inhalt ist intakt, er wird nur an seinem Platz nicht gemalt.
   Ein Klon umgeht das Culling der Quelle, was den Verdacht bestätigt hat.
5. Ein greller Teststil auf dem Panel und auf dem Taskbar-Aktor erzeugt null Pixel,
   obwohl der Stil beim Rücklesen gesetzt ist.
6. Nach `dot.set_style('margin: 3px 0 0 0;')` fällt die bevorzugte Breite auf 8 und die
   Panelfarbe `(36, 31, 49)` ist sofort wieder messbar.

## Möglicher Fix

Der negative Rand muss weg. Damit der Punkt trotzdem als Abzeichen über der Ecke des
Icons sitzt und **keine zusätzliche Breite** kostet, gehören Icon und Punkt in dieselbe
Zelle statt nebeneinander.

`extension.js`, um Zeile 130

```js
this._dot = new St.Widget({
    style_class: 'pointchamp-panel-dot',
    visible: false,
    x_align: Clutter.ActorAlign.END,
    y_align: Clutter.ActorAlign.START,
})
const box = new St.Widget({
    style_class: 'pointchamp-panel-box',
    layout_manager: new Clutter.BinLayout(),
})
box.add_child(this._icon)
box.add_child(this._dot)
```

`stylesheet.css:33`, der Rand entfällt ersatzlos

```css
.pointchamp-panel-dot { width: 8px; height: 8px; border-radius: 999px;
                        background-color: #f66151; }
```

Zu prüfen ist dabei, ob `.pointchamp-panel-box` mit `padding: 0px 0;` und dem Wechsel
von `St.BoxLayout` auf `St.Widget` mit `BinLayout` noch wie gewünscht sitzt.

### Alternative, kleinerer Eingriff

Rand entfernen und stattdessen `this._dot.translation_x = -6` setzen. Eine Verschiebung
wirkt nur beim Zeichnen und verändert die Größenanforderung nicht. Die Box wird dadurch
allerdings um die volle Punktbreite breiter, der Punkt überlappt das Icon also optisch,
belegt aber weiter eigenen Platz.

### Regel fürs Nächste

In St keine negativen Ränder verwenden. Der Schaden trifft nicht das eigene Widget,
sondern über das Malvolumen den gesamten Panel-Teilbaum.

## Verifikation nach dem Fix

Der Fehler ist nur sichtbar, **wenn der Punkt sichtbar ist**, also bei mindestens einem
offenen Antrag. Für einen Test ohne echten Antrag lässt sich der Punkt erzwingen, zum
Beispiel indem `visible` vorübergehend fest auf `true` gesetzt wird.

Prüfpunkte:

1. Panel bleibt sichtbar, während der Punkt angezeigt wird.
2. Bevorzugte Breite des Punktes ist 8 und nicht 2^32.
3. Malvolumen von `panel` und `panelBox` ist 48 breit.

Punkt 2 und 3 lassen sich ohne Unsafe Mode nicht direkt auslesen. Der Sichttest aus
Punkt 1 genügt aber, da das Symptom eindeutig ist.

## Zustand bei der Übergabe

Das Panel ist derzeit sichtbar, allerdings nur über einen zur Laufzeit gesetzten
Inline-Stil auf dem Punkt-Aktor. Dieser Notbehelf verschwindet beim nächsten Neuladen
der Erweiterung oder beim Abmelden. Am Quelltext wurde nichts geändert.
