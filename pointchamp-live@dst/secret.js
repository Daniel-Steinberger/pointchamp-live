// libsecret-Zugriff. Darf NICHT aus extension.js importiert werden: libsecret/libgcr im
// Shell-Prozess hat beim Login einen Absturz (free(): invalid pointer in libgcr-4) verursacht.
// Die Shell nutzt stattdessen den Helfer-Prozess secret-helper.js.
import Secret from 'gi://Secret';

export const SECRET_SCHEMA = new Secret.Schema(
    'org.gnome.shell.extensions.pointchamp-live',
    Secret.SchemaFlags.NONE,
    {server: Secret.SchemaAttributeType.STRING, username: Secret.SchemaAttributeType.STRING});

export function lookupPassword(server, username) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(SECRET_SCHEMA, {server, username}, null, (_src, res) => {
            try {
                resolve(Secret.password_lookup_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function storePassword(server, username, password) {
    return new Promise((resolve, reject) => {
        Secret.password_store(SECRET_SCHEMA, {server, username}, Secret.COLLECTION_DEFAULT,
            `PointChamp Live (${username})`, password, null, (_src, res) => {
                try {
                    resolve(Secret.password_store_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}
