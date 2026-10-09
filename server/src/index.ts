import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from './repository.ts';
import { start } from './app.ts';
import { chainServiceFromEnvironment } from './chain-service.ts';
import { parseTrustedProxies } from './request-policy.ts';

export { Repository, createApp, start } from './public.ts';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.env.PIXELPETS_DB ?? fileURLToPath(new URL('../../runtime/pets.sqlite', import.meta.url));
  const network = process.env.CHAIN_NETWORK ?? 'devnet';
  if (network !== 'localnet' && network !== 'devnet' && network !== 'mainnet-beta') throw new Error('Unsupported CHAIN_NETWORK');
  // No implicit loopback trust: desktop Godot and local health checks call the API directly.
  const trustedProxies = parseTrustedProxies(process.env.TRUSTED_PROXY_IPS);
  const repository = new Repository(path, { publicOrigin: process.env.PUBLIC_ORIGIN, network });
  const chainService = chainServiceFromEnvironment(repository);
  const server = await start({ repository, chainService, trustedProxies, port: Number(process.env.PORT ?? 9782), host: process.env.HOST ?? '127.0.0.1' });
  console.log(`PixelPets API ready on port ${(server.address() as { port: number }).port}; chain ${chainService.configuration ? 'configured; deployment is verified before use' : 'disabled'}.`);
  const stop = (): void => { server.close(() => { repository.close(); process.exit(0); }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
