-- ============================================================================
-- Seritex — Planification des tâches automatiques (pg_cron + pg_net) dans une migration
-- ============================================================================
--
-- Jusqu'ici, les trois appels automatiques de la base vers l'application étaient planifiés
-- par des scripts SQL passés à la main (supabase/ops/planifier-*.sql) : facile à oublier,
-- invisible dans l'historique, impossible à rejouer sur un autre environnement.
-- Cette migration les planifie à la place :
--
--   notifications-traiter               chaque minute  vide la file des notifications (0129)
--   mediatheque-importer-fichiers-site  chaque minute  copie les fichiers du site (0136)
--   mediatheque-vider-tampon            toutes les 5 min  recopie le tampon vers le NAS (0135)
--
-- Le SECRET n'est pas dans ce fichier : chaque appel le lit dans le Vault au moment de
-- l'exécution (secret « notifications_secret », à créer à la main, identique à CRON_SECRET
-- côté Vercel). Sans lui l'application répond 401 et rien ne part.
--
-- Garde-fous :
--   · si pg_cron, pg_net ou le Vault sont absents (banc de test, base locale), la migration
--     ne fait rien et le signale par un message ;
--   · une tâche déjà planifiée (par un script manuel, par exemple) n'est ni remplacée ni
--     dupliquée ;
--   · l'adresse est celle de la PRODUCTION (https://app.seritex.ci). Sur une base de test ou
--     de préproduction, désactiver les tâches ou les replanifier avec l'autre adresse.
--
-- Aucune donnée n'est modifiée. Pour arrêter une tâche : select cron.unschedule('<nom>');
-- ============================================================================

do $migration$
declare
  v_taches constant text[][] := array[
    -- nom, fréquence, chemin, délai max de l'appel (ms), condition « il y a du travail »
    array[
      'notifications-traiter', '* * * * *', '/api/notifications/traiter', '20000',
      $c$select 1 from public.notification_outbox
          where processed_at is null and process_after <= now() and attempts < 6$c$
    ],
    array[
      'mediatheque-importer-fichiers-site', '* * * * *', '/api/media/importer-site', '300000',
      $c$select 1
           from public.request_site_files f
           join public.requests r on r.id = f.request_id
          where f.imported_at is null and f.import_attempts < 60 and r.company_id is not null$c$
    ],
    array[
      'mediatheque-vider-tampon', '*/5 * * * *', '/api/media/tampon/vider', '120000',
      $c$select 1
           from public.media_file_copies c
           join public.storage_targets t on t.id = c.storage_target_id
          where t.role = 'tampon' and c.sync_status = 'en_attente' and c.remote_path is not null$c$
    ]
  ];
  v_i int;
  v_nom text;
  v_commande text;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('cron.job') is null
     or to_regproc('net.http_get') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0137 : pg_cron, pg_net ou le Vault est absent — aucune tâche planifiée (normal hors Supabase).';
    return;
  end if;

  for v_i in 1 .. array_length(v_taches, 1) loop
    v_nom := v_taches[v_i][1];

    if exists (select 1 from cron.job where jobname = v_nom) then
      raise notice '0137 : la tâche % existe déjà — conservée telle quelle.', v_nom;
      continue;
    end if;

    v_commande := format(
      $f$
  select net.http_get(
    url := 'https://app.seritex.ci%s',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    timeout_milliseconds := %s
  )
  where exists (
    %s
  );
  $f$,
      v_taches[v_i][3], v_taches[v_i][4], v_taches[v_i][5]
    );

    perform cron.schedule(v_nom, v_taches[v_i][2], v_commande);
    raise notice '0137 : tâche % planifiée (%).', v_nom, v_taches[v_i][2];
  end loop;
end;
$migration$;
