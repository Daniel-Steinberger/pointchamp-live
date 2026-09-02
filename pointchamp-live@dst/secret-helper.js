#!/usr/bin/env -S gjs -m
// Holt das PointChamp-Passwort aus dem Schlüsselbund und gibt es auf stdout aus.
// Läuft als eigener Prozess, damit libsecret/libgcr nie im Shell-Prozess laufen.
// Aufruf: gjs -m secret-helper.js lookup <server> <username>
// Exit-Codes: 0 gefunden, 2 nicht gefunden, 1 Fehler.
import Secret from 'gi://Secret';
import GLib from 'gi://GLib';
import {SECRET_SCHEMA} from './secret.js';

const [cmd, server, username] = ARGV;
if (cmd !== 'lookup' || !server || !username) {
    printerr('Aufruf: secret-helper.js lookup <server> <username>');
    imports.system.exit(1);
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 1;
Secret.password_lookup(SECRET_SCHEMA, {server, username}, null, (_src, res) => {
    try {
        const pw = Secret.password_lookup_finish(res);
        if (pw) {
            print(pw);
            exitCode = 0;
        } else {
            exitCode = 2;
        }
    } catch (e) {
        printerr(e.message);
        exitCode = 1;
    }
    loop.quit();
});
// Sicherheitsnetz, falls der Schlüsselbund nicht antwortet
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
    printerr('Zeitüberschreitung beim Schlüsselbund');
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
imports.system.exit(exitCode);
