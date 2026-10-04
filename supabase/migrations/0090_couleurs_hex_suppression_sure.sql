-- ============================================================================
-- Seritex — Couleurs : aperçu en HEX, suppression sûre (Couleurs et tailles)
-- ============================================================================
--
-- 1. `colors.hex` : la couleur d'AFFICHAGE (pastille). `code` reste la
--    référence Pantone TCX. Reprise des HEX de la grille Excel V7 pour les 30
--    couleurs chargées par la 0089 ; pour les anciennes couleurs, le HEX qui
--    était saisi dans `code` ; « Blanc » (code 11-4001 TCX) = #FFFFFF.
-- 2. Suppression : plusieurs clés étrangères vers `colors` et `sizes` sont en
--    `on delete cascade` (disponibilités par modèle, dispatching, grilles de
--    prix par taille…) : un simple DELETE effacerait ces données en silence.
--    `reference_usage` (lecture) et `delete_color` / `delete_size` refusent donc
--    tout ce qui est encore référencé quelque part — la liste des clés
--    étrangères est lue dans le catalogue Postgres, elle reste juste quand une
--    nouvelle table référence une couleur ou une taille. Suppression réservée
--    à l'administrateur, comme la politique RLS existante.
-- ============================================================================

alter table colors
  add column if not exists hex text
  check (hex is null or hex ~* '^#[0-9a-f]{6}$');

comment on column colors.hex is
  'Couleur d''affichage (pastille), au format #RRGGBB. code = référence Pantone TCX, jamais utilisé pour l''affichage.';

update colors as c set hex = v.hex
from (values
  ('12-0643 TCX', '#F7E516'),
  ('12-0815 TCX', '#EFE7A5'),
  ('13-0759 TCX', '#F8C800'),
  ('14-0756 TCX', '#ECEC27'),
  ('14-0760 TCX', '#F6D600'),
  ('14-2311 TCX', '#E7C7E5'),
  ('15-1062 TCX', '#F5A000'),
  ('15-1114 TCX', '#D8D0AE'),
  ('15-4304 TCX', '#AEB7B9'),
  ('15-4323 TCX', '#8ACEE1'),
  ('16-1358 TCX', '#F28722'),
  ('16-4529 TCX', '#39B9D1'),
  ('16-5123 TCX', '#00C9C7'),
  ('17-4540 TCX', '#139CC2'),
  ('18-4006 TCX', '#565A5C'),
  ('18-4148 TCX', '#334BFF'),
  ('18-5025 TCX', '#176451'),
  ('18-6030 TCX', '#008C55'),
  ('19-1431 TCX', '#7A2A14'),
  ('19-1650 TCX', '#CF1D2D'),
  ('19-1763 TCX', '#E20B2A'),
  ('19-1955 TCX', '#C80048'),
  ('19-3336 TCX', '#6F2187'),
  ('19-3932 TCX', '#22396A'),
  ('19-3952 TCX', '#193A7A'),
  ('19-4150 TCX', '#1372C4'),
  ('19-4241 TCX', '#00618A'),
  ('19-5230 TCX', '#006154'),
  ('19-6050 TCX', '#00723F'),
  ('BLACK C', '#1E1E1E')
) as v(code, hex)
where c.code = v.code and c.hex is null;

update colors set hex = upper(code) where hex is null and code ~* '^#[0-9a-f]{6}$';
update colors set hex = '#FFFFFF' where hex is null and name = 'Blanc';

-- 2. Usage d'une couleur ou d'une taille ------------------------------------

create or replace function reference_usage(p_table regclass, p_id uuid)
returns table (ref_table text, nb bigint)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_val text;
  v_n bigint;
begin
  if not is_production_manager() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_table not in ('colors'::regclass, 'sizes'::regclass) then
    raise exception 'Table non prise en charge : %', p_table;
  end if;

  for r in
    select c.conrelid::regclass::text as tbl, a.attname as ref_col, fa.attname as target_col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
    where c.contype = 'f' and c.confrelid = p_table and array_length(c.conkey, 1) = 1
  loop
    execute format('select %I::text from %s where id = $1', r.target_col, p_table) into v_val using p_id;
    execute format('select count(*) from %s where %I::text = $1', r.tbl, r.ref_col) into v_n using v_val;
    if v_n > 0 then
      ref_table := r.tbl;
      nb := v_n;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function delete_color(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usage text;
begin
  if not is_admin() then
    raise exception 'Suppression réservée à l''administrateur' using errcode = '42501';
  end if;
  select string_agg(ref_table || ' (' || nb || ')', ', ') into v_usage from reference_usage('colors', p_id);
  if v_usage is not null then
    raise exception 'Couleur utilisée, suppression impossible : %', v_usage using errcode = 'P0001';
  end if;
  delete from colors where id = p_id;
end;
$$;

create or replace function delete_size(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_usage text;
begin
  if not is_admin() then
    raise exception 'Suppression réservée à l''administrateur' using errcode = '42501';
  end if;
  select string_agg(ref_table || ' (' || nb || ')', ', ') into v_usage from reference_usage('sizes', p_id);
  if v_usage is not null then
    raise exception 'Taille utilisée, suppression impossible : %', v_usage using errcode = 'P0001';
  end if;
  delete from sizes where id = p_id;
end;
$$;

revoke all on function reference_usage(regclass, uuid) from public, anon;
revoke all on function delete_color(uuid) from public, anon;
revoke all on function delete_size(uuid) from public, anon;
grant execute on function reference_usage(regclass, uuid) to authenticated;
grant execute on function delete_color(uuid) to authenticated;
grant execute on function delete_size(uuid) to authenticated;
