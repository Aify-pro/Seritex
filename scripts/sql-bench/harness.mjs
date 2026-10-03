// Banc d'essai SQL : rejoue toutes les migrations du dépôt dans PGlite
// (Postgres compilé en WebAssembly, en mémoire) — aucune base distante n'est
// touchée. Sert à tester les fonctions et les contraintes de chaque lot avant
// le `supabase db push` (npm run test:sql).
//
// Le prélude remplace ce que Supabase fournit d'office : rôles anon /
// authenticated / service_role, auth.users et auth.uid() (lu dans le réglage
// request.jwt.claim.sub, comme PostgREST), et un schéma storage minimal.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");

export const PRELUDE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
-- Privilèges par défaut de Supabase sur le schéma public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
`;

export async function boot({ upTo = Infinity, quiet = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRELUDE);
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const n = parseInt(f.slice(0, 4), 10);
    if (n > upTo) break;
    // 0036 exige qu'une section « Coupe » existe déjà (vrai en production).
    if (n === 36) {
      await db.exec("insert into sections(name, display_order) values ('Coupe',1),('Sérigraphie',2),('Couture',3) on conflict do nothing;");
    }
    try {
      await db.exec(fs.readFileSync(path.join(DIR, f), "utf8"));
      if (!quiet) console.log("ok", f);
    } catch (e) {
      console.error("ÉCHEC", f, e.message, e.where ?? "");
      throw e;
    }
  }
  return db;
}

if (process.argv[1] && process.argv[1].endsWith("harness.mjs")) {
  await boot({ upTo: process.argv[2] ? parseInt(process.argv[2], 10) : Infinity });
}
