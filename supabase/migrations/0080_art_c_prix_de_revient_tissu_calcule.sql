-- ============================================================================
-- 0080 — ART-C : prix de revient dans la fiche article, tissu calculé
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot ART-C (A2, A6, A9).
--
--   1. model_size_fabric_area : surface de tissu consommée par pièce, par
--      taille (m²), issue de la fiche de placement ou du patronnage, et
--      modifiable.
--   2. model_cost_components.mode_calcul : le composant tissu peut devenir
--      CALCULÉ (A9) — coût = surface(taille) × (1 + perte) × grammage × prix
--      au kg du textile. Le coût du tissu suit donc le grammage de la
--      déclinaison sans saisir de grille par grammage.
--   3. Confidentialité (A2) : Direction et administrateur seulement, imposé
--      par la RLS (is_admin()), comme le reste de la tarification.
--
-- Rien n'est supprimé : un composant existant reste « saisi » (base +
-- suppléments), comportement inchangé.
-- ============================================================================

create table model_size_fabric_area (
  -- Clé propre plutôt que (modèle, taille) : une clé composite de deux clés
  -- étrangères ferait voir à PostgREST une relation plusieurs-à-plusieurs
  -- product_models ↔ sizes en plus de product_model_sizes, et rendrait
  -- ambigus les embarquements existants.
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade on delete cascade,
  surface_m2 numeric(8, 4) not null check (surface_m2 > 0 and surface_m2 < 20),
  source text not null default 'saisie' check (source in ('patronnage', 'placement', 'saisie')),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  constraint model_size_fabric_area_unique unique (product_model_id, taille)
);

comment on table model_size_fabric_area is
  'Surface de tissu consommée par pièce et par taille (m², chutes comprises si la source est la fiche de placement) — base du coût tissu calculé (A9). Direction et administrateur seulement.';

alter table model_cost_components
  add column if not exists mode_calcul text not null default 'saisi' check (mode_calcul in ('saisi', 'tissu_calcule')),
  add column if not exists perte_pct numeric(5, 2) not null default 0 check (perte_pct >= 0 and perte_pct < 100);

comment on column model_cost_components.mode_calcul is
  'saisi : base + suppléments par taille (V1). tissu_calcule (A9) : surface de la taille × (1 + perte %) × grammage du textile × prix au kg du textile — base et suppléments ignorés.';

alter table model_size_fabric_area enable row level security;
create policy model_size_fabric_area_select on model_size_fabric_area for select using (is_admin());
create policy model_size_fabric_area_insert on model_size_fabric_area for insert with check (is_admin());
create policy model_size_fabric_area_update on model_size_fabric_area for update using (is_admin()) with check (is_admin());
create policy model_size_fabric_area_delete on model_size_fabric_area for delete using (is_admin());
revoke all on model_size_fabric_area from public, anon;
grant select, insert, update, delete on model_size_fabric_area to authenticated;

-- Proposition de surface par pièce depuis les tracés de placement du modèle :
-- surface du matelas (longueur × laize) / pièces par couche, moyennée sur les
-- tracés renseignés. Même valeur pour toutes les tailles du tracé — une
-- estimation, à corriger taille par taille.
create or replace function propose_fabric_area_from_placement(p_model_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(avg(
           (tp.longueur_matelas_cm * tp.largeur_matelas_cm / 10000.0)
           / nullif((select sum(v::numeric) from jsonb_each_text(tp.repartition_par_couche) e(k, v)), 0)
         )::numeric, 4)
  from traces_placement tp
  join fiches_placement fp on fp.id = tp.fiche_id
  where fp.product_model_id = p_model_id
    and tp.longueur_matelas_cm > 0 and tp.largeur_matelas_cm > 0
    and is_admin();
$$;

revoke all on function propose_fabric_area_from_placement(uuid) from public, anon, authenticated;
grant execute on function propose_fabric_area_from_placement(uuid) to authenticated;
