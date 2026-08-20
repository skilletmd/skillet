import { buildServer, resolveTrustProxy } from './server.js';
import { warnPublicBindWithoutTrustProxy, resolveCorsOrigins } from './http-security.js';
import { assertNodeVersion } from './version-check.js';
import { assertMysqlSchemaReady } from './assert-mysql-schema.js';

// Fail fast with a clear message on an unsupported runtime.
assertNodeVersion();

const PORT = Number(process.env.PORT ?? 3481);
const HOST = process.env.HOST ?? '0.0.0.0';

const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
warnPublicBindWithoutTrustProxy(HOST, trustProxy, resolveCorsOrigins().length > 0);

// U2: live boot is Prisma/MySQL only (fail closed without DATABASE_URL).
const { app } = await buildServer({
  logger: true,
  trustProxy,
  usePrismaAuth: true,
});
// Refuse to listen when migrate deploy was skipped; keeps /api/hc from lying.
if (!app.skilletPrisma) {
  throw new Error('buildServer did not decorate skilletPrisma under usePrismaAuth');
}
await assertMysqlSchemaReady(app.skilletPrisma);
await app.listen({ port: PORT, host: HOST });
