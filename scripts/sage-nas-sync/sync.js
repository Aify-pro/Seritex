// ============================================================================
// sync.js — Synchronisation NAS (miroir Sage) -> Supabase
// ============================================================================
//
// Destine a tourner sur le NAS (Docker), planifie via le Planificateur de
// taches DSM. Lit les tables Sage deja miroirees sur le NAS (SAGE_SERITEX,
// alimentees depuis Sage par le pont VM decrit dans le depot) et alimente
// les 3 tables miroir Supabase prevues depuis la migration 0005 :
//   - sage_customers_view  (clients Sage, filtre CG_NumPrinc LIKE '411%')
//   - sage_articles_view   (articles des familles MP/SF/PF uniquement)
//   - stock_item_view      (stock reel/reserve par article ET par depot,
//                            migration 0058)
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

async function syncClients(pool) {
  const result = await pool.request().query(`
    SELECT CT_Num, CT_Intitule, CT_Siret, CT_Adresse, CT_Complement,
           CT_CodePostal, CT_Ville, CT_Pays, CT_Telephone, CT_EMail
    FROM F_COMPTET
    WHERE CG_NumPrinc LIKE '411%'
  `);

  const now = new Date().toISOString();
  const rows = result.recordset.map((r) => ({
    sage_code: String(r.CT_Num).trim(),
    name: trimOrNull(r.CT_Intitule) || "(sans nom)",
    siret: trimOrNull(r.CT_Siret),
    address:
      [r.CT_Adresse, r.CT_Complement, r.CT_CodePostal, r.CT_Ville, r.CT_Pays]
        .map((v) => trimOrNull(v))
        .filter(Boolean)
        .join(", ") || null,
    phone: trimOrNull(r.CT_Telephone),
    email: trimOrNull(r.CT_EMail),
    last_sync_at: now,
  }));

  await upsertAndPrune("sage_customers_view", ["sage_code"], rows);
  console.log(`Clients : ${rows.length} synchronises.`);
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
    SELECT s.AR_Ref, s.DE_No, s.AS_QteSto, s.AS_QteRes, a.AR_Design, a.FA_CodeFamille
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
      unit: null,
      quantite_reelle: reelle,
      quantite_reservee: reservee,
      quantity_available: reelle - reservee,
      last_sync_at: now,
    };
  });

  await upsertAndPrune("stock_item_view", ["sage_reference", "warehouse"], rows);
  console.log(`Stock : ${rows.length} ligne(s) synchronisee(s).`);
}

// Upsert de toutes les lignes actuelles, puis suppression des lignes
// existantes en base qui n'apparaissent plus dans le resultat Sage
// (remplacement complet, pas de suivi incremental pour ce volume).
async function upsertAndPrune(table, keyColumns, rows) {
  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: keyColumns.join(",") });
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
    await syncClients(pool);
    await syncArticles(pool);
    await syncStock(pool);
  } finally {
    await pool.close();
  }
  console.log(`[${new Date().toISOString()}] Synchronisation terminee.`);
}

main().catch((err) => {
  console.error("ERREUR :", err.message);
  process.exit(1);
});
