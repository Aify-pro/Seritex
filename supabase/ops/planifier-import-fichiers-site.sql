-- ============================================================================
-- À EXÉCUTER UNE FOIS, à la main, dans Supabase > SQL Editor (pas une migration :
-- l'adresse et le secret dépendent de l'environnement, le secret ne va jamais dans git).
-- ============================================================================
-- Fait appeler l'application chaque minute par la base pour copier dans la médiathèque du
-- client (et sur le NAS, ou à défaut sur le tampon) les fichiers envoyés par le site : logos,
-- maquette PDF, image de la maquette. L'appel n'a lieu que s'il y a un fichier à copier
-- dont la demande a déjà une société.
--
-- Préalable : la migration 0136 appliquée, pg_cron / pg_net actifs et le secret
-- « notifications_secret » déjà dans le Vault (voir planifier-notifications.sql) —
-- c'est le même CRON_SECRET, aucun nouveau secret à créer.

select cron.schedule(
  'mediatheque-importer-fichiers-site',
  '* * * * *',
  $job$
  select net.http_get(
    url := 'https://app.seritex.ci/api/media/importer-site',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    timeout_milliseconds := 300000
  )
  where exists (
    select 1
      from public.request_site_files f
      join public.requests r on r.id = f.request_id
     where f.imported_at is null and f.import_attempts < 60 and r.company_id is not null
  );
  $job$
);

-- Vérifications :
--   select * from cron.job;
--   select status_code, content from net._http_response order by id desc limit 5;
--   select count(*) from public.request_site_files where imported_at is null;   -- reste à copier
-- Arrêter : select cron.unschedule('mediatheque-importer-fichiers-site');
