-- ============================================================================
-- 0064 — Validation des devis réservée à la Direction / administrateur,
--        resoumission d'un devis renvoyé
-- ============================================================================
--
-- Complète 0063 sur deux points actés avec la direction :
--
-- 1. HABILITATION. En 0063, toute personne ayant une signature active pouvait
--    valider — y compris un commercial, puisque la signature est autorisée
--    pour les comptes commercial. Or le circuit voulu est : le commercial
--    établit, la DIRECTION valide. is_quote_validator() exige donc désormais
--    la signature active ET le base_role `administrateur` (app_users.role),
--    c'est-à-dire l'administrateur et la Direction (rôle dérivé, 0027). La
--    signature reste nécessaire : c'est elle qui est apposée sur le PDF.
--    Les signatures existantes de commerciaux ne sont pas supprimées ; elles
--    ne permettent simplement plus de valider.
--
-- 2. RESOUMISSION. Un devis renvoyé repasse en « brouillon » avec un motif
--    (0063). Le commercial le corrige puis le resoumet (brouillon →
--    en_validation_interne, transition déjà admise par le trigger de 0063).
--    La trace est posée dans status_history par l'application ; le motif du
--    dernier renvoi est conservé (rejet_motif), le validateur le voit donc
--    lors du nouvel examen.
--
-- Rien d'autre ne change : validate_quote(), reject_quote() et le trigger
-- guard_quote_validation() appellent is_quote_validator() et héritent de la
-- nouvelle règle sans être réécrits.
-- ============================================================================

create or replace function is_quote_validator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from document_signatories s
    join app_users u on u.id = s.user_id
    where s.user_id = auth.uid()
      and s.active
      and u.active
      and u.role = 'administrateur'
  );
$$;

comment on function is_quote_validator() is
  'Habilité à valider/renvoyer un devis : signature active ET base_role administrateur (administrateur ou Direction). Un commercial, même signataire, ne valide pas.';

revoke all on function is_quote_validator() from public, anon;
grant execute on function is_quote_validator() to authenticated;
