-- ============================================================================
-- À EXÉCUTER UNE FOIS, à la main, dans Supabase > SQL Editor (pas une migration :
-- l'adresse et le secret dépendent de l'environnement, le secret ne va jamais dans git).
-- ============================================================================
-- Fait appeler l'application chaque minute par la base pour vider la file des
-- notifications (devis accepté, message d'un client…), sans cron Vercel (payant).
-- L'appel n'a lieu que s'il y a quelque chose à envoyer.
--
-- Préalable : la migration 0129 appliquée, et CRON_SECRET défini dans les variables
-- Vercel (Production) de la plateforme, avec EXACTEMENT la même valeur que ci-dessous.

-- 1. Extensions (gratuites sur Supabase). Si l'une est refusée : Database > Extensions, les activer.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- 2. Le secret, dans le Vault de Supabase. Remplacez <VALEUR> par le secret (saisi par vous seul).
select vault.create_secret('<VALEUR>', 'notifications_secret');

-- 3. La planification : toutes les minutes. Remplacez l'adresse si l'application n'est pas sur app.seritex.ci.
select cron.schedule(
  'notifications-traiter',
  '* * * * *',
  $job$
  select net.http_get(
    url := 'https://app.seritex.ci/api/notifications/traiter',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    timeout_milliseconds := 20000
  )
  where exists (
    select 1 from public.notification_outbox
     where processed_at is null and process_after <= now() and attempts < 6
  );
  $job$
);

-- Vérifications :
--   select * from cron.job;                                             -- la tâche est listée
--   select status_code, content from net._http_response order by id desc limit 5;   -- 200 attendu
--   select jobid, status, return_message from cron.job_run_details order by start_time desc limit 5;
-- Arrêter : select cron.unschedule('notifications-traiter');
