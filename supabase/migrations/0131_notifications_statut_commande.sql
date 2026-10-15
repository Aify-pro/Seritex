-- ============================================================================
-- Seritex — Notifications par statut de commande (ordre de fabrication)
-- ============================================================================
--
-- Suite de 0129 (destinataires configurables + file d'attente). Chaque changement de
-- statut d'un ordre de fabrication (ODF) peut maintenant prévenir les personnes de
-- votre choix, réglées dans Paramètres > Notifications :
--
--   odf_en_attente_validation · odf_refusee · odf_en_production ·
--   odf_demande_cloture · odf_terminee · odf_annulee
--
-- Le déclencheur est dans la base : l'événement part quelle que soit l'origine du
-- changement (atelier, plateforme, script), sans doublon avec les e-mails client
-- existants (« commande_en_impression », « commande_terminee », qui prévient le
-- CLIENT et restent inchangés).
--
-- Tous les événements sont créés DÉSACTIVÉS et sans destinataire : rien ne part tant
-- qu'on ne l'a pas activé et qu'on n'a pas choisi qui le reçoit. Un événement
-- désactivé n'entre même pas dans la file.
-- ============================================================================

create or replace function notification_odf_statut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  v_key := case new.status::text
    when 'en_attente_validation' then 'odf_en_attente_validation'
    when 'refuse' then 'odf_refusee'
    when 'en_production' then 'odf_en_production'
    when 'demande_cloture' then 'odf_demande_cloture'
    when 'terminee' then 'odf_terminee'
    when 'annulee' then 'odf_annulee'
    else null
  end;
  if v_key is null then
    return new;
  end if;
  -- Événement désactivé (ou inconnu) : on ne remplit pas la file pour rien.
  if not exists (select 1 from notification_events where event_key = v_key and enabled) then
    return new;
  end if;
  insert into notification_outbox (event_key, entity_type, entity_id, payload)
  values (v_key, 'production_order', new.id,
          jsonb_build_object('production_order_id', new.id, 'ancien_statut', old.status::text, 'nouveau_statut', new.status::text));
  return new;
end;
$$;

create trigger production_orders_notifier_statut
  after update of status on production_orders
  for each row
  when (new.status is distinct from old.status)
  execute function notification_odf_statut();

insert into notification_events (event_key, label, description, category, enabled, subject_template, body_template, available_variables) values
(
  'odf_en_attente_validation',
  'Commande : en attente de validation',
  'Déclenché par la base quand un ordre de fabrication passe à « en attente de validation » (configuré, à valider avant lancement).',
  'commande', false,
  'Commande {{numero_odf}} — en attente de validation',
  '<p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}, {{quantite}} pièces) est <strong>en attente de validation</strong>.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
),
(
  'odf_refusee',
  'Commande : refusée',
  'Déclenché par la base quand un ordre de fabrication est refusé (à corriger avant relance).',
  'commande', false,
  'Commande {{numero_odf}} — refusée',
  '<p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}, {{quantite}} pièces) a été <strong>refusé</strong>.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
),
(
  'odf_en_production',
  'Commande : lancée en production',
  'Déclenché par la base quand un ordre de fabrication passe « en production ».',
  'commande', false,
  'Commande {{numero_odf}} — lancée en production',
  '<p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}, {{quantite}} pièces) est <strong>lancé en production</strong>.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
),
(
  'odf_demande_cloture',
  'Commande : demande de clôture',
  'Déclenché par la base quand la clôture d''un ordre de fabrication est demandée (à valider).',
  'commande', false,
  'Commande {{numero_odf}} — demande de clôture',
  '<p>Bonjour,</p><p>La clôture de l''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}) a été <strong>demandée</strong> : elle attend votre validation.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
),
(
  'odf_terminee',
  'Commande : terminée',
  'Déclenché par la base quand un ordre de fabrication est terminé. Distinct de « Commande terminée » (e-mail au client).',
  'commande', false,
  'Commande {{numero_odf}} — terminée',
  '<p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}, {{quantite}} pièces) est <strong>terminé</strong>.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
),
(
  'odf_annulee',
  'Commande : annulée',
  'Déclenché par la base quand un ordre de fabrication est annulé.',
  'commande', false,
  'Commande {{numero_odf}} — annulée',
  '<p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}, {{quantite}} pièces) a été <strong>annulé</strong>.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
)
on conflict (event_key) do nothing;
