-- ============================================================================
-- Seritex — Notifications : section Impression démarrée + ODF terminé
-- ============================================================================
-- Deuxième lot d'événements câblés (le premier date de la migration 0046) :
--   - commande_en_impression : la section Impression d'un ODF démarre (au
--     premier enregistrement de quantité sur son sous-ODF, cf.
--     recordWorkOrderQuantity / record_work_order_quantity — un sous-ODF ne
--     porte plus de statut distinct depuis la migration 0036, seule
--     work_orders.actual_start passant de null à une date marque ce début).
--   - commande_terminee : l'ODF passe au statut 'terminee' (confirmClosure
--     avec approve=true, ou forceCloseProductionOrder).
-- Même principe que le premier lot : ce sont deux lignes de configuration
-- de plus dans un registre déjà en place, pas un nouveau mécanisme.

insert into notification_events (event_key, label, description, category, subject_template, body_template, available_variables) values
(
  'commande_en_impression',
  'Section Impression démarrée',
  'Déclenché dans recordWorkOrderQuantity() (src/app/(app)/atelier/section/actions.ts) au premier enregistrement de quantité sur un sous-ODF dont la section appartient à la catégorie Impression — envoyé au contact client de la demande d''origine.',
  'production',
  'Votre commande {{numero_odf}} est en impression',
  '<p>Bonjour,</p><p>Votre commande <strong>{{numero_odf}}</strong> est maintenant en cours d''impression.</p>',
  'numero_odf, nom_client'
),
(
  'commande_terminee',
  'Commande terminée',
  'Déclenché dans confirmClosure()/forceCloseProductionOrder() (src/app/(app)/atelier/production/actions.ts) quand l''ODF passe au statut "terminee" — envoyé au contact client de la demande d''origine.',
  'production',
  'Votre commande {{numero_odf}} est terminée',
  '<p>Bonjour,</p><p>Votre commande <strong>{{numero_odf}}</strong> est terminée et prête.</p>',
  'numero_odf, nom_client'
);
