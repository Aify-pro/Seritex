// ============================================================================
// Reprise de l'Excel PLANNING_FINAL dans le module Prospection (lot PR-1b)
// ============================================================================
// Lit le classeur et écrit un fichier SQL à relire puis exécuter :
//
//   node scripts/prospection-reprise/generer-sql.mjs ~/Desktop/PLANNING_FINAL.xlsx reprise.sql
//   supabase db query --linked -f reprise.sql
//
// Reprend :
//   - PROSPECTS À CONQUÉRIR → fiches companies (sans sage_code, étape
//     « suspect ») + prospects_fiches, attribuées à Amy ou Miriama ;
//   - AMY / MIRIAMA (journaux de visites) → visites, source « reprise_excel ».
//
// Le SQL est rejouable : un prospect déjà repris (même code PSP) ou une visite
// déjà reprise (même onglet:ligne) est ignoré. Il échoue d'emblée si Amy et
// Miriama ne sont pas enregistrées comme commerciales (Paramètres >
// Prospection, collaborateur Sage « Amy » / « Miriama »).
//
// Le fichier SQL contient des données commerciales : ne pas le committer.
// ============================================================================
import fs from "node:fs";
import { lireClasseur } from "./lire-xlsx.mjs";

const [, , source, sortie] = process.argv;
if (!source || !sortie) {
  console.error("Usage : node generer-sql.mjs <PLANNING_FINAL.xlsx> <sortie.sql>");
  process.exit(1);
}

const ONGLET_PROSPECTS = "PROSPECTS À CONQUÉRIR";
const JOURNAUX = { AMY: "Amy", MIRIAMA: "Miriama" }; // onglet → collaborateur Sage
// Codes « fourre-tout » sous lesquels les commerciales notaient leurs prospects.
const CODES_FOURRE_TOUT = new Set(["DIV002", "DIV045", "DIVO45"]);

const wb = lireClasseur(source, [ONGLET_PROSPECTS, ...Object.keys(JOURNAUX)]);

const lit = (v) => (v === null || v === undefined || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "null" : String(Number(v)));
const net = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t || null;
};

// --- Prospects ------------------------------------------------------------------
const AXES = { "Tenues normées": "tenues_normees", "Tenues + goodies": "tenues_goodies", "Goodies & communication": "goodies" };
const TAILLES = { "Grand compte": "grand_compte", "Moyen compte": "moyen_compte", "Petit compte": "petit_compte" };
// Colonnes de l'onglet (ligne d'en-tête 4).
const P = { priorite: 0, nom: 1, activite: 2, pourquoi: 3, offre: 4, potentiel: 5, localisation: 6, statut: 7, contact: 8, taille: 9, code: 10, axe: 11, zone: 12, commerciale: 14, nPot: 15, nRec: 16, nTen: 17, nGood: 18, nAcc: 19, fiabilite: 20, famille: 32 };

const prospects = [];
const ignores = [];
for (const l of wb[ONGLET_PROSPECTS].filter((x) => x.r >= 5 && x.c[P.code])) {
  const c = l.c;
  const statut = net(c[P.statut]) ?? "";
  if (/déjà client/i.test(statut)) {
    ignores.push(`${c[P.code]} ${c[P.nom]} (déjà client)`);
    continue;
  }
  if (!/^à qualifier/i.test(statut)) throw new Error(`Statut de prospect inattendu : « ${statut} » (${c[P.code]})`);
  prospects.push({
    code: String(c[P.code]).trim(),
    nom: net(c[P.nom]),
    commerciale: net(c[P.commerciale]),
    cols: [
      num(c[P.priorite]), lit(net(c[P.activite])), lit(net(c[P.famille])), lit(AXES[net(c[P.axe])] ?? null),
      lit(TAILLES[net(c[P.taille])] ?? null), lit(net(c[P.zone])?.toUpperCase()), lit(net(c[P.localisation])),
      lit(net(c[P.pourquoi])), lit(net(c[P.offre])), lit(net(c[P.contact])), lit(net(c[P.potentiel])),
      num(c[P.nPot]), num(c[P.nRec]), num(c[P.nTen]), num(c[P.nGood]), num(c[P.nAcc]), lit(net(c[P.fiabilite])),
    ],
  });
}
const noms = new Set();
for (const p of prospects) {
  if (!p.nom) throw new Error(`Prospect sans nom : ${p.code}`);
  if (noms.has(p.nom.toLowerCase())) throw new Error(`Prospect en double : ${p.nom}`);
  noms.add(p.nom.toLowerCase());
  if (!Object.values(JOURNAUX).includes(p.commerciale)) throw new Error(`Commerciale inconnue pour ${p.code} : ${p.commerciale}`);
}

// --- Visites --------------------------------------------------------------------
// Colonnes : A date (JJ/MM/AAAA, parfois mal saisie), B code client, C nom,
// D référence, E montant (souvent un nom saisi au mauvais endroit), J observation.
// Mots d'action en majuscules qui ne sont pas un nom de société.
const MOTS_ACTION = /^(PROSPECTION|PPROSPECTION|PROSPECT|PROCPECT|VISITE|VISTE|SUIVI|RELANCE|ECHANGE|ENCHANGE|RDV|DEPOT|VALIDATION)$/;

/** Nom en majuscules en tête d'observation : « COFINA visite… », « BMA SA visite… ». */
function nomEnTete(obs) {
  const mots = [];
  for (const m of obs.split(/\s+/)) {
    if (mots.length === 4 || !/^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9'&.\-]*$/.test(m) || MOTS_ACTION.test(m)) break;
    mots.push(m);
  }
  const nom = mots.join(" ");
  return nom.replace(/[^A-ZÀ-Ý]/g, "").length >= 3 ? nom : null;
}

function libelleProspect(c) {
  const obs = net(c[9]) ?? "";
  return (
    net(c[3]) ??
    (net(c[4]) && Number.isNaN(Number(c[4])) ? net(c[4]) : null) ??
    obs.match(/\(\s*([^()]{2,80}?)\s*\)\s*$/)?.[1] ??
    obs.match(/^([^:]{2,60}):/)?.[1]?.trim() ??
    nomEnTete(obs) ??
    null
  );
}

function nature(obs, fourreTout) {
  if (/prosp|procp|propsp/i.test(obs)) return "prospection";
  if (/rel+an/i.test(obs)) return "relance";
  return fourreTout && !/client/i.test(obs) ? "prospection" : "visite";
}

const visites = [];
const datesReparees = [];
for (const [onglet, rep] of Object.entries(JOURNAUX)) {
  let annee = null;
  for (const l of wb[onglet].filter((x) => x.r >= 7 && (x.c[0] || x.c[1]))) {
    const c = l.c;
    const brut = String(c[0] ?? "").trim();
    let m = brut.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    let jour;
    if (m) {
      annee = m[3];
      jour = `${m[3]}-${m[2]}-${m[1]}`;
    } else {
      // Date mal saisie (« 09/06/206 », « 03/082026 ») : jour et mois lus,
      // année reprise de la ligne précédente (journal chronologique).
      m = brut.match(/^(\d{1,2})\/+(\d{2})/);
      if (!m || !annee) throw new Error(`${onglet} ligne ${l.r} : date illisible « ${brut} »`);
      jour = `${annee}-${m[2]}-${m[1].padStart(2, "0")}`;
      datesReparees.push(`${onglet}:${l.r} « ${brut} » → ${jour}`);
    }
    if (Number.isNaN(Date.parse(jour))) throw new Error(`${onglet} ligne ${l.r} : date invalide ${jour}`);

    const code = net(c[1])?.toUpperCase() ?? null;
    const fourreTout = !code || CODES_FOURRE_TOUT.has(code);
    const obs = net(c[9]) ?? "(sans observation)";
    const libelle = fourreTout ? (libelleProspect(c) ?? "Prospect non nommé") : (net(c[2]) ?? code);
    visites.push({
      cols: [lit(`${onglet}:${l.r}`), lit(rep), lit(fourreTout ? null : code), lit(libelle.slice(0, 200)), lit(jour), lit(nature(obs, fourreTout)), lit(obs.slice(0, 4000))],
    });
  }
}

// --- SQL --------------------------------------------------------------------------
const sql = `-- Reprise PLANNING_FINAL → module Prospection (généré le ${new Date().toISOString().slice(0, 10)})
-- ${prospects.length} prospects, ${visites.length} visites. Rejouable sans doublon.
begin;

do $$
begin
  if (select count(distinct r.name) from commerciaux c join sage_representants r on r.co_no = c.sage_representant_no
      where r.name in (${Object.values(JOURNAUX).map(lit).join(", ")})) < ${Object.keys(JOURNAUX).length} then
    raise exception 'Enregistrez d''abord Amy et Miriama comme commerciales (Paramètres > Prospection, collaborateur Sage « Amy » / « Miriama »).';
  end if;
end $$;

create temp table reprise_prospects (code text, nom text, commerciale text, priorite smallint, activite text, famille text,
  axe_offre text, taille text, zone text, localisation text, pourquoi text, offre text, contact_cible text,
  potentiel_libelle text, note_potentiel smallint, note_recurrence smallint, note_tenues smallint, note_goodies smallint,
  note_accessibilite smallint, fiabilite text) on commit drop;

insert into reprise_prospects values
${prospects.map((p) => `  (${[lit(p.code), lit(p.nom), lit(p.commerciale), ...p.cols].join(", ")})`).join(",\n")};

-- Prospects déjà repris (même code) ou homonymes d'une fiche existante : ignorés.
create temp table reprise_ignores on commit drop as
  select s.code, s.nom from reprise_prospects s
  where exists (select 1 from prospects_fiches f where f.code = s.code)
     or exists (select 1 from companies x where lower(x.name) = lower(s.nom));
delete from reprise_prospects s using reprise_ignores i where i.code = s.code;

with nouvelles as (
  insert into companies (name, origin, prospection_etape, prospection_source, commercial_attitre_id)
  select s.nom, 'manuel', 'suspect', 'Étude de ciblage (Excel)', c.app_user_id
  from reprise_prospects s
  join sage_representants r on r.name = s.commerciale
  join commerciaux c on c.sage_representant_no = r.co_no
  returning id, name
)
insert into prospects_fiches (company_id, code, priorite, activite, famille, axe_offre, taille, zone, localisation, pourquoi,
  offre, contact_cible, potentiel_libelle, note_potentiel, note_recurrence, note_tenues, note_goodies, note_accessibilite, fiabilite)
select n.id, s.code, s.priorite, s.activite, s.famille, s.axe_offre, s.taille, s.zone, s.localisation, s.pourquoi,
  s.offre, s.contact_cible, s.potentiel_libelle, s.note_potentiel, s.note_recurrence, s.note_tenues, s.note_goodies,
  s.note_accessibilite, s.fiabilite
from nouvelles n join reprise_prospects s on s.nom = n.name;

create temp table reprise_visites (ref text, commerciale text, code text, libelle text, jour date, nature text, compte_rendu text) on commit drop;

insert into reprise_visites values
${visites.map((v) => `  (${v.cols.join(", ")})`).join(",\n")};

-- Code client inconnu de Seritex : la visite reste « à rattacher » sous son libellé.
insert into visites (company_id, tiers_libelle, app_user_id, jour, nature, compte_rendu, source, ref_externe, created_by)
select co.id, case when co.id is null then s.libelle end, c.app_user_id, s.jour, s.nature, s.compte_rendu, 'reprise_excel', s.ref, null
from reprise_visites s
join sage_representants r on r.name = s.commerciale
join commerciaux c on c.sage_representant_no = r.co_no
left join lateral (select id from companies where s.code is not null and upper(sage_code) = s.code limit 1) co on true
on conflict (ref_externe) do nothing;

select
  (select count(*) from prospects_fiches) as prospects_fiches,
  (select count(*) from reprise_ignores) as prospects_ignores,
  (select string_agg(nom, ', ') from reprise_ignores) as noms_ignores,
  (select count(*) from visites where source = 'reprise_excel') as visites_reprises,
  (select count(*) from visites where source = 'reprise_excel' and company_id is null) as visites_a_rattacher;

commit;
`;

fs.writeFileSync(sortie, sql);
console.log(`${prospects.length} prospects, ${visites.length} visites → ${sortie}`);
if (ignores.length) console.log(`Prospects écartés : ${ignores.join(" ; ")}`);
if (datesReparees.length) console.log(`Dates mal saisies réparées (${datesReparees.length}) :\n  ${datesReparees.join("\n  ")}`);
