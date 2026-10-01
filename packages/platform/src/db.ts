import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = ReturnType<typeof getDb>;

const cache = new WeakMap<D1Database, ReturnType<typeof create>>();

function create(d1: D1Database) {
  return drizzle(d1, { schema });
}

export function getDb(d1: D1Database) {
  let db = cache.get(d1);
  if (!db) {
    db = create(d1);
    cache.set(d1, db);
  }
  return db;
}
