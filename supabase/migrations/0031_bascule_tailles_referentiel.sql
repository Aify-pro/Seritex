-- ============================================================================
-- Seritex — L'ODF et le patronnage basculent sur le référentiel de tailles
-- Réf. : lot B2 du chantier ODF — suite de 0029 (référentiel) et 0030 (grille)
-- ============================================================================
--
-- 0029 a créé `sizes`, 0030 l'a peuplé. Les quantités par taille, elles,
-- continuaient d'utiliser huit valeurs figées ('XS'…'XXXL', 'Autre'), imposées
-- par la contrainte CHECK du lot 2 et par les clés JSON du patronnage.
--
-- POURQUOI TOUT BASCULE EN UNE FOIS
-- Le contrôle qui conditionne la validation d'un ODF (lot 2) rapproche
-- `production_order_sizes.taille` des clés de `repartition_par_couche`, taille
-- par taille. Faire migrer l'un sans l'autre ne casserait rien bruyamment :
-- les clés cesseraient simplement de se correspondre, la quantité tracée
-- serait lue comme nulle, et tout ODF deviendrait invalidable sans qu'aucune
-- erreur ne le dise. D'où une seule migration pour les deux côtés.
--
-- RÈGLE DE REPRISE DES DONNÉES EXISTANTES
-- L'ancienne liste était purement littérale (XS…XXXL) et correspond trait pour
-- trait à la grille Homme de 0030 — à un détail près, 'XXXL' qui s'y nomme
-- '3XL'. Les valeurs existantes sont donc rattachées au groupe Homme.
-- 'Autre' n'a aucun équivalent : s'il en reste, la migration ÉCHOUE en
-- annonçant les lignes concernées, plutôt que d'inventer une taille ou d'en
-- perdre la quantité. Mieux vaut un refus lisible qu'une donnée silencieusement
-- faussée sur laquelle reposent des rendements et des anomalies.

-- ============================================================================
-- 1. LIBÉRER LA COLONNE DE SA LISTE FIGÉE
-- ============================================================================
alter table production_order_sizes
  drop constraint if exists production_order_sizes_taille_check;

-- ============================================================================
-- 2. REPRISE DES QUANTITÉS PAR TAILLE DÉJÀ SAISIES
-- ============================================================================
-- Fonction locale : même correspondance appliquée aux trois porteurs de
-- tailles (colonne texte de l'ODF, et deux documents JSON).
create or replace function pg_temp.taille_vers_cle(p_taille text)
returns text
language sql
stable
as $$
  select s.cle
  from sizes s
  where s.groupe = 'Homme'
    and s.libelle = case p_taille when 'XXXL' then '3XL' else p_taille end;
$$;

-- 2.a Quantités demandées par taille sur l'ODF
update production_order_sizes
set taille = pg_temp.taille_vers_cle(taille)
where taille not in (select cle from sizes)
  and pg_temp.taille_vers_cle(taille) is not null;

-- 2.b Répartition par couche des tracés de placement (clés JSON)
update traces_placement t
set repartition_par_couche = (
  select jsonb_object_agg(coalesce(pg_temp.taille_vers_cle(kv.key), kv.key), kv.value)
  from jsonb_each(t.repartition_par_couche) kv
)
where t.repartition_par_couche <> '{}'::jsonb
  and exists (
    select 1 from jsonb_each(t.repartition_par_couche) kv
    where kv.key not in (select cle from sizes)
  );

-- 2.c Surplus tracé mentionné sur l'ODF (lot 2, même convention de clés)
update production_orders p
set mention_surplus_traces = (
  select jsonb_object_agg(coalesce(pg_temp.taille_vers_cle(kv.key), kv.key), kv.value)
  from jsonb_each(p.mention_surplus_traces) kv
)
where p.mention_surplus_traces is not null
  and p.mention_surplus_traces <> '{}'::jsonb
  and exists (
    select 1 from jsonb_each(p.mention_surplus_traces) kv
    where kv.key not in (select cle from sizes)
  );

-- ============================================================================
-- 3. REFUS EXPLICITE DE CE QUI N'A PAS PU ÊTRE REPRIS
-- ============================================================================
do $$
declare
  v_restes text;
begin
  select string_agg(distinct taille, ', ') into v_restes
  from production_order_sizes
  where taille not in (select cle from sizes);

  if v_restes is not null then
    raise exception
      'Tailles impossibles à rattacher au référentiel : %. Créez-les dans Paramètres > Couleurs et tailles, ou corrigez ces lignes, puis rejouez cette migration.', v_restes;
  end if;
end $$;

-- ============================================================================
-- 4. LE RÉFÉRENTIEL REMPLACE LA LISTE FIGÉE
-- ============================================================================
-- `sizes.cle` était une colonne générée (0029). Une colonne générée est un
-- calcul, et son statut de cible de clé étrangère varie selon les versions de
-- PostgreSQL : plutôt que de parier, on la transforme en colonne ordinaire
-- maintenue par un trigger. Les valeurs déjà calculées sont conservées
-- telles quelles par `drop expression`.
alter table sizes alter column cle drop expression if exists;

create or replace function sizes_set_cle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.cle := new.groupe || '/' || new.libelle;
  return new;
end;
$$;

drop trigger if exists trg_sizes_cle on sizes;
create trigger trg_sizes_cle
  before insert or update of groupe, libelle on sizes
  for each row execute function sizes_set_cle();

-- Clé étrangère plutôt qu'un nouveau CHECK : c'est le même garde-fou que le
-- lot 2 voulait — impossible d'écrire une taille qui n'existe pas — mais il
-- suit désormais le référentiel sans migration. `on delete restrict` empêche
-- de supprimer une taille encore utilisée par un ODF.
--
-- `on update cascade` propage un libellé corrigé jusqu'aux ODF. Attention :
-- il ne propage RIEN aux répartitions du patronnage, qui portent ces clés en
-- JSON. Renommer une taille déjà utilisée désynchroniserait donc le contrôle
-- de couverture — raison pour laquelle l'écran Couleurs et tailles permet de
-- créer et de désactiver une taille, jamais de la renommer.
alter table production_order_sizes
  add constraint production_order_sizes_taille_fkey
  foreign key (taille) references sizes(cle)
  on update cascade on delete restrict;

-- ============================================================================
-- 5. LA SOMME DES TAILLES DOIT ÉGALER LA QUANTITÉ COMMANDÉE
-- ============================================================================
-- Demande métier du 13/09 : « on ne devrait pas pouvoir valider un ODF si la
-- somme des tailles n'est pas égale au total commandé ». Posé à la soumission
-- plutôt qu'à la validation : l'erreur appartient à celui qui saisit, et la
-- découvrir au moment de valider ferait repartir un aller-retour complet.
create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_somme int;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'seul un ordre de fabrication en brouillon ou refusé peut être soumis (statut actuel : %)', v_po.status;
  end if;

  if not exists (select 1 from production_order_sections where production_order_id = p_production_order_id) then
    raise exception 'aucune section retenue : sélectionnez au moins une section avant de soumettre';
  end if;

  select coalesce(sum(quantite_demandee), 0) into v_somme
  from production_order_sizes
  where production_order_id = p_production_order_id;

  if v_somme = 0 then
    raise exception 'aucune quantité par taille renseignée avant de soumettre';
  end if;

  if v_somme <> v_po.total_quantity then
    raise exception 'la répartition par taille totalise % pièces alors que la commande en porte % : écart de %',
      v_somme, v_po.total_quantity, abs(v_somme - v_po.total_quantity);
  end if;

  update production_orders
  set status = 'en_attente_validation',
      refus_motif = null,
      refuse_par = null,
      refuse_le = null
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('quantite_repartie', v_somme));
end;
$$;

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
grant execute on function submit_production_order(uuid) to authenticated;
