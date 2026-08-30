-- ============================================================================
-- Seritex — Suppression d'une fiche échantillon (module Échantillonnage,
-- refonte de l'affichage en liste)
-- Réf. : architecture/analyse-fonctionnelle-technique.md, section 3.6.
--
-- NUMÉROTATION : à fusionner avec attention si le chantier
-- `feat/rbac-crm-parametres-sage` (qui porte lui aussi un fichier
-- `0005_rbac_crm_parametres_sage.sql`, développé en parallèle et pas encore
-- fusionné dans `main` au moment de ce chantier) est intégré séparément —
-- l'un des deux fichiers "0005" devra être renommé "0006" pour préserver
-- l'ordre d'application. Sans lien fonctionnel entre les deux : celui-ci
-- n'a besoin d'aucune table ni fonction du chantier RBAC/CRM/Sage.
--
-- Principe : la RLS (0002_rls.sql) n'autorise aujourd'hui aucun DELETE sur
-- `sample_requests` (aucune policy `for delete`), donc un DELETE direct
-- échoue silencieusement (RLS bloque, 0 ligne affectée) plutôt que d'être
-- explicitement contrôlé. Comme pour les autres mutations sensibles du
-- schéma (acceptation de devis, décision sur échantillon, lien vers un
-- ordre de fabrication), la suppression passe par une fonction dédiée
-- SECURITY DEFINER : elle vérifie explicitement le rôle, refuse la
-- suppression d'une fiche encore attribuée à un ordre de fabrication (la
-- traçabilité essai ↔ commande doit rester intacte — cf. section 3.6), et
-- journalise l'action dans `audit_log` avant de supprimer (les tables
-- filles `sample_items`, `sample_feedback`, `sample_attachments`,
-- `sample_request_media_files` sont toutes en `on delete cascade`, donc un
-- simple DELETE sur `sample_requests` suffit à nettoyer l'historique lié).
-- ============================================================================

create or replace function delete_sample_request(p_sample_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not (is_commercial_or_above() or is_production_manager()) then
    raise exception 'accès refusé : rôle insuffisant pour supprimer une fiche échantillon';
  end if;

  if v_sr.production_order_id is not null then
    raise exception 'impossible de supprimer une fiche déjà attribuée à un ordre de fabrication — déliez-la d''abord';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delete_sample_request', 'sample_request', p_sample_request_id,
    jsonb_build_object('reference', v_sr.reference, 'sample_number', v_sr.sample_number)
  );

  delete from sample_requests where id = p_sample_request_id;
end;
$$;

-- Défense en profondeur identique au piège documenté lors du chantier
-- RBAC/CRM/Sage (30/08/2026) : sur ce projet Supabase, une nouvelle fonction
-- SECURITY DEFINER reçoit par défaut un droit EXECUTE accordé directement au
-- rôle `anon`, pas seulement via `public`. On révoque donc explicitement les
-- trois avant de ne réaccorder qu'au rôle `authenticated`.
revoke all on function delete_sample_request(uuid) from public, anon, authenticated;
grant execute on function delete_sample_request(uuid) to authenticated;
