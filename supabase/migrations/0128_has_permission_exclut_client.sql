-- ============================================================================
-- 0128 — SÉCURITÉ : la matrice « Rôles & permissions » ne gouverne plus les comptes client
-- ============================================================================
-- PROBLÈME (trouvé en préparant l'espace client du site) : le rôle système
-- « client » porte des droits dans la matrice (demandes : voir + créer ; devis :
-- voir ; échantillons : voir + créer ; médiathèque : voir + créer). Or de
-- nombreuses règles de lecture/écriture testent `has_permission(...)` SANS
-- vérifier la société : requests_select, requests_select_site, quotes_select,
-- quote_lines_select, client_model_prices_select, quote_line_*_select,
-- requests_insert, sample_requests_insert, etc.
--
-- Conséquence : un compte « client » lisait les demandes et les devis de TOUTES
-- les sociétés (devis en brouillon compris, coordonnées des prospects du site,
-- prix mémorisés par client), et pouvait créer des demandes / échantillons au
-- nom d'une autre société. Tant qu'aucun portail client n'était ouvert, rien
-- n'était exposé ; mais depuis la 0125, toute personne qui crée un compte sur
-- www.seritex.ci reçoit un profil « client » (sans société) et peut interroger
-- l'API de la base avec sa session. À corriger sans attendre.
--
-- CORRECTIF : has_permission() renvoie FAUX pour un compte dont le rôle de base
-- est « client ». Les droits d'un client ne viennent plus que des branches
-- is_client_of(company_id) des règles, qui limitent à SA société (et, pour les
-- devis, aux devis déjà envoyés). Le personnel n'est pas touché.
--
-- À SAVOIR : la matrice reste affichée pour le rôle client mais n'a plus d'effet
-- en base. Le choix des modules visibles par les clients (chantier EC-5) passera
-- par un mécanisme dédié, jamais par has_permission.
-- ============================================================================

create or replace function has_permission(p_module_key text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        -- Un compte client n'a aucun droit « de personnel » : ses accès passent par is_client_of().
        when u.role = 'client' then false
        else case p_action
          when 'view' then rp.can_view
          when 'create' then rp.can_create
          when 'modify' then rp.can_modify
          when 'archive' then rp.can_archive
          when 'delete' then rp.can_delete
          when 'validate' then rp.can_validate
          when 'unlock' then rp.can_unlock
          else false
        end
      end
      from app_users u
      join role_permissions rp on rp.role_id = u.role_id
      join modules m on m.id = rp.module_id
      where u.id = auth.uid() and m.key = p_module_key
    ),
    false
  );
$$;

revoke all on function has_permission(text, text) from public, anon;
grant execute on function has_permission(text, text) to authenticated;
