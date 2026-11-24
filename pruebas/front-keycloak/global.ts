import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compose, ORIGEN } from './entorno.js';
export default async function preparar() {
  const carpeta = await mkdtemp(join(tmpdir(), 'm2-front-keycloak-'));
  const override = join(carpeta, 'compose.yml');
  const cerrar = async () => { try { await compose(['down', '-v', '--remove-orphans'], override); } finally { await rm(carpeta, { recursive: true, force: true }); } };
  try {
    // El runner y Keycloak pueden tener UID distintos: el realm no contiene secretos de producción.
    await chmod(carpeta, 0o755);
    const realm = JSON.parse(await readFile(new URL('../../keycloak/ds-2026-realm-realm.json', import.meta.url), 'utf8'));
    const cliente = realm.clients.find((c: { clientId: string }) => c.clientId === 'm2-front');
    cliente.redirectUris = [`${ORIGEN}/auth/retorno`]; cliente.webOrigins = [ORIGEN];
    cliente.attributes['post.logout.redirect.uris'] = `${ORIGEN}/auth/salida`;
    // Access de 40 s permite probar refresh sin relajar claims. No se cambian permisos ni PKCE.
    realm.accessTokenLifespan = 40;
    const archivoRealm = join(carpeta, 'ds-2026-realm-realm.json');
    await writeFile(archivoRealm, JSON.stringify(realm));
    await chmod(archivoRealm, 0o644);
    await writeFile(override, `services:\n  keycloak:\n    volumes: !override\n      - ${JSON.stringify(carpeta.replaceAll('\\', '/') + ':/opt/keycloak/data/import:ro')}\n`);
    await compose(['down', '-v', '--remove-orphans'], override);
    await compose(['up', '-d', '--build', '--wait'], override);
    return cerrar;
  } catch (error) { await cerrar().catch(() => undefined); throw error; }
}
