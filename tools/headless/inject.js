// Wird per org.gnome.Shell.Eval in die headless Shell geladen: fiktive Tagesdaten, Tags, Anträge
// und Zeitkategorien in den Indicator legen und das Menü öffnen. Namen sind erfunden.
import('resource:///org/gnome/shell/ui/main.js').then(({panel}) => {
  const GLib = imports.gi.GLib;
  const ind = panel.statusArea['pointchamp-live@dst'];
  if (!ind) { console.error('[pointchamp-test] Indicator fehlt'); return; }
  const today = GLib.DateTime.new_now_local().format('%Y-%m-%d');
  const now = GLib.DateTime.new_now_local();
  const nowS = now.format('%H:%M:%S');
  const d = (start, detail) => ({[today]: {date: today, start, end: '', detail: [detail]}});
  const tracking = [
    {id:1, name:'Anna Reuter', department:'IT', days: d('08:18:45', [{id:901,start:'08:18:45',end:'13:29:47',break:false,minutes:311},{id:911,start:'13:29:47',end:'14:18:33',break:true,minutes:49},{id:902,start:'14:18:33',end:nowS,break:false,minutes:null}])},
    {id:2, name:'Georg  Vollmer', department:'IT', days: d('09:13:47', [{id:921,start:'09:13:47',end:'13:09:44',break:false,minutes:236},{id:922,start:'13:09:44',end:'13:59:31',break:true,minutes:50},{id:923,start:'13:59:31',end:nowS,break:false,minutes:null}])},
    {id:3, name:'Lena Brandt', department:'IT Systemadministration', days: d('10:07:55', [{id:903,start:'10:07:55',end:'16:11:51',break:false,minutes:364},{id:931,start:'16:11:51',end:'17:40:03',break:true,minutes:89},{id:904,start:'17:40:03',end:nowS,break:false,minutes:null}])},
    {id:4, name:'Tanja Kühn', department:'IT', days: d('08:48:08', [{id:941,start:'08:48:08',end:'12:55:00',break:false,minutes:247},{id:942,start:'12:55:00',end:'13:08:00',break:true,minutes:13},{id:943,start:'13:08:00',end:'16:21:57',break:false,minutes:193},{id:944,start:'16:21:57',end:nowS,break:true,minutes:null}])},
    {id:5, name:'Celine Weber', department:'IT', days: d('05:27:39', [{id:951,start:'05:27:39',end:'08:04:00',break:false,minutes:157},{id:952,start:'08:04:00',end:'08:33:00',break:true,minutes:29},{id:953,start:'08:33:00',end:'11:56:43',break:false,minutes:203},{id:954,start:'11:56:43',end:'12:25:43',break:true,minutes:-29}])},
    {id:6, name:'Michael Sauer', department:'IT Systemadministration', days: d('08:02:00', [{id:905,start:'08:02:00',end:'12:30:00',break:false,minutes:268},{id:961,start:'12:30:00',end:'13:15:00',break:true,minutes:45},{id:906,start:'13:15:00',end:'16:30:00',break:false,minutes:195}])},
    {id:7, name:'Daniel Kaminski', department:'IT', days: []},
    {id:8, name:'Mira Jendt', department:'IT', days: []},
    {id:9, name:'Alexander Steiner', department:'IT', days: []},
    {id:10, name:'Entwickler IT', department:'IT', days: []},
    {id:11, name:'Sabine Fern', department:'Finance', days: []},
  ];
  const de = now.format('%d.%m.%Y');
  const plus = n => now.add_days(n).format('%d.%m.%Y');
  const absences = [
    {id:1, name:'Daniel Kaminski', von:de, bis:plus(2), art:'Urlaub'},
    {id:5, name:'Daniel Kaminski', von:plus(5), bis:plus(6), art:'Resturlaub'},
    {id:2, name:'Mira Jendt', von:de, bis:de, art:'Krankheit'},
    {id:3, name:'Alexander Steiner', von:de, bis:de, art:'Homeoffice*'},
    {id:4, name:'Michael Sauer', von:de, bis:de, art:'Homeoffice*'},
  ];
  ind._settings.set_value('person-tags', new GLib.Variant('a{sas}', {'Anna Reuter': ['Bestand'], 'Georg Vollmer': ['medVS', 'StBVS'], 'Lena Brandt': ['StBVS'], 'Celine Weber': ['Bestand']}));
  ind._settings.set_strv('known-persons', tracking.map(p => p.name.replace(/\s+/g, ' ') + '\t' + p.department));
  ind._settings.set_strv('departments', ['IT', 'IT Systemadministration']);
  ind._cache.set(today, {tracking, absences, fetchedAt: GLib.get_monotonic_time()/1e6, wallClock: now});
  ind._lastError = null;
  ind._requests = [
    {id:'1500', kind:'holiday', name:'Max Muster', department:'IT', from:plus(7), to:plus(11), days:'5', type:'Urlaub'},
    {id:'77', kind:'absence', name:'Erika Beispiel', department:'IT Systemadministration', from:plus(1), to:plus(1), time:'09:00–17:00', days:'1', type:'Freizeitausgleich'},
  ];
  if (ind._updateDot) { ind._updateDot(); ind._renderRequests(); }
  if (ind._catCache) for (const [id, c] of [[901,null],[902,'Homeoffice'],[903,'Homeoffice'],[904,'Unterwegs'],[905,'Homeoffice'],[906,'Office'],[921,'Office'],[923,'Office']]) ind._catCache.set(id, c);
  console.log('[pointchamp-test] Punkt sichtbar=' + ind._dot.visible + ' bevorzugte Breite=' + ind._dot.get_preferred_width(-1));
  ind._render();
  ind.menu.open();
}).catch(e => console.error('[pointchamp-test] ' + e));
