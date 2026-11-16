#!/usr/bin/env python3
"""Erzeugt die .dc.html-Artboards für die Designvorschläge (statische Mockups)."""
import re
from pathlib import Path

HERE = Path(__file__).parent
SHELL_CSS = (HERE / '_shell.css').read_text()

ICON = {
    'people': '<circle cx="6" cy="5" r="2.5"/><path d="M1.5 13a4.5 4.5 0 0 1 9 0"/><circle cx="11.5" cy="5.5" r="2"/><path d="M11 9.5a3.5 3.5 0 0 1 3.5 3.5"/>',
    'house': '<path d="M2 8.5 8 3l6 5.5"/><path d="M3.5 7.5V13h9V7.5"/>',
    'coffee': '<path d="M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M11 7h1.5a1.5 1.5 0 0 1 0 3H11"/>',
    'clock': '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    'case': '<rect x="2" y="5" width="12" height="8" rx="1.5"/><path d="M6 5V3.5h4V5"/>',
    'plus': '<path d="M8 4v8M4 8h8"/>',
    'refresh': '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 3v3h-3"/>',
    'gear': '<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    'chev': '<path d="M4 6l4 4 4-4"/>',
    'chevr': '<path d="M6 4l4 4-4 4"/>',
    'ext': '<path d="M9 2h5v5"/><path d="M14 2 7 9"/><path d="M12 9v4H3V4h4"/>',
    'check': '<path d="M3 8.5l3 3 7-7"/>',
    'out': '<path d="M6 3H3.5v10H6"/><path d="M9 5l3 3-3 3"/><path d="M12 8H6"/>',
    'wifi': '<path d="M1.5 6.5a9 9 0 0 1 13 0"/><path d="M4 9a5.5 5.5 0 0 1 8 0"/><circle cx="8" cy="12" r="1" fill="currentColor"/>',
    'vol': '<path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 6a3 3 0 0 1 0 4"/>',
    'bat': '<rect x="1.5" y="4.5" width="11" height="7" rx="1.5"/><path d="M13.5 7v2"/><rect x="3" y="6" width="6" height="4" fill="currentColor" stroke="none"/>',
    'power': '<path d="M8 2v6"/><path d="M4.5 4.5a5 5 0 1 0 7 0"/>',
    'search': '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
    'key': '<circle cx="5.5" cy="10.5" r="3"/><path d="M7.5 8.5 14 2"/><path d="M11 5l2 2"/>',
    'back': '<path d="M10 4 6 8l4 4"/>',
}
GREEN, ORANGE, BLUE, GREY, RED, PURPLE = '#57e389', '#ffa348', '#78aeed', 'rgba(255,255,255,.4)', '#f66151', '#dc8add'


def ico(name, size=16, color=None, extra=''):
    st = f'style="color:{color}"' if color else ''
    return (f'<svg class="ico" viewBox="0 0 16 16" width="{size}" height="{size}" {st} {extra}>'
            f'{ICON[name]}</svg>')


def page(title, body, extra_css='', width=None, height=None, bg='transparent'):
    body = re.sub(r'„([^"„]*)"', '„\\1“', body)
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>{title}</title>
  <style>
{SHELL_CSS}
body {{ background: {bg}; }}
* {{ box-sizing: border-box; }}
{extra_css}
  </style>
</helmet>
{body}
</x-dc>
</body>
</html>
'''


def initials_badge(text, bg, fg='#ffffff'):
    return f'<div class="badge" style="background:{bg};color:{fg}">{text}</div>'


# --------------------------------------------------------------------------- Option A
def option_a():
    def person(name, status, sub, color, icon=None, hover=False, right=None):
        marker = ico(icon, color=color) if icon else f'<span class="dot" style="background:{color}"></span>'
        right_html = f'<span class="dim small">{right}</span>' if right else ''
        return f'''<div class="item{' hover' if hover else ''}">
  {marker}
  <div style="display:flex;flex-direction:column;gap:1px;flex:1;min-width:0">
    <span>{name}</span>
    <span class="dim small">{sub}</span>
  </div>
  {right_html}
</div>'''

    body = f'''<div style="width:380px;padding:28px 24px 40px;display:flex;flex-direction:column;align-items:center;gap:0">
<div class="popup" style="width:352px">
  <div class="item" style="justify-content:space-between;padding-top:6px;padding-bottom:6px">
    <div style="display:flex;align-items:center;gap:8px" class="bold">{ico('people')}<span>Wer ist da?</span></div>
    <div class="pill" style="background:#56565c">IT {ico('chev', 12)}</div>
  </div>
  <div class="heading"><span>Anwesend · 4</span><span style="text-transform:none;letter-spacing:0;font-weight:400">seit</span></div>
  {person('Anna Reuter', '', 'Büro · 4 h 12 min heute', GREEN, right='13:59')}
  {person('Georg Vollmer', '', 'Büro · 3 h 58 min heute', GREEN, hover=True, right='13:51')}
  {person('Lena Brandt', '', 'Homeoffice · 6 h 04 min heute', GREEN, icon='house', right='17:40')}
  {person('Tanja Kühn', '', 'Pause seit 16:21 · kommt vermutlich wieder', ORANGE, icon='coffee', right='16:21')}
  <div class="heading"><span>Heute gearbeitet · 2</span></div>
  {person('Celine Weber', '', '05:27 – 11:56 · 6 h 00 min', GREY, right='Ende 11:56')}
  {person('Michael Sauer', '', 'Homeoffice · 08:02 – 16:30', GREY, icon='house', right='Ende 16:30')}
  <div class="heading"><span>Abwesend · 3</span></div>
  {person('Daniel Kaminski', '', 'Urlaub bis Fr, 04.09.', GREY, icon='case')}
  {person('Nils Hartmann', '', 'Urlaub bis Fr, 11.09.', GREY, icon='case')}
  {person('Mira Jendt', '', 'Krank bis Fr, 04.09.', GREY, icon='plus')}
  <div class="heading"><span>Noch nicht eingestempelt · 1</span></div>
  {person('Alexander Steiner', '', 'Homeoffice geplant', GREY, icon='house')}
  <div class="sep"></div>
  <div class="item" style="justify-content:space-between">
    <div style="display:flex;align-items:center;gap:10px">{ico('refresh')}<span>Aktualisiert 17:58</span></div>
    <span class="dim small">alle 60 s</span>
  </div>
  <div class="item">{ico('ext')}<span>LIVE-Übersicht in PointChamp öffnen</span></div>
  <div class="item">{ico('gear')}<span>Einstellungen …</span></div>
</div>
<p class="dim small" style="margin:18px 0 0;max-width:340px;text-align:center;line-height:1.45">Klassisches Shell-Popup. Gruppen nach Status, Abteilung oben umschaltbar. Historie steckt in der Unterzeile („4 h 12 min heute", „05:27 – 11:56").</p>
</div>'''
    return page('Option A · Statusliste', body)


# --------------------------------------------------------------------------- Option B
def option_b():
    def tile(ini, name, state, color, label, since, hover=False, bg='#47474c'):
        return f'''<div style="display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:16px;background:{'#4f4f55' if hover else bg};min-width:0">
  <div style="display:flex;align-items:center;gap:10px">
    {initials_badge(ini, color if state != 'off' else '#5e5e64', '#1c1c1e' if state != 'off' else 'rgba(255,255,255,.6)')}
    <div style="display:flex;flex-direction:column;min-width:0;flex:1">
      <span class="bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{name}</span>
      <span class="dim small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{label}</span>
    </div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    <span class="pill" style="background:rgba(255,255,255,.08);color:{color if state != 'off' else 'rgba(255,255,255,.55)'}">{ico({'work':'clock','pause':'coffee','home':'house','off':'out','vac':'case','ill':'plus'}[state], 12)}{since}</span>
  </div>
</div>'''

    chips = ''.join(
        f'<span class="pill" style="background:{"#3584e4" if on else "#56565c"};color:#fff;padding:5px 12px">{t}</span>'
        for t, on in [('Alle', False), ('IT', True), ('IT Sysadmin', True), ('Debitoren', False), ('Finance', False)])
    body = f'''<div style="width:470px;padding:28px 24px 40px;display:flex;flex-direction:column;align-items:center">
<div class="popup" style="width:440px;padding:12px;border-radius:24px">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px 10px">
    <div style="display:flex;align-items:center;gap:8px" class="bold">{ico('people')}<span>PointChamp Live</span></div>
    <div style="display:flex;gap:6px;align-items:center" class="dim small">{ico('refresh', 14)}17:58</div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 6px 12px">{chips}</div>
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px">
    {tile('ARe', 'Anna Reuter', 'work', GREEN, 'IT · Büro', 'seit 13:59')}
    {tile('GVo', 'Georg Vollmer', 'work', GREEN, 'IT · Büro', 'seit 13:51', hover=True)}
    {tile('LBr', 'Lena Brandt', 'home', GREEN, 'IT Sysadmin · Homeoffice', 'seit 17:40')}
    {tile('TKü', 'Tanja Kühn', 'pause', ORANGE, 'IT · Pause', 'seit 16:21')}
    {tile('CWe', 'Celine Weber', 'off', GREY, 'IT · 6 h 00 min heute', 'bis 11:56')}
    {tile('MSa', 'Michael Sauer', 'off', GREY, 'IT Sysadmin · Homeoffice', 'bis 16:30')}
    {tile('DKa', 'Daniel Kaminski', 'vac', GREY, 'IT', 'Urlaub bis 04.09.')}
    {tile('MJe', 'Mira Jendt', 'ill', GREY, 'IT', 'Krank bis 04.09.')}
    {tile('ASt', 'Alexander Steiner', 'home', GREY, 'IT · Homeoffice geplant', 'noch nicht da')}
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 6px 2px">
    <span class="dim small">4 anwesend · 2 fertig · 3 abwesend</span>
    <div style="display:flex;gap:4px">
      <div style="width:36px;height:36px;border-radius:999px;background:#47474c;display:flex;align-items:center;justify-content:center">{ico('ext')}</div>
      <div style="width:36px;height:36px;border-radius:999px;background:#47474c;display:flex;align-items:center;justify-content:center">{ico('gear')}</div>
    </div>
  </div>
</div>
<p class="dim small" style="margin:18px 0 0;max-width:400px;text-align:center;line-height:1.45">Kacheln mit Initialen-Badge wie in der PointChamp-Live-Ansicht, Abteilungen als Chips (Mehrfachauswahl). Kompakt bei 6–10 Personen, wird bei 20+ lang.</p>
</div>'''
    return page('Option B · Kacheln', body)


# --------------------------------------------------------------------------- Option C
def option_c():
    # Zeitachse 06:00–19:00 → 13 h auf 300 px  (23.08 px/h)
    T0, W = 6.0, 300.0

    def x(hm):
        h, m = map(int, hm.split(':'))
        return (h + m / 60 - T0) / 13 * W

    def seg(a, b, color, open_=False, hatched=False):
        left, right = x(a), x(b)
        style = f'position:absolute;left:{left:.1f}px;width:{max(right-left,2):.1f}px;top:0;bottom:0;border-radius:4px;background:{color or "transparent"}'
        if open_:
            style += f';background:linear-gradient(90deg,{color},{color} 70%,rgba(0,0,0,0))'
        if hatched:
            style += ';background:repeating-linear-gradient(135deg,rgba(255,255,255,.18) 0 3px,rgba(255,255,255,.04) 3px 7px)'
        return f'<div style="{style}"></div>'

    def row(name, segs, right, color=None, icon=None, hover=False):
        marker = ico(icon, color=color or 'rgba(255,255,255,.55)') if icon else f'<span class="dot" style="background:{color}"></span>'
        return f'''<div class="item{' hover' if hover else ''}" style="gap:12px;padding:7px 12px">
  {marker}
  <span style="width:118px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{name}</span>
  <div style="position:relative;width:{int(W)}px;height:14px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden">{''.join(segs)}
    <div style="position:absolute;left:{x('17:58'):.1f}px;top:0;bottom:0;width:1.5px;background:#ffffff;opacity:.7"></div>
  </div>
  <span class="dim small" style="width:56px;text-align:right">{right}</span>
</div>'''

    ticks = ''.join(f'<span style="position:absolute;left:{x(f"{h:02d}:00"):.1f}px;transform:translateX(-50%)">{h}</span>' for h in (6, 8, 10, 12, 14, 16, 18))
    body = f'''<div style="width:600px;padding:28px 24px 40px;display:flex;flex-direction:column;align-items:center">
<div class="popup" style="width:572px">
  <div class="item" style="justify-content:space-between;padding-top:6px;padding-bottom:6px">
    <div style="display:flex;align-items:center;gap:8px" class="bold">{ico('people')}<span>Heute · Mi, 02.09.</span></div>
    <div style="display:flex;gap:6px">
      <div class="pill" style="background:#56565c">{ico('back', 12)}</div>
      <div class="pill" style="background:#56565c">IT + IT Sysadmin {ico('chev', 12)}</div>
      <div class="pill" style="background:#56565c">{ico('chevr', 12)}</div>
    </div>
  </div>
  <div style="display:flex;gap:12px;padding:2px 12px 6px;align-items:center">
    <span style="width:16px"></span><span style="width:118px"></span>
    <div class="dim small" style="position:relative;width:{int(W)}px;height:14px">{ticks}</div>
  </div>
  {row('Anna Reuter', [seg('08:18','13:29',GREEN), seg('13:29','14:18',ORANGE), seg('14:18','17:58',GREEN,open_=True)], '4 h 12', GREEN)}
  {row('Georg Vollmer', [seg('09:13','13:09',GREEN), seg('13:09','13:59',ORANGE), seg('13:59','17:58',GREEN,open_=True)], '3 h 58', GREEN, hover=True)}
  {row('Lena Brandt', [seg('10:07','16:11',GREEN), seg('16:11','17:40',ORANGE), seg('17:40','17:58',GREEN,open_=True)], '6 h 04', GREEN, icon='house')}
  {row('Tanja Kühn', [seg('08:48','12:55',GREEN), seg('12:55','13:08',ORANGE), seg('13:08','16:21',GREEN), seg('16:21','17:58',ORANGE,open_=True)], 'Pause', ORANGE, icon='coffee')}
  {row('Celine Weber', [seg('05:27','08:04','rgba(255,255,255,.35)'), seg('08:04','08:33','rgba(255,255,255,.18)'), seg('08:33','11:56','rgba(255,255,255,.35)')], '6 h 00', GREY)}
  {row('Michael Sauer', [seg('08:02','12:30','rgba(255,255,255,.35)'), seg('12:30','13:15','rgba(255,255,255,.18)'), seg('13:15','16:30','rgba(255,255,255,.35)')], '7 h 43', GREY, icon='house')}
  {row('Daniel Kaminski', [seg('06:00','19:00','',hatched=True)], 'Urlaub', None, icon='case')}
  {row('Mira Jendt', [seg('06:00','19:00','',hatched=True)], 'Krank', None, icon='plus')}
  {row('Alexander Steiner', [], 'HO geplant', None, icon='house')}
  <div class="sep"></div>
  <div style="display:flex;gap:16px;padding:4px 12px 8px" class="dim small">
    <span style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:{GREEN};width:8px;height:8px"></span>Arbeit</span>
    <span style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:{ORANGE};width:8px;height:8px"></span>Pause</span>
    <span style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:rgba(255,255,255,.35);width:8px;height:8px"></span>beendet</span>
    <span style="display:flex;align-items:center;gap:6px"><span style="width:1.5px;height:10px;background:#fff;opacity:.7"></span>jetzt 17:58</span>
    <span style="margin-left:auto;display:flex;align-items:center;gap:6px">{ico('gear', 14)} {ico('ext', 14)}</span>
  </div>
</div>
<p class="dim small" style="margin:18px 0 0;max-width:520px;text-align:center;line-height:1.45">Tagesleiste je Person: Arbeits- und Pausensegmente aus der API, offenes Segment läuft bis „jetzt" aus. Pfeile blättern in vergangene Tage. Am meisten Information, aber ~570 px breit und optisch dichter.</p>
</div>'''
    return page('Option C · Tagesleiste', body)


# --------------------------------------------------------------------------- Panel-Varianten
def panel_variants():
    def indicator(inner, checked=False):
        bg = 'rgba(255,255,255,.28)' if checked else 'transparent'
        return f'<div style="display:flex;align-items:center;gap:6px;height:26px;padding:0 12px;border-radius:999px;background:{bg};font-weight:700">{inner}</div>'

    def strip(variant_inner, caption, checked=False):
        sysicons = ''.join(ico(n) for n in ('wifi', 'vol', 'bat'))
        return f'''<div style="display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:center;justify-content:flex-end;gap:2px;height:32px;background:#000;padding:0 8px;border-radius:0 0 0 0;width:560px">
    <div style="display:flex;align-items:center;gap:6px;height:26px;padding:0 12px;border-radius:999px;font-weight:700">2. Sep  17:58</div>
    <div style="flex:1"></div>
    {indicator(variant_inner, checked)}
    <div style="display:flex;align-items:center;gap:8px;height:26px;padding:0 12px;border-radius:999px">{sysicons}{ico('power')}</div>
  </div>
  <span class="dim small" style="padding-left:2px">{caption}</span>
</div>'''

    dot = lambda c: f'<span class="dot" style="width:7px;height:7px;background:{c}"></span>'
    body = f'''<div style="width:1160px;padding:24px 24px 32px;display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:28px 32px">
  {strip(ico('people'), '1 · Nur Symbol. Unauffällig, keine Information ohne Klick.')}
  {strip(ico('people') + '<span>4</span>', '2 · Symbol + Anzahl anwesend (gefilterte Abteilungen).')}
  {strip(ico('people') + '<span>3</span>' + f'<span style="width:1px;height:12px;background:rgba(255,255,255,.3)"></span>' + ico('coffee') + '<span>1</span>', '3 · Anwesend + in Pause getrennt. Zeigt „kommt wieder" auf einen Blick.')}
  {strip(ico('people') + f'<span style="display:flex;gap:3px;align-items:center">{dot(GREEN)}{dot(GREEN)}{dot(GREEN)}{dot(ORANGE)}{dot("rgba(255,255,255,.3)")}{dot("rgba(255,255,255,.3)")}</span>', '4 · Ein Punkt pro Person der Abteilung, Farbe = Status. Breiter, dafür „Ampel" ohne Zahlen.')}
  {strip(ico('people') + '<span>4</span>', '5 · Zustand geöffnet (checked): heller Hintergrund wie bei Shell-Indikatoren.', checked=True)}
  {strip('<span class="dot" style="width:10px;height:10px;background:' + GREEN + '"></span><span>3 · ARe GVo LBr</span>', '6 · Kürzel der Anwesenden. Nur sinnvoll bei ≤ 4 Personen, sonst abschneiden.')}
</div>'''
    return page('Panel-Indikator', body)


# --------------------------------------------------------------------------- Einstellungen (libadwaita)
def prefs():
    ADW = '''
.win { background: #242424; border-radius: 15px; box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 8px 24px rgba(0,0,0,.45); color: #ffffff; overflow: hidden; display:flex; flex-direction:column; }
.hbar { display:flex; align-items:center; justify-content:space-between; padding: 6px 6px; min-height: 47px; }
.wbtn { width: 24px; height: 24px; border-radius: 999px; background: rgba(255,255,255,.1); display:flex; align-items:center; justify-content:center; }
.switcher { display:flex; gap: 0; background: rgba(255,255,255,.08); border-radius: 8px; padding: 0; }
.switcher span { padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 13.33px; display:flex; align-items:center; gap: 6px; }
.switcher .on { background: rgba(255,255,255,.18); }
.grp-title { font-weight: 700; font-size: 14.67px; margin: 0 0 6px; }
.grp-desc { color: rgba(255,255,255,.55); font-size: 13.33px; margin: -2px 0 8px; }
.list { background: rgba(255,255,255,.08); border-radius: 12px; overflow: hidden; display:flex; flex-direction:column; }
.row { display:flex; align-items:center; gap: 12px; padding: 12px 12px 12px 14px; min-height: 26px; }
.row + .row { border-top: 1px solid rgba(255,255,255,.08); }
.row .t { display:flex; flex-direction:column; gap: 1px; flex:1; min-width:0; }
.row .s { color: rgba(255,255,255,.55); font-size: 12.5px; }
.sw { width: 44px; height: 26px; border-radius: 999px; background: rgba(255,255,255,.18); position: relative; flex:none; }
.sw::after { content:""; position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:999px; background:#fff; }
.sw.on { background: #3584e4; } .sw.on::after { left: 21px; }
.entry { background: rgba(255,255,255,.08); border-radius: 6px; padding: 6px 10px; font-size: 13.33px; min-width: 200px; }
.tag { background: rgba(255,255,255,.1); border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
'''
    def dept(name, n, on):
        return f'<div class="row"><div class="t"><span>{name}</span><span class="s">{n} Personen</span></div><div class="sw{" on" if on else ""}"></div></div>'

    depts = [('IT', 15, True), ('IT Systemadministration', 4, True), ('Debitorenmanagement', 16, False), ('Finance', 9, False),
             ('Geschäftsleitung', 4, False), ('Kanzlei', 7, False), ('Kundenbetreuung / Erfassung', 12, False), ('Marketing / Vertrieb', 8, False), ('Stab', 6, False)]
    body = f'''<div style="width:700px;padding:24px;display:flex;justify-content:center">
<div class="win" style="width:640px;height:720px">
  <div class="hbar">
    <div style="width:24px"></div>
    <div class="switcher">
      <span>{ico('key', 14)}Konto</span><span class="on">{ico('people', 14)}Personen</span>
    </div>
    <div class="wbtn"><svg class="ico" viewBox="0 0 16 16" width="12" height="12" style="stroke-width:2"><path d="M4 4l8 8M12 4l-8 8"/></svg></div>
  </div>
  <div style="flex:1;overflow:hidden;padding:12px 36px 24px;display:flex;flex-direction:column;gap:22px">
    <div>
      <p class="grp-title">Abteilungen</p>
      <p class="grp-desc">Nur Personen aus eingeschalteten Abteilungen erscheinen im Panel-Menü. Die Liste kommt aus PointChamp.</p>
      <div class="list">
        {''.join(dept(*d) for d in depts[:5])}
        <div class="row" style="justify-content:center;color:rgba(255,255,255,.55);font-size:13px">{ico('chev', 14)} 4 weitere</div>
      </div>
    </div>
    <div>
      <p class="grp-title">Einzelne Personen</p>
      <p class="grp-desc">Zusätzlich anzeigen oder trotz Abteilung ausblenden.</p>
      <div class="list">
        <div class="row"><div class="t"><span>Immer anzeigen</span><span class="s">Sandra Meyer (Finance), Peter Krug (Stab)</span></div>{ico('chevr', 14, 'rgba(255,255,255,.55)')}</div>
        <div class="row"><div class="t"><span>Ausblenden</span><span class="s">Entwickler IT (Service-Konto)</span></div>{ico('chevr', 14, 'rgba(255,255,255,.55)')}</div>
      </div>
    </div>
  </div>
</div>
</div>'''
    return page('Einstellungen', body, extra_css=ADW)


def prefs_account():
    ADW = prefs.__doc__ or ''
    # gleiche Stile wie prefs(): einfach kopieren
    import re
    src = Path(__file__).read_text()
    adw_css = re.search(r"ADW = '''(.*?)'''", src, re.S).group(1)
    body = f'''<div style="width:700px;padding:24px;display:flex;justify-content:center">
<div class="win" style="width:640px;height:720px">
  <div class="hbar">
    <div style="width:24px"></div>
    <div class="switcher">
      <span class="on">{ico('key', 14)}Konto</span><span>{ico('people', 14)}Personen</span>
    </div>
    <div class="wbtn"><svg class="ico" viewBox="0 0 16 16" width="12" height="12" style="stroke-width:2"><path d="M4 4l8 8M12 4l-8 8"/></svg></div>
  </div>
  <div style="flex:1;overflow:hidden;padding:12px 36px 24px;display:flex;flex-direction:column;gap:22px">
    <div>
      <p class="grp-title">PointChamp-Zugang</p>
      <p class="grp-desc">Das Passwort wird im GNOME-Schlüsselbund gespeichert, nicht in den Einstellungen.</p>
      <div class="list">
        <div class="row"><div class="t"><span>Server</span></div><span class="entry">https://dvs.pointchamp.app</span></div>
        <div class="row"><div class="t"><span>Benutzername</span></div><span class="entry">vorname.nachname@dvs.ag</span></div>
        <div class="row"><div class="t"><span>Passwort</span></div><span class="entry">••••••••••••</span></div>
        <div class="row"><div class="t"><span>Verbindung</span><span class="s">Zuletzt erfolgreich 17:58 · Token gültig bis 18:54</span></div><span class="tag" style="color:{GREEN}">Verbunden</span></div>
      </div>
    </div>
    <div>
      <p class="grp-title">Aktualisierung</p>
      <div class="list">
        <div class="row"><div class="t"><span>Intervall</span><span class="s">Die Web-Live-Ansicht lädt alle 30 s</span></div><span class="entry" style="min-width:auto">60 s</span></div>
        <div class="row"><div class="t"><span>Nur bei aktiver Sitzung abfragen</span><span class="s">Pausiert bei gesperrtem Bildschirm</span></div><div class="sw on"></div></div>
      </div>
    </div>
    <div>
      <p class="grp-title">Anzeige</p>
      <div class="list">
        <div class="row"><div class="t"><span>Zähler im Panel</span><span class="s">Anzahl anwesender Personen neben dem Symbol</span></div><div class="sw on"></div></div>
        <div class="row"><div class="t"><span>Heute Beendete anzeigen</span></div><div class="sw on"></div></div>
        <div class="row"><div class="t"><span>Abwesende anzeigen</span><span class="s">Urlaub, Krankheit, Elternzeit, Freistellung</span></div><div class="sw on"></div></div>
      </div>
    </div>
  </div>
</div>
</div>'''
    return page('Einstellungen · Konto', body, extra_css=adw_css)


FILES = {
    'Main.dc.html': option_a,
    'OptionB.dc.html': option_b,
    'OptionC.dc.html': option_c,
    'Panel.dc.html': panel_variants,
    'Einstellungen.dc.html': prefs,
    'EinstellungenKonto.dc.html': prefs_account,
}

if __name__ == '__main__':
    for name, fn in FILES.items():
        (HERE / name).write_text(fn())
        print('geschrieben', name)
