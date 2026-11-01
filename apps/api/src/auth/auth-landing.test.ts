import 'reflect-metadata';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { drizzle, type NodePgClient } from 'drizzle-orm/node-postgres';
import type { Database } from '@avicenna/db';
import type { ProcessGroup, RoleKind } from '@avicenna/contracts';
import { AuthService } from './auth.service';

async function main() {
  const password = 'test-only-ppic-password';
  const hash = await bcrypt.hash(password, 4);
  let kind: RoleKind = 'SCANNING';
  let group: ProcessGroup | null = 'DELIVERY';
  let active = true;
  const client = {
    async query() {
      return { rows: [[7, 'QA-PPIC', 'QA PPIC', hash, active, 1, 'operator_ppic', kind, group]] };
    },
  };
  const db = drizzle(client as unknown as NodePgClient) as unknown as Database;
  const jwt = new JwtService({ secret: 'test-only-ppic-landing-secret' });
  const auth = new AuthService(db, jwt);
  const result = await auth.login({ npk: 'QA-PPIC', password });
  assert.equal(result.user.landing, '/delivery-scan');
  const principal = jwt.verify(result.accessToken);
  assert.equal(principal.roleKind, 'SCANNING');
  assert.equal(principal.roleProcessGroup, 'DELIVERY');
  await assert.rejects(
    () => auth.login({ npk: 'QA-PPIC', password: 'incorrect-password' }),
    /NPK atau password salah/,
  );
  active = false;
  await assert.rejects(() => auth.login({ npk: 'QA-PPIC', password }), /NPK atau password salah/);
  active = true;
  group = null;
  assert.equal((await auth.login({ npk: 'QA-PPIC', password })).user.landing, '/scan');
  kind = 'ADMIN';
  assert.equal((await auth.login({ npk: 'QA-PPIC', password })).user.landing, '/dashboard');
  console.log('PPIC login landing and authentication regression checks passed');
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
