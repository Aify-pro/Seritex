-- ============================================================================
-- 0115 — Lecture des demandes pilotée par la matrice
-- ============================================================================
-- Lot 6 sur 6. Qui VOIT les demandes dépendait de rôles codés en dur :
-- administrateur et commercial voyaient tout, l'infographiste les demandes à
-- visuel, la production seulement les demandes pour le stock.
--
--   1. « Voir » sur Demandes = voir les demandes des clients et du site.
--      « Voir » sur Demandes graphiques = voir celles qui demandent un visuel.
--      Les demandes pour le stock restent lisibles par tout le personnel.
--   2. Le droit « Voir » sur Demandes accordé à la production en 0106 ne servait
--      qu'à lui conserver le menu : il lui ouvrirait désormais toutes les
--      demandes clients. Il est retiré (état d'avant 0106) ; son menu passe par
--      « Voir » sur Demandes pour le stock (nouveau). Cochez « Voir » sur
--      Demandes si vous voulez que la production voie aussi les demandes clients.
--   3. Les transferts Sage (exports de stock) se lisent avec « Voir » sur la
--      gestion de stock ou sur l'avancement de production.
--
-- Volontairement inchangé : la lecture du stock Sage (stock_item_view).
-- ============================================================================

-- 1. Matrice ----------------------------------------------------------------
update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'demandes_stock'
  and r.base_role::text in ('commercial', 'responsable_production', 'administrateur');

update role_permissions rp
set can_view = false
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'demandes'
  and r.base_role::text = 'responsable_production';

-- 2. Règles de lecture --------------------------------------------------------
-- Remplacements littéraux ; une règle visée qui ne change pas fait échouer la
-- migration (jamais de no-op silencieux sur une règle de sécurité).
do $$
declare
  p record;
  v_new text;
begin
  for p in select * from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename = 'requests'
    and policyname in ('requests_select', 'requests_select_site') and coalesce(qual, '') not like '%has_permission(%'
  loop
    v_new := p.qual;
    v_new := replace(v_new,
      'is_admin() OR (current_role_name() = ''commercial''::user_role) OR ((current_role_name() = ''infographiste''::user_role) AND needs_graphics)',
      'has_permission(''demandes''::text, ''view''::text) OR (has_permission(''demandes_graphiques''::text, ''view''::text) AND needs_graphics)');
    v_new := replace(v_new, 'is_commercial_or_above()', 'has_permission(''demandes''::text, ''view''::text)');
    if v_new is not distinct from p.qual or v_new ~ 'is_admin\(\)|is_commercial_or_above\(\)|current_role_name\(\)' then
      raise exception 'lecture demandes : règle % non convertie : %', p.policyname, v_new;
    end if;
    execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_new);
  end loop;

  for p in select * from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename = 'sage_transfers'
    and policyname = 'sage_transfers_select' and coalesce(qual, '') not like '%has_permission(%'
  loop
    v_new := replace(p.qual,
      '(is_production_manager() OR (current_role_name() = ''commercial''::user_role))',
      '(has_permission(''stock_atelier''::text, ''view''::text) OR has_permission(''avancement_production''::text, ''view''::text))');
    if v_new is not distinct from p.qual then
      raise exception 'lecture transferts Sage : règle % non convertie', p.policyname;
    end if;
    execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_new);
  end loop;
end $$;
