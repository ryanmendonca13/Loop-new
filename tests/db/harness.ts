import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '..', '..');
const BASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres';

export interface Db {
  pool: pg.Pool;
  name: string;
  close(): Promise<void>;
}

/** Creates an isolated database, applies the Supabase shim and every migration in order. */
export async function createTestDb(): Promise<Db> {
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  const name = `loop_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  const files = [
    join(ROOT, 'tests/db/supabase-shim.sql'),
    ...readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => join(ROOT, 'supabase/migrations', f)),
  ];
  for (const f of files) await pool.query(readFileSync(f, 'utf8'));
  return {
    pool,
    name,
    async close() {
      await pool.end();
      const a = new pg.Client({ connectionString: BASE_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export interface Actor {
  id: string | null;
  email?: string;
  aal?: 'aal1' | 'aal2';
  role?: 'authenticated' | 'anon' | 'service_role';
}

/** Runs fn inside a transaction as the given actor, exactly like PostgREST does (SET LOCAL ROLE + jwt claims). */
export async function as<T>(db: Db, actor: Actor, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query('begin');
    const role = actor.role ?? (actor.id ? 'authenticated' : 'anon');
    const claims = actor.id ? { sub: actor.id, role, email: actor.email, aal: actor.aal ?? 'aal1' } : { role };
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`set local role ${role}`);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Calls an RPC with named arguments, as an actor. */
export async function rpc<T = unknown>(db: Db, actor: Actor, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  return as(db, actor, async (c) => (await c.query(sql, keys.map((k) => args[k]))).rows[0]?.r as T);
}

export async function select<T = Record<string, unknown>>(db: Db, actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> {
  return as(db, actor, async (c) => (await c.query(sql, params)).rows as T[]);
}

export async function superuser<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.pool.query(sql, params)).rows as T[];
}

export async function expectLoopError(p: Promise<unknown>, code: string): Promise<string> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes(`LOOP:${code}:`)) throw new Error(`Expected LOOP:${code}, got: ${msg}`, { cause: e });
    return msg;
  }
  throw new Error(`Expected LOOP:${code} but call succeeded`);
}

export async function expectDenied(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (/permission denied|LOOP:(forbidden|not_found|unauthorized|account_not_active|consent_required)|row-level security/.test(msg)) return;
    throw new Error(`Expected denial, got: ${msg}`, { cause: e });
  }
  throw new Error('Expected denial but call succeeded');
}

export async function createAuthUser(db: Db, email: string, confirmed = true): Promise<Actor> {
  const rows = await superuser<{ id: string }>(db, `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`, [
    email,
    confirmed ? new Date().toISOString() : null,
  ]);
  return { id: rows[0]!.id, email };
}
