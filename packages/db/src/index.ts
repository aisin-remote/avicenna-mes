export * as schema from './schema/index';
export * from './schema/index';
export { getDb, getPool, closeDb, type Database } from './client';

// Helper query Drizzle yang sering dipakai, di-reexport supaya app tidak perlu
// menambahkan drizzle-orm sebagai dependency langsung.
export {
  eq,
  ne,
  and,
  or,
  not,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  between,
  desc,
  asc,
  sql,
  count,
  sum,
  avg,
  max,
  min,
} from 'drizzle-orm';
