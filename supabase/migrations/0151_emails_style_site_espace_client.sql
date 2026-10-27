-- ============================================================================
-- 0151 — E-mails : parcours client sur www.seritex.ci, style du site, textes enrichis
-- ============================================================================
--
-- Le client valide ses proformas, suit ses commandes et ses livraisons depuis son
-- espace client sur www.seritex.ci (et plus sur app.seritex.ci). Les e-mails
-- doivent donc pointer vers le site, et être à l'image du site.
--
--   1. Réglage « URL du site » (Paramètres > Notifications) : base des liens
--      destinés aux clients, variable {{lien_site}} dans les modèles. Vide = https://www.seritex.ci.
--   2. Alerte « litige » déclenchée par la base : le client signale un problème
--      depuis la page de confirmation de réception du SITE (qui appelle la base
--      directement) ; aucun code de la plateforme ne tourne alors. Le déclencheur
--      inscrit l'événement dans la file (notification_outbox, migration 0129).
--      L'envoi par le code de la page de confirmation de la plateforme disparaît :
--      une seule source, jamais de doublon.
--   3. Textes de tous les e-mails réécrits : plus complets, plus professionnels,
--      liens clients vers le site. Les mises en forme (<h1>, tableau récapitulatif,
--      bouton) sont habillées aux couleurs du site par l'application.
--
-- Les modèles DÉJÀ MODIFIÉS à la main dans Paramètres > Notifications (updated_by
-- renseigné) ne sont PAS touchés : ils gardent leur texte.
-- ============================================================================

alter table notification_style_settings add column if not exists site_base_url text;
comment on column notification_style_settings.site_base_url is
  'Adresse du site public (liens des e-mails destinés aux clients : {{lien_site}}). Vide = https://www.seritex.ci.';

-- ----------------------------------------------------------------------------
-- 2. LITIGE SIGNALÉ PAR LE CLIENT DEPUIS LE SITE
-- ----------------------------------------------------------------------------

create or replace function notification_litige_livraison()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_outbox (event_key, entity_type, entity_id, payload)
  values (
    'livraison_litige', 'shipment', new.shipment_id,
    jsonb_build_object('shipment_id', new.shipment_id, 'commentaire', coalesce(new.commentaire, ''))
  );
  return new;
end;
$$;

drop trigger if exists shipment_confirmations_notifier_probleme on shipment_confirmations;
create trigger shipment_confirmations_notifier_probleme
  after update of reponse on shipment_confirmations
  for each row
  when (new.reponse = 'probleme' and old.reponse is distinct from 'probleme')
  execute function notification_litige_livraison();

-- ----------------------------------------------------------------------------
-- 3. TEXTES DES E-MAILS
-- ----------------------------------------------------------------------------

update notification_events
   set subject_template = 'Votre proforma {{numero_devis}} est prête — à valider en ligne',
       body_template = '<h1>Votre proforma est disponible</h1><p>Bonjour,</p><p>Nous vous remercions de la confiance que vous accordez à Seritex. Suite à l''étude de votre demande, notre équipe a établi pour vous la proforma <strong>{{numero_devis}}</strong>, contrôlée et validée par notre Direction.</p><table class="recap"><tr><th>Référence</th><td>{{numero_devis}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Montant total</th><td>{{montant_total}}</td></tr></table><h2>Comment la valider ?</h2><ol><li>Connectez-vous à votre espace client sur notre site.</li><li>Ouvrez la proforma et vérifiez les articles, les quantités, les délais et le montant.</li><li>Si tout vous convient, acceptez-la en ligne : votre commande est alors lancée en fabrication.</li></ol><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Consulter et valider ma proforma</a></p><p class="note">Une quantité, une répartition par taille ou une personnalisation à ajuster ? Écrivez-nous depuis votre demande, dans l''espace client, <strong>avant</strong> d''accepter : une fois la proforma acceptée, la fabrication démarre et ne peut plus être modifiée en ligne.</p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_devis, nom_client, montant_total, chemin_lien'
 where event_key = 'devis_envoye'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre commande {{numero_odf}} entre en impression',
       body_template = '<h1>Votre commande passe à l''impression</h1><p>Bonjour,</p><p>La fabrication de votre commande <strong>{{numero_odf}}</strong> franchit une nouvelle étape : elle est désormais <strong>en cours d''impression</strong> dans notre atelier.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Étape en cours</th><td>Impression</td></tr></table><p>Votre commande poursuit ensuite son parcours dans nos ateliers jusqu''à sa livraison. Nous vous informerons à chaque étape importante ; vous pouvez aussi suivre son avancement à tout moment depuis votre espace client.</p><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Suivre ma commande</a></p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_odf, nom_client, chemin_lien'
 where event_key = 'commande_en_impression'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre commande {{numero_odf}} est terminée',
       body_template = '<h1>Votre commande est terminée</h1><p>Bonjour,</p><p>Bonne nouvelle : la fabrication de votre commande <strong>{{numero_odf}}</strong> est <strong>achevée</strong>.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>État</th><td>Fabrication terminée</td></tr></table><h2>Et maintenant ?</h2><p>Votre commande va être préparée pour sa livraison ou son retrait. Vous recevrez un nouveau message dès que la date est fixée, puis à chaque étape de la livraison.</p><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Voir ma commande</a></p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_odf, nom_client, chemin_lien'
 where event_key = 'commande_terminee'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre livraison {{numero_bl}} est en préparation',
       body_template = '<h1>Votre livraison est en préparation</h1><p>Bonjour,</p><p>Nous préparons actuellement la livraison de votre commande <strong>{{numero_odf}}</strong>.</p><table class="recap"><tr><th>Bon de livraison</th><td>{{numero_bl}}</td></tr><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Quantité</th><td>{{pieces}} pièces</td></tr><tr><th>Livraison prévue</th><td>{{date_prevue}}</td></tr></table><p>Nous vous préviendrons de nouveau au départ de la livraison. Pour la suite, merci de prévoir qu''une personne habilitée puisse réceptionner et contrôler les articles à l''arrivée.</p><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Suivre ma livraison</a></p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_bl, numero_odf, nom_client, pieces, date_prevue, lieu, chemin_lien'
 where event_key = 'livraison_preparee'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre livraison {{numero_bl}} est en route',
       body_template = '<h1>Votre livraison est en route</h1><p>Bonjour,</p><p>Votre commande a quitté notre atelier et se dirige vers vous.</p><table class="recap"><tr><th>Bon de livraison</th><td>{{numero_bl}}</td></tr><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Destination</th><td>{{lieu}}</td></tr><tr><th>Contact livreur</th><td>{{livreur}}</td></tr></table><p>Merci de vous assurer qu''une personne puisse réceptionner la marchandise. À la livraison, nous vous inviterons à confirmer la bonne réception, ou à nous signaler tout problème, en un clic.</p><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Suivre ma livraison</a></p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_bl, numero_odf, nom_client, pieces, date_prevue, lieu, livreur, chemin_lien'
 where event_key = 'livraison_en_route'
   and updated_by is null;

update notification_events
   set subject_template = 'Livraison {{numero_bl}} effectuée — merci de confirmer la réception',
       body_template = '<h1>Votre commande a été remise</h1><p>Bonjour,</p><p>La livraison <strong>{{numero_bl}}</strong> a été remise le <strong>{{date_livraison}}</strong>.</p><table class="recap"><tr><th>Bon de livraison</th><td>{{numero_bl}}</td></tr><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Quantité</th><td>{{pieces}} pièces</td></tr><tr><th>Remise le</th><td>{{date_livraison}}</td></tr></table><h2>Merci de nous donner votre retour</h2><p>Votre avis nous permet de clore la livraison dans de bonnes conditions :</p><ul><li><strong>Tout est conforme ?</strong> Confirmez la réception en un clic.</li><li><strong>Un manque, un article abîmé, une erreur ?</strong> Signalez-le en quelques mots : notre service livraison est alerté immédiatement et revient vers vous.</li></ul><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Confirmer la réception ou signaler un problème</a></p><p class="note">Ce lien est personnel et valable 30 jours. Il ne permet de répondre qu''une seule fois.</p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_bl, numero_odf, nom_client, pieces, date_livraison, lieu, chemin_lien'
 where event_key = 'livraison_livree_confirmer'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre commande {{numero_bl}} est prête à enlever',
       body_template = '<h1>Votre commande est prête</h1><p>Bonjour,</p><p>Votre commande est prête : vous pouvez venir l''enlever à notre atelier.</p><table class="recap"><tr><th>Bon de livraison</th><td>{{numero_bl}}</td></tr><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Quantité</th><td>{{pieces}} pièces</td></tr></table><h2>À prévoir pour le retrait</h2><ul><li>Une personne habilitée à retirer la marchandise pour votre société.</li><li>Le <strong>cachet de votre société</strong>, pour signer le bon de livraison.</li><li>Un contrôle des articles sur place : toute remarque est notée sur le bon.</li></ul><p class="bouton"><a class="bouton" href="{{lien_site}}{{chemin_lien}}">Voir ma livraison</a></p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'numero_bl, numero_odf, nom_client, pieces, chemin_lien'
 where event_key = 'livraison_prete_a_enlever'
   and updated_by is null;

update notification_events
   set subject_template = 'Litige sur la livraison {{numero_bl}} — {{nom_client}}',
       body_template = '<h1>Un problème est signalé sur une livraison</h1><p>Bonjour,</p><p>Un problème a été signalé sur la livraison <strong>{{numero_bl}}</strong>. Merci de prendre contact avec le client dans les meilleurs délais.</p><table class="recap"><tr><th>Livraison</th><td>{{numero_bl}}</td></tr><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Lieu</th><td>{{lieu}}</td></tr></table><h2>Message du client</h2><blockquote>{{commentaire}}</blockquote><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la livraison</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_bl, numero_odf, nom_client, lieu, livreur, commentaire, chemin_lien'
 where event_key = 'livraison_litige'
   and updated_by is null;

update notification_events
   set subject_template = 'Nouvelle demande de visuel — {{numero_demande}}',
       body_template = '<h1>Un visuel est à préparer</h1><p>Bonjour,</p><p>Une nouvelle demande nécessite un visuel. Merci de la prendre en charge.</p><table class="recap"><tr><th>Demande</th><td>{{numero_demande}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr></table><h2>Description du besoin</h2><blockquote>{{description}}</blockquote><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_demande, nom_client, description'
 where event_key = 'demande_visuel_infographe'
   and updated_by is null;

update notification_events
   set subject_template = 'Nouvel ordre de travail — {{numero_ot}}',
       body_template = '<h1>Un ordre de travail vous est affecté</h1><p>Bonjour,</p><p>L''ordre de travail <strong>{{numero_ot}}</strong> vient de vous être affecté. Merci d''en prendre connaissance et de planifier sa réalisation.</p><table class="recap"><tr><th>Ordre de travail</th><td>{{numero_ot}}</td></tr><tr><th>Section</th><td>{{section}}</td></tr><tr><th>Ordre de fabrication</th><td>{{numero_odf}}</td></tr></table><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_ot, numero_odf, section'
 where event_key = 'ot_assigne_chef_section'
   and updated_by is null;

update notification_events
   set subject_template = 'Devis accepté — nouvel ordre de fabrication {{numero_odf}}',
       body_template = '<h1>Un devis vient d''être accepté</h1><p>Bonjour,</p><p>Le devis <strong>{{numero_devis}}</strong> de <strong>{{nom_client}}</strong> a été accepté. L''ordre de fabrication <strong>{{numero_odf}}</strong> a été créé et attend votre configuration avant de pouvoir être lancé.</p><table class="recap"><tr><th>Devis</th><td>{{numero_devis}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Ordre de fabrication</th><td>{{numero_odf}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir l''ordre de fabrication</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_devis, nom_client, numero_odf, chemin_lien'
 where event_key = 'devis_accepte'
   and updated_by is null;

update notification_events
   set subject_template = 'Nouvelle demande client — {{numero_demande}}',
       body_template = '<h1>Une nouvelle demande vient d''arriver</h1><p>Bonjour,</p><p><strong>{{nom_client}}</strong> a déposé une nouvelle demande : <strong>{{numero_demande}}</strong>. Merci de la traiter rapidement.</p><h2>Description</h2><blockquote>{{description}}</blockquote><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la demande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_demande, nom_client, description, chemin_lien'
 where event_key = 'nouvelle_demande_client_portail'
   and updated_by is null;

update notification_events
   set subject_template = 'Nouveau message de {{nom_client}} — demande {{numero_demande}}',
       body_template = '<h1>Un client vous a écrit</h1><p>Bonjour,</p><p><strong>{{nom_client}}</strong> a écrit sur la demande <strong>{{numero_demande}}</strong> :</p><blockquote>{{extrait}}</blockquote><p>Répondez-lui depuis la demande : le client est averti de votre réponse dans son espace client.</p><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la demande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'nom_client, numero_demande, extrait, chemin_lien'
 where event_key = 'message_client'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — en attente de validation',
       body_template = '<h1>Une commande attend votre validation</h1><p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> est <strong>en attente de validation</strong>. Merci de la contrôler pour permettre son lancement.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Quantité</th><td>{{quantite}} pièces</td></tr><tr><th>Devis d''origine</th><td>{{numero_devis}}</td></tr><tr><th>Statut</th><td>{{statut_precedent}} → {{statut}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
 where event_key = 'odf_en_attente_validation'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — refusée',
       body_template = '<h1>Une commande a été refusée</h1><p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> a été <strong>refusé</strong>. Consultez la commande pour en connaître le motif.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Quantité</th><td>{{quantite}} pièces</td></tr><tr><th>Devis d''origine</th><td>{{numero_devis}}</td></tr><tr><th>Statut</th><td>{{statut_precedent}} → {{statut}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
 where event_key = 'odf_refusee'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — lancée en production',
       body_template = '<h1>Une commande est lancée en production</h1><p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> est <strong>lancé en production</strong> : les ateliers peuvent démarrer.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Quantité</th><td>{{quantite}} pièces</td></tr><tr><th>Devis d''origine</th><td>{{numero_devis}}</td></tr><tr><th>Statut</th><td>{{statut_precedent}} → {{statut}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
 where event_key = 'odf_en_production'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — demande de clôture',
       body_template = '<h1>Une clôture est à valider</h1><p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> fait l''objet d''une <strong>demande de clôture</strong> : elle attend votre validation.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Quantité</th><td>{{quantite}} pièces</td></tr><tr><th>Devis d''origine</th><td>{{numero_devis}}</td></tr><tr><th>Statut</th><td>{{statut_precedent}} → {{statut}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
 where event_key = 'odf_demande_cloture'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — terminée',
       body_template = '<h1>Une commande est terminée</h1><p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> est <strong>terminé</strong>. La livraison peut être préparée.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Quantité</th><td>{{quantite}} pièces</td></tr><tr><th>Devis d''origine</th><td>{{numero_devis}}</td></tr><tr><th>Statut</th><td>{{statut_precedent}} → {{statut}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
 where event_key = 'odf_terminee'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — annulée',
       body_template = '<h1>Une commande a été annulée</h1><p>Bonjour,</p><p>L''ordre de fabrication <strong>{{numero_odf}}</strong> a été <strong>annulé</strong>.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Quantité</th><td>{{quantite}} pièces</td></tr><tr><th>Devis d''origine</th><td>{{numero_devis}}</td></tr><tr><th>Statut</th><td>{{statut_precedent}} → {{statut}}</td></tr></table><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien'
 where event_key = 'odf_annulee'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — coupe : il manque {{manquants}}',
       body_template = '<h1>Coupe incomplète : un rattrapage est nécessaire</h1><p>Bonjour,</p><p>Après la clôture d''un matelas, la coupe de l''article <strong>{{article}}</strong> ne couvre pas la demande.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Article</th><td>{{article}}</td></tr><tr><th>Manquant</th><td>{{manquants}}</td></tr></table><p>Un tracé de rattrapage est à préparer et à valider dans le Patronnage.</p><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, article, manquants, surplus, chemin_lien'
 where event_key = 'ecart_coupe_manquant'
   and updated_by is null;

update notification_events
   set subject_template = 'Commande {{numero_odf}} — coupe : surplus {{surplus}}',
       body_template = '<h1>Coupe en surplus : une décision est attendue</h1><p>Bonjour,</p><p>Après la clôture d''un matelas, la coupe prévue de l''article <strong>{{article}}</strong> dépasse la demande.</p><table class="recap"><tr><th>Commande</th><td>{{numero_odf}}</td></tr><tr><th>Client</th><td>{{nom_client}}</td></tr><tr><th>Article</th><td>{{article}}</td></tr><tr><th>Surplus</th><td>{{surplus}}</td></tr></table><p>Vous pouvez réduire les plis, annuler un tracé pas encore coupé, ou conserver le surplus en indiquant son motif.</p><p class="bouton"><a class="bouton" href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p><p class="note">Notification automatique de la plateforme Seritex.</p>',
       available_variables = 'numero_odf, nom_client, article, manquants, surplus, chemin_lien'
 where event_key = 'ecart_coupe_surplus'
   and updated_by is null;

update notification_events
   set subject_template = 'Bienvenue — votre compte Seritex est prêt',
       body_template = '<h1>Bienvenue sur la plateforme Seritex</h1><p>Bonjour {{nom_utilisateur}},</p><p>Un compte vient d''être créé pour vous sur la plateforme de gestion Seritex.</p><table class="recap"><tr><th>Votre rôle</th><td>{{role}}</td></tr></table><p>Pour l''activer, il vous reste à choisir votre mot de passe :</p><p class="bouton"><a class="bouton" href="{{lien_action}}">Définir mon mot de passe</a></p><p class="note">Ce lien est personnel, à usage unique et limité dans le temps. S''il a expiré, utilisez « Mot de passe oublié ? » sur la page de connexion.</p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'nom_utilisateur, role, lien_action'
 where event_key = 'compte_cree'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre compte Seritex a été modifié',
       body_template = '<h1>Votre compte a été modifié</h1><p>Bonjour {{nom_utilisateur}},</p><p>Un administrateur a modifié votre compte Seritex :</p><blockquote>{{modifications}}</blockquote><p class="note">Ces changements vous surprennent ? Contactez votre administrateur.</p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'nom_utilisateur, modifications'
 where event_key = 'compte_modifie'
   and updated_by is null;

update notification_events
   set subject_template = 'Réinitialisation de votre mot de passe Seritex',
       body_template = '<h1>Choisissez un nouveau mot de passe</h1><p>Bonjour {{nom_utilisateur}},</p><p>Vous (ou un administrateur) avez demandé la réinitialisation de votre mot de passe Seritex.</p><p class="bouton"><a class="bouton" href="{{lien_action}}">Choisir un nouveau mot de passe</a></p><p class="note">Ce lien est à usage unique et limité dans le temps. Si vous n''êtes pas à l''origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'nom_utilisateur, lien_action'
 where event_key = 'mot_de_passe_reinitialisation'
   and updated_by is null;

update notification_events
   set subject_template = 'Votre mot de passe Seritex a été modifié',
       body_template = '<h1>Votre mot de passe a été modifié</h1><p>Bonjour {{nom_utilisateur}},</p><p>Le mot de passe de votre compte Seritex vient d''être modifié.</p><table class="recap"><tr><th>Date et heure</th><td>{{date_heure}}</td></tr></table><p><strong>Ce n''est pas vous ?</strong> Contactez immédiatement votre administrateur pour sécuriser votre compte.</p><p>Cordialement,<br /><strong>L''équipe Seritex</strong></p>',
       available_variables = 'nom_utilisateur, date_heure'
 where event_key = 'mot_de_passe_modifie'
   and updated_by is null;

-- Variables documentées (affichage seul) : mises à jour pour tous les modèles, personnalisés ou non.
update notification_events set available_variables = 'numero_devis, nom_client, montant_total, chemin_lien' where event_key = 'devis_envoye';
update notification_events set available_variables = 'numero_odf, nom_client, chemin_lien' where event_key = 'commande_en_impression';
update notification_events set available_variables = 'numero_odf, nom_client, chemin_lien' where event_key = 'commande_terminee';
update notification_events set available_variables = 'numero_bl, numero_odf, nom_client, pieces, date_prevue, lieu, chemin_lien' where event_key = 'livraison_preparee';
update notification_events set available_variables = 'numero_bl, numero_odf, nom_client, pieces, date_prevue, lieu, livreur, chemin_lien' where event_key = 'livraison_en_route';
update notification_events set available_variables = 'numero_bl, numero_odf, nom_client, pieces, date_livraison, lieu, chemin_lien' where event_key = 'livraison_livree_confirmer';
update notification_events set available_variables = 'numero_bl, numero_odf, nom_client, pieces, chemin_lien' where event_key = 'livraison_prete_a_enlever';
update notification_events set available_variables = 'numero_bl, numero_odf, nom_client, lieu, livreur, commentaire, chemin_lien' where event_key = 'livraison_litige';
update notification_events set available_variables = 'numero_demande, nom_client, description' where event_key = 'demande_visuel_infographe';
update notification_events set available_variables = 'numero_ot, numero_odf, section' where event_key = 'ot_assigne_chef_section';
update notification_events set available_variables = 'numero_devis, nom_client, numero_odf, chemin_lien' where event_key = 'devis_accepte';
update notification_events set available_variables = 'numero_demande, nom_client, description, chemin_lien' where event_key = 'nouvelle_demande_client_portail';
update notification_events set available_variables = 'nom_client, numero_demande, extrait, chemin_lien' where event_key = 'message_client';
update notification_events set available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien' where event_key = 'odf_en_attente_validation';
update notification_events set available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien' where event_key = 'odf_refusee';
update notification_events set available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien' where event_key = 'odf_en_production';
update notification_events set available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien' where event_key = 'odf_demande_cloture';
update notification_events set available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien' where event_key = 'odf_terminee';
update notification_events set available_variables = 'numero_odf, nom_client, numero_devis, quantite, statut_precedent, statut, chemin_lien' where event_key = 'odf_annulee';
update notification_events set available_variables = 'numero_odf, nom_client, article, manquants, surplus, chemin_lien' where event_key = 'ecart_coupe_manquant';
update notification_events set available_variables = 'numero_odf, nom_client, article, manquants, surplus, chemin_lien' where event_key = 'ecart_coupe_surplus';
update notification_events set available_variables = 'nom_utilisateur, role, lien_action' where event_key = 'compte_cree';
update notification_events set available_variables = 'nom_utilisateur, modifications' where event_key = 'compte_modifie';
update notification_events set available_variables = 'nom_utilisateur, lien_action' where event_key = 'mot_de_passe_reinitialisation';
update notification_events set available_variables = 'nom_utilisateur, date_heure' where event_key = 'mot_de_passe_modifie';

update notification_events
   set description = 'Déclenché dès que le client signale un problème depuis la page de confirmation de réception du site (via la file d''attente), ou qu''un litige est ouvert par le service — envoyé au service livraison, sauf destinataires réglés dans Paramètres > Notifications.'
 where event_key = 'livraison_litige';
