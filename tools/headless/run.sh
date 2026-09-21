#!/bin/bash
# Headless GNOME Shell mit isolierten GSettings starten, Erweiterung laden, Beispieldaten
# injizieren, Screenshots von Menü und Einstellungen aufnehmen. Berührt die laufende Sitzung nicht.
# Aufruf: dbus-run-session -- tools/headless/run.sh [ausgabeverzeichnis]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-/tmp/pointchamp-headless}
mkdir -p "$OUT/config"
export GSETTINGS_BACKEND=keyfile
export XDG_CONFIG_HOME=$OUT/config
SCHEMAS=$HERE/../../pointchamp-live@dst/schemas
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['pointchamp-live@dst']"
gsettings --schemadir "$SCHEMAS" set org.gnome.shell.extensions.pointchamp-live username 'test@example.org'
gsettings --schemadir "$SCHEMAS" set org.gnome.shell.extensions.pointchamp-live approvals-enabled true
gnome-shell --headless --wayland --virtual-monitor 1280x800 --unsafe-mode > "$OUT/shell.log" 2>&1 &
SHELL_PID=$!
for _ in $(seq 1 40); do
  sleep 1
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Properties.Get org.gnome.Shell ShellVersion >/dev/null 2>&1 && break
done
sleep 5
echo "--- Extension-Status:"; gnome-extensions info pointchamp-live@dst 2>&1 | grep -E "State|rror" || true
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$(cat "$HERE/inject.js")" | head -c 300; echo
sleep 4
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/menu.png" | head -c 200; echo
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "import('resource:///org/gnome/shell/ui/main.js').then(({panel}) => panel.statusArea['pointchamp-live@dst'].menu.close())" >/dev/null
gnome-extensions prefs pointchamp-live@dst &
sleep 6
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/prefs.png" | head -c 200; echo
sleep 10
kill $SHELL_PID; wait $SHELL_PID 2>/dev/null
echo "--- Shell-Log (relevant):"
grep -iE "pointchamp|JS ERROR|TypeError|ReferenceError" "$OUT/shell.log" | grep -v "Zugangsdaten\|Schlüsselbund" | head -20
