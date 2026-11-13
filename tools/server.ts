/**
 * Lance le serveur de parties à deux joueurs.
 *
 *   pnpm serve                 écoute sur cette seule machine (ws://127.0.0.1:3211)
 *   pnpm serve --lan           écoute sur le réseau local
 *   pnpm serve --port 4000     autre port
 */
import { networkInterfaces } from 'node:os';
import { startServer } from './net-server';

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const port = Number(valueOf('--port') ?? 3211);
const lan = args.includes('--lan');
const host = valueOf('--host') ?? (lan ? '0.0.0.0' : '127.0.0.1');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port invalide : indiquez un entier entre 1 et 65535.');
  process.exit(1);
}

startServer({ port, host })
  .then((server) => {
    console.log(`Serveur de parties WAR COMMAND à l’écoute : ws://${host === '0.0.0.0' ? 'localhost' : host}:${server.port}`);
    if (host === '0.0.0.0') {
      const addresses = Object.values(networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal)
        .map((a) => `ws://${a!.address}:${server.port}`);
      console.log(addresses.length > 0 ? `Sur le réseau local : ${addresses.join(' · ')}` : 'Aucune adresse de réseau local trouvée.');
    } else {
      console.log('Cette machine seulement. Pour jouer sur le réseau local : pnpm serve --lan');
    }
    console.log('Arrêt : Ctrl+C.');
  })
  .catch((error: unknown) => {
    console.error(`Le serveur n’a pas pu démarrer : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
