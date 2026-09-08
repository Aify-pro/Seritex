-- ============================================================================
-- Seritex — Module Production, lot 6 : sérialisation par lot (QR code)
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (section 15),
--        claude_cahier-des-charges-technique-production.md (lot 6)
-- ============================================================================
--
-- Granularité par LOT, pas par pièce (section 15) : à la fin d'un matelas,
-- l'équipe coupe regroupe librement les pièces produites (par taille ou
-- mélangées) et génère une étiquette QR + numéro de série par lot. Objectif
-- métier explicite : ne pas mélanger deux commandes visuellement
-- identiques au montage.
--
-- Décisions actées ici :
--   - Numérotation : même mécanique que sample_requests.sample_number
--     (migration 0004) — séquence + trigger, format LOT-AAAA-NNNNN.
--   - Pas de colonne qr_payload stockée, contrairement à la proposition du
--     cahier des charges technique : le composant SampleQrCode existant
--     (src/components/samples/sample-qr-code.tsx) génère déjà le QR à la
--     volée à partir d'une URL absolue, jamais persisté en base ("la base
--     ne stocke pas de binaire", même principe que l'échantillonnage). Le
--     payload d'un lot est simplement `${baseUrl}/lots/${code}` — inutile
--     de le dupliquer en colonne, il se recalcule trivialement.
--   - Composition par taille : jsonb, saisie libre, aucune validation
--     contre repartition_par_couche/production_order_sizes — explicitement
--     "sans calcul automatique" (section 15).
--   - Création réservée à l'équipe coupe (chef de la section Coupe) ou
--     responsable_production/administrateur — même périmètre d'autorité
--     que close_matelas (lot 4), cohérent avec "à la fin d'un matelas,
--     l'équipe coupe...".
--   - Impression hors périmètre logiciel (section 15) : aucune table ni
--     fonction ici ne gère l'imprimante — seule la page /lots/[code]
--     (application) affiche le contenu à imprimer.

create sequence article_lot_code_seq;

create table article_lots (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  production_order_id uuid not null references production_orders(id),
  trace_id uuid references traces_placement(id),
  categorie text not null check (categorie in ('semi_fini', 'fini', 'dechet')),
  composition_taille jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create or replace function generate_article_lot_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    new.code := 'LOT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('article_lot_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_generate_article_lot_code
  before insert on article_lots
  for each row execute function generate_article_lot_code();

create index idx_article_lots_odf on article_lots(production_order_id);
create index idx_article_lots_trace on article_lots(trace_id);

alter table article_lots enable row level security;

-- Outil de traçabilité interne à l'atelier, pas de portée client (à la
-- différence des échantillons) : tout utilisateur staff authentifié peut
-- consulter, l'écriture passe uniquement par create_article_lot().
create policy article_lots_select on article_lots
  for select using (current_role_name() <> 'client');

create or replace function create_article_lot(
  p_production_order_id uuid,
  p_trace_id uuid,
  p_categorie text,
  p_composition_taille jsonb
) returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_lot article_lots;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la génération de lots est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de générer un lot';
  end if;

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if p_categorie not in ('semi_fini', 'fini', 'dechet') then
    raise exception 'catégorie invalide : %', p_categorie;
  end if;
  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    where tp.id = p_trace_id and fp.odf_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  insert into article_lots (production_order_id, trace_id, categorie, composition_taille, created_by)
  values (p_production_order_id, p_trace_id, p_categorie, coalesce(p_composition_taille, '{}'::jsonb), auth.uid())
  returning * into v_lot;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_article_lot', 'article_lot', v_lot.id,
          jsonb_build_object('code', v_lot.code, 'production_order_id', p_production_order_id,
                              'categorie', p_categorie, 'composition_taille', p_composition_taille));

  return query select v_lot.id, v_lot.code;
end;
$$;
revoke all on function create_article_lot(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function create_article_lot(uuid, uuid, text, jsonb) to authenticated;
