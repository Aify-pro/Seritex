-- ============================================================================
-- À EXÉCUTER UNE FOIS, à la main, dans Supabase > SQL Editor (pas une migration :
-- l'adresse et le secret dépendent de l'environnement, le secret ne va jamais dans git).
-- ============================================================================
-- Fait appeler l'application toutes les 5 minutes par la base pour déplacer les
-- fichiers de la médiathèque en attente dans un tampon vers le NAS dès qu'il répond.
-- L'appel n'a lieu que s'il y a un fichier en attente.
--
-- Préalable : la migration 0135 appliquée, pg_cron / pg_net actifs et le secret
-- « notifications_secret » déjà dans le Vault (voir planifier-notifications.sql) —
-- c'est le même CRON_SECRET, aucun nouveau secret à créer.

select cron.schedule(
  'mediatheque-vider-tampon',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := 'https://app.seritex.ci/api/media/tampon/vider',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    timeout_milliseconds := 120000
  )
  where exists (
    select 1
      from public.media_file_copies c
      join public.storage_targets t on t.id = c.storage_target_id
     where t.role = 'tampon' and c.sync_status = 'en_attente' and c.remote_path is not null
  );
  $job$
);

-- Vérifications :
--   select * from cron.job;
--   select status_code, content from net._http_response order by id desc limit 5;
-- Arrêter : select cron.unschedule('mediatheque-vider-tampon');
