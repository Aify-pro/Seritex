-- ============================================================================
-- 0179 — Correctif : enregistrement du mot de passe FreeTrack
-- ============================================================================
-- 0173 vidait la session FreeTrack en cache par « delete from freetrack_session; ».
-- Sur Supabase, l'extension pg_safeupdate refuse tout DELETE sans WHERE venant
-- de l'API : l'enregistrement du mot de passe échouait (« DELETE requires a
-- WHERE clause ») et était annulé. Même fonction, avec la condition explicite.
-- ============================================================================

create or replace function freetrack_set_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'Réservé à l''administrateur de la plateforme.' using errcode = '42501';
  end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 200 then
    raise exception 'Mot de passe invalide.' using errcode = 'P0001';
  end if;
  if to_regclass('vault.secrets') is null then
    raise exception 'Coffre-fort (Vault) indisponible sur cette base.' using errcode = 'P0001';
  end if;
  select password_secret_id into v_id from freetrack_settings where id;
  if v_id is not null and exists (select 1 from vault.secrets where id = v_id) then
    perform vault.update_secret(v_id, p_password);
  else
    v_id := vault.create_secret(p_password, 'freetrack_password_' || replace(gen_random_uuid()::text, '-', ''), 'Mot de passe FreeTrack (module Véhicules)');
  end if;
  update freetrack_settings
  set password_secret_id = v_id, password_set_at = now(), password_set_by = auth.uid(), derniere_erreur = null
  where id;
  -- Nouvelle identité : la session en cache ne vaut plus (une seule ligne, id = true).
  delete from freetrack_session where id;
end;
$$;

revoke execute on function freetrack_set_password(text) from public, anon;
grant execute on function freetrack_set_password(text) to authenticated;
