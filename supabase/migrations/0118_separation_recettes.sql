-- ============================================================================
-- 0118 — Séparation des couleurs, lot 5 : recettes de réglages
-- ============================================================================
-- Les réglages avancés de l'outil (profil du moteur, écart de couleur,
-- lissage, trame AM / diffusion / Bayer, linéature, angles, résolution,
-- point minimum, recouvrement, sous-couche…) s'enregistrent sous un nom
-- (« Photo sur tee-shirt noir », « Logo 2 couleurs 43T »…) pour être
-- réappliqués d'un clic.
--
--   separation_recettes : nom (unique, sans tenir compte de la casse),
--   réglages (jsonb, validés par l'application), auteur. Lues par tout le
--   personnel ; créées par qui a accès à la séparation (« Voir » sur
--   Demandes graphiques) ou l'administrateur ; modifiées ou supprimées par
--   leur auteur ou l'administrateur.
-- ============================================================================

create table if not exists separation_recettes (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(btrim(nom)) between 1 and 80),
  reglages jsonb not null check (jsonb_typeof(reglages) = 'object'),
  created_by uuid references app_users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists separation_recettes_nom_unique on separation_recettes (lower(btrim(nom)));

comment on table separation_recettes is
  'Recettes de réglages de l''outil Séparation des couleurs (0118) : profil du moteur, trame, résolution, production. Réglages validés par l''application.';

alter table separation_recettes enable row level security;

drop policy if exists separation_recettes_select on separation_recettes;
create policy separation_recettes_select on separation_recettes for select using (is_staff());

drop policy if exists separation_recettes_insert on separation_recettes;
create policy separation_recettes_insert on separation_recettes for insert
  with check ((has_permission('demandes_graphiques', 'view') or is_admin()) and created_by = auth.uid());

drop policy if exists separation_recettes_update on separation_recettes;
create policy separation_recettes_update on separation_recettes for update
  using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

drop policy if exists separation_recettes_delete on separation_recettes;
create policy separation_recettes_delete on separation_recettes for delete
  using (created_by = auth.uid() or is_admin());

revoke all on separation_recettes from public, anon;
grant select, insert, update, delete on separation_recettes to authenticated;

drop trigger if exists trg_set_updated_at on separation_recettes;
create trigger trg_set_updated_at before update on separation_recettes for each row execute function set_updated_at();
