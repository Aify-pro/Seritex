// ============================================================================
// sync.js — Synchronisation NAS (miroir Sage) -> Supabase
// ============================================================================
//
// Destine a tourner sur le NAS (Docker), planifie via le Planificateur de
// taches DSM. Lit les tables Sage deja miroirees sur le NAS (SAGE_SERITEX,
// alimentees depuis Sage par le pont VM decrit dans le depot) et alimente
// les 3 tables miroir Supabase prevues depuis la migration 0005 :
//   - sage_customers_view  (clients Sage, filtre CG_NumPrinc LIKE '411%'),
//                            puis rattachement a `companies` via la fonction
//                            SQL sync_companies_from_sage() (migration 0059)
//   - sage_representants   (commerciaux Sage, pour afficher/filtrer les clients)
//   - sage_articles_view   (articles des familles MP/SF/PF uniquement)
//   - stock_item_view      (stock reel/reserve par article ET par depot,
//                            migration 0058)
//   - sage_quotes_view / sage_quote_lines_view (devis Sage EN COURS : documents
//                            de vente de type devis, pas encore transformes ;
//                            migration 0071)
//
// Remplacement complet a chaque passage (upsert + suppression des lignes
// disparues cote Sage) : volumes modestes (quelques milliers de lignes),
// largement supportable sans passer par un diff incremental.
//
// Categorisation matiere premiere/semi-fini/produit fini : la famille Sage
// "MP" (matiere premiere) n'est aujourd'hui pas correctement sous-classee
// en tissu/fil/encre (melange aleatoire, confirme avec l'utilisateur) - tout
// part donc en 'en_attente_classement', a affiner manuellement plus tard
// dans Seritex (Parametres > Stock), meme principe que linked_company_id /
// linked_product_model_id. Une codification definitive reste a construire
// avec l'utilisateur (matiere premiere ET semi-fini/produit fini).
// ============================================================================

require("dotenv").config();
const sql = require("mssql");
const { createClient } = require("@supabase/supabase-js");

const nasConfig = {
  server: process.env.NAS_SQL_HOST,
  port: parseInt(process.env.NAS_SQL_PORT || "1433", 10),
  database: process.env.NAS_SQL_DATABASE,
  user: process.env.NAS_SQL_USER,
  password: process.env.NAS_SQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

for (const key of ["NAS_SQL_HOST", "NAS_SQL_DATABASE", "NAS_SQL_USER", "NAS_SQL_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Variable d'environnement manquante : ${key} (voir .env.example)`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Familles Sage a synchroniser (matiere premiere / semi-fini / produit fini) —
// decide avec l'utilisateur. Le reste (fourniture atelier, bureau, guide,
// SAV, marchandise...) ne concerne pas Seritex.
const FAMILLES_SUIVIES = ["MP", "SF", "PF"];
const FAMILLES_SQL = FAMILLES_SUIVIES.map((f) => `'${f}'`).join(",");

function categoriePourFamille(_codeFamille) {
  // Aucune des 3 familles suivies ne correspond proprement aujourd'hui a
  // tissu/fil/encre/consommable cote Sage — voir commentaire en tete de
  // fichier et migration 0058.
  return "en_attente_classement";
}

function trimOrNull(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

// Les dates vides de Sage valent 1753-01-01 (ou 1899-12-30 selon les champs) :
// on les traite comme "pas de date".
function dateOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return null;
  return d.toISOString();
}

async function syncClients(pool) {
  // Les colonnes libres Sage contiennent un "/" ou un espace : crochets obligatoires.
  const result = await pool.request().query(`
    SELECT CT_Num, CT_Intitule, CT_Siret, CT_Identifiant, CT_Ape,
           CT_Adresse, CT_Complement, CT_CodePostal, CT_Ville, CT_Pays,
           CT_Telephone, CT_EMail, CT_Site, CT_Sommeil, CT_Prospect,
           FAMILLE, [S/FAMILLE] AS SOUS_FAMILLE, CATEGORIE, [Typologie client] AS TYPOLOGIE,
           CO_No, cbCreation
    FROM F_COMPTET
    WHERE CG_NumPrinc LIKE '411%'
  `);

  const now = new Date().toISOString();
  const rows = result.recordset.map((r) => ({
    sage_code: String(r.CT_Num).trim(),
    name: trimOrNull(r.CT_Intitule) || "(sans nom)",
    siret: trimOrNull(r.CT_Siret),
    // Rue + complement uniquement : CP, ville et pays ont leurs propres
    // colonnes (filtrage cote Seritex, migration 0059).
    address:
      [r.CT_Adresse, r.CT_Complement]
        .map((v) => trimOrNull(v))
        .filter(Boolean)
        .join(", ") || null,
    postal_code: trimOrNull(r.CT_CodePostal),
    city: trimOrNull(r.CT_Ville),
    country: trimOrNull(r.CT_Pays),
    phone: trimOrNull(r.CT_Telephone),
    email: trimOrNull(r.CT_EMail),
    website: trimOrNull(r.CT_Site),
    vat_number: trimOrNull(r.CT_Identifiant),
    ape_code: trimOrNull(r.CT_Ape),
    is_active: Number(r.CT_Sommeil) === 0,
    is_prospect: Number(r.CT_Prospect) === 1,
    famille: trimOrNull(r.FAMILLE),
    sous_famille: trimOrNull(r.SOUS_FAMILLE),
    categorie: trimOrNull(r.CATEGORIE),
    typologie: trimOrNull(r.TYPOLOGIE),
    representant_no: r.CO_No !== null && r.CO_No !== undefined && Number(r.CO_No) > 0 ? Number(r.CO_No) : null,
    sage_created_at: dateOrNull(r.cbCreation),
    last_sync_at: now,
  }));

  await upsertAndPrune("sage_customers_view", ["sage_code"], rows);
  console.log(`Clients : ${rows.length} synchronises (table miroir).`);

  // Rattachement aux fiches Seritex (`companies`) : cree les nouveaux clients,
  // met a jour les champs Sage, archive ceux disparus de Sage (jamais de
  // suppression). Ne touche ni aux contacts ni aux notes.
  const { data, error } = await supabase.rpc("sync_companies_from_sage");
  if (error) throw new Error(`Rattachement companies : ${error.message}`);
  console.log(
    `Fiches clients : ${data.creees} creee(s), ${data.mises_a_jour} mise(s) a jour, ` +
      `${data.reprises} reprise(s) de rapprochement, ${data.archivees} archivee(s).`,
  );
}

// Commerciaux / collaborateurs Sage (F_COLLABORATEUR) : sert uniquement a
// afficher le nom du commercial d'un client et a filtrer la liste (migration
// 0060). Sage range souvent les anciens collaborateurs sous un nom prefixe par
// "Z" : on garde le libelle tel quel (Nom puis Prenom) pour rester reconnaissable.
async function syncRepresentants(pool) {
  const result = await pool.request().query(`
    SELECT CO_No, CO_Nom, CO_Prenom
    FROM F_COLLABORATEUR
  `);

  const now = new Date().toISOString();
  const rows = result.recordset
    .filter((r) => r.CO_No !== null && r.CO_No !== undefined)
    .map((r) => ({
      co_no: Number(r.CO_No),
      name: [r.CO_Nom, r.CO_Prenom].map((v) => trimOrNull(v)).filter(Boolean).join(" ") || `Collaborateur ${r.CO_No}`,
      last_sync_at: now,
    }));

  await upsertAndPrune("sage_representants", ["co_no"], rows);
  console.log(`Commerciaux : ${rows.length} synchronises.`);
}

async function syncArticles(pool) {
  const result = await pool.request().query(`
    SELECT AR_Ref, AR_Design, FA_CodeFamille, AR_UniteVen, AR_PrixVen, AR_Sommeil
    FROM F_ARTICLE
    WHERE FA_CodeFamille IN (${FAMILLES_SQL})
  `);

  const now = new Date().toISOString();
  const rows = result.recordset.map((r) => ({
    sage_reference: String(r.AR_Ref).trim(),
    designation: trimOrNull(r.AR_Design) || "(sans designation)",
    category: categoriePourFamille(r.FA_CodeFamille),
    unit: r.AR_UniteVen !== null && r.AR_UniteVen !== undefined ? String(r.AR_UniteVen).trim() : null,
    sale_price: r.AR_PrixVen !== null ? Number(r.AR_PrixVen) : null,
    active: Number(r.AR_Sommeil) === 0,
    last_sync_at: now,
  }));

  await upsertAndPrune("sage_articles_view", ["sage_reference"], rows);
  console.log(`Articles : ${rows.length} synchronises.`);
}

async function syncStock(pool) {
  const result = await pool.request().query(`
    SELECT s.AR_Ref, s.DE_No, s.AS_QteSto, s.AS_QteRes, a.AR_Design, a.FA_CodeFamille, a.AR_UniteVen
    FROM F_ARTSTOCK s
    JOIN F_ARTICLE a ON a.AR_Ref = s.AR_Ref
    WHERE a.FA_CodeFamille IN (${FAMILLES_SQL})
  `);

  const now = new Date().toISOString();
  const rows = result.recordset.map((r) => {
    const reelle = Number(r.AS_QteSto) || 0;
    const reservee = Number(r.AS_QteRes) || 0;
    return {
      sage_reference: String(r.AR_Ref).trim(),
      warehouse: String(r.DE_No).trim(),
      designation: trimOrNull(r.AR_Design) || "(sans designation)",
      category: categoriePourFamille(r.FA_CodeFamille),
      // stock_item_view.unit est NOT NULL ; F_ARTSTOCK n'a pas d'unite propre,
      // on reprend celle de l'article (code brut Sage, cf. syncArticles —
      // aucune correspondance connue vers un libelle, P_UNITE est vide).
      // Chaine vide plutot que null si l'article n'en a aucune.
      unit: r.AR_UniteVen !== null && r.AR_UniteVen !== undefined ? String(r.AR_UniteVen).trim() : "",
      quantite_reelle: reelle,
      quantite_reservee: reservee,
      quantity_available: reelle - reservee,
      last_sync_at: now,
    };
  });

  await upsertAndPrune("stock_item_view", ["sage_reference", "warehouse"], rows);
  console.log(`Stock : ${rows.length} ligne(s) synchronisee(s).`);
}

// Devis Sage en cours : documents de vente (DO_Domaine = 0) de type devis
// (DO_Type = 0) qui existent encore comme devis. Une fois transforme en
// commande/BL/facture, ou purge apres un refus, le devis disparait de Sage et
// donc du miroir (meme logique de remplacement complet que le reste).
//
// Les colonnes obligatoires sont verifiees avant la requete, avec un message
// qui les nomme : un ecart de version Sage ne doit pas se traduire par une
// erreur SQL opaque. Les colonnes facultatives (reference client, commercial,
// devise, livraison, statut, taxe) sont simplement ignorees si absentes.
async function colonnesDe(pool, table) {
  const r = await pool
    .request()
    .input("t", sql.VarChar, table)
    .query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t");
  return new Set(r.recordset.map((x) => x.COLUMN_NAME));
}

function exigerColonnes(table, presentes, requises) {
  const manquantes = requises.filter((c) => !presentes.has(c));
  if (manquantes.length > 0) {
    throw new Error(`${table} : colonne(s) introuvable(s) sur le NAS : ${manquantes.join(", ")}`);
  }
}

function dateJour(v) {
  const iso = dateOrNull(v);
  return iso ? iso.slice(0, 10) : null;
}

async function syncDevis(pool) {
  const enteteCols = await colonnesDe(pool, "F_DOCENTETE");
  const ligneCols = await colonnesDe(pool, "F_DOCLIGNE");
  if (enteteCols.size === 0 || ligneCols.size === 0) {
    throw new Error("F_DOCENTETE / F_DOCLIGNE absentes de la base miroir du NAS (documents de vente non copies).");
  }
  exigerColonnes("F_DOCENTETE", enteteCols, ["DO_Domaine", "DO_Type", "DO_Piece", "DO_Date", "DO_Tiers", "DO_TotalHT", "DO_TotalTTC"]);
  exigerColonnes("F_DOCLIGNE", ligneCols, ["DO_Domaine", "DO_Type", "DO_Piece", "DL_Ligne", "DL_Design", "DL_Qte", "DL_PrixUnitaire", "DL_MontantHT", "AR_Ref"]);

  const optE = ["DO_Ref", "CO_No", "DO_Devise", "DO_DateLivr", "DO_Statut"].filter((c) => enteteCols.has(c));
  const entetes = await pool.request().query(`
    SELECT DO_Piece, DO_Date, DO_Tiers, DO_TotalHT, DO_TotalTTC${optE.map((c) => `, ${c}`).join("")}
    FROM F_DOCENTETE
    WHERE DO_Domaine = 0 AND DO_Type = 0
  `);

  const now = new Date().toISOString();
  const piecesEntete = new Set();
  const headerRows = [];
  for (const r of entetes.recordset) {
    const piece = trimOrNull(r.DO_Piece);
    const tiers = trimOrNull(r.DO_Tiers);
    if (!piece || !tiers) continue;
    piecesEntete.add(piece);
    headerRows.push({
      sage_piece: piece,
      doc_date: dateJour(r.DO_Date),
      client_ref: trimOrNull(r.DO_Ref),
      client_sage_code: tiers,
      representant_no: r.CO_No !== null && r.CO_No !== undefined && Number(r.CO_No) > 0 ? Number(r.CO_No) : null,
      devise_no: r.DO_Devise !== null && r.DO_Devise !== undefined ? Number(r.DO_Devise) : null,
      total_ht: Number(r.DO_TotalHT) || 0,
      total_ttc: Number(r.DO_TotalTTC) || 0,
      date_livraison: dateJour(r.DO_DateLivr),
      statut: r.DO_Statut !== null && r.DO_Statut !== undefined ? Number(r.DO_Statut) : null,
      last_sync_at: now,
    });
  }

  // Cle de ligne : DL_No (identifiant unique Sage) si present, sinon DL_Ligne.
  const cleLigne = ligneCols.has("DL_No") ? "DL_No" : "DL_Ligne";
  const optL = ["DL_No", "DL_Taxe1"].filter((c) => ligneCols.has(c));
  // Hors lignes de commentaire / titre : quantite nulle ou designation vide.
  const lignes = await pool.request().query(`
    SELECT DO_Piece, DL_Ligne, DL_Design, DL_Qte, DL_PrixUnitaire, DL_MontantHT, AR_Ref${optL.map((c) => `, ${c}`).join("")}
    FROM F_DOCLIGNE
    WHERE DO_Domaine = 0 AND DO_Type = 0 AND DL_Qte > 0 AND LTRIM(RTRIM(ISNULL(DL_Design, ''))) <> ''
  `);

  const lineRows = [];
  const dejaVues = new Set();
  for (const r of lignes.recordset) {
    const piece = trimOrNull(r.DO_Piece);
    if (!piece || !piecesEntete.has(piece)) continue;
    const quantite = Number(r.DL_Qte) || 0;
    const pu = Number(r.DL_PrixUnitaire) || 0;
    const montant = Number(r.DL_MontantHT) || 0;
    // Remise effective, quel que soit son type Sage (pourcentage, montant, remises
    // cumulees) : ecart entre le brut et le montant HT de la ligne.
    const brut = quantite * pu;
    let remise = brut > 0 ? (1 - montant / brut) * 100 : 0;
    remise = Math.min(100, Math.max(0, Math.round(remise * 100) / 100));
    const numero = Number(r[cleLigne]);
    const cle = `${piece}|${numero}`;
    if (dejaVues.has(cle)) continue;
    dejaVues.add(cle);
    lineRows.push({
      sage_piece: piece,
      line_no: numero,
      position: Number(r.DL_Ligne) || 0,
      ar_ref: trimOrNull(r.AR_Ref),
      designation: trimOrNull(r.DL_Design) || "(sans designation)",
      quantity: quantite,
      unit_price: pu,
      remise_pct: remise,
      tva_rate: r.DL_Taxe1 !== null && r.DL_Taxe1 !== undefined ? Number(r.DL_Taxe1) : null,
      total_ht: montant,
    });
  }

  // En-tetes d'abord (cle etrangere), lignes ensuite ; la suppression d'un
  // en-tete disparu emporte ses lignes (on delete cascade), puis on retire les
  // lignes disparues d'un devis qui existe toujours.
  await upsertAndPrune("sage_quotes_view", ["sage_piece"], headerRows);
  await upsertAndPrune("sage_quote_lines_view", ["sage_piece", "line_no"], lineRows);
  console.log(`Devis Sage en cours : ${headerRows.length} devis, ${lineRows.length} ligne(s) synchronises.`);
}

// Upsert de toutes les lignes actuelles, puis suppression des lignes
// existantes en base qui n'apparaissent plus dans le resultat Sage
// (remplacement complet, pas de suivi incremental pour ce volume).
async function upsertAndPrune(table, keyColumns, rows) {
  // Par paquets : les lignes de devis se comptent en dizaines de milliers, une
  // seule requete depasserait la taille acceptee par l'API.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: keyColumns.join(",") });
    if (error) throw new Error(`Upsert ${table} : ${error.message}`);
  }

  const { data: existing, error: selError } = await supabase.from(table).select(keyColumns.join(","));
  if (selError) throw new Error(`Lecture ${table} : ${selError.message}`);

  const keyOf = (r) => keyColumns.map((c) => String(r[c])).join("|");
  const currentKeys = new Set(rows.map(keyOf));
  const toDelete = (existing || []).filter((r) => !currentKeys.has(keyOf(r)));

  for (const row of toDelete) {
    let query = supabase.from(table).delete();
    for (const c of keyColumns) query = query.eq(c, row[c]);
    const { error } = await query;
    if (error) throw new Error(`Suppression ${table} : ${error.message}`);
  }

  if (toDelete.length > 0) {
    console.log(`${table} : ${toDelete.length} ligne(s) supprimee(s) (disparue(s) de Sage).`);
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Debut synchronisation NAS -> Supabase`);
  const pool = await sql.connect(nasConfig);
  try {
    await syncRepresentants(pool);
    await syncClients(pool);
    await syncArticles(pool);
    await syncStock(pool);
    // Isole : un probleme sur les devis (colonne absente, documents de vente
    // non copies sur le NAS) ne doit pas empecher clients / articles / stock.
    // Le code de sortie signale quand meme l'echec (alerte e-mail DSM).
    try {
      await syncDevis(pool);
    } catch (err) {
      console.error("ERREUR devis Sage :", err.message);
      process.exitCode = 1;
    }
  } finally {
    await pool.close();
  }
  console.log(`[${new Date().toISOString()}] Synchronisation terminee.`);
}

main().catch((err) => {
  console.error("ERREUR :", err.message);
  process.exit(1);
});
