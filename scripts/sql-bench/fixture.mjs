import { boot } from "./harness.mjs";

// Un échec affiche son seul message (pas la pile de PGlite, illisible).
process.on("unhandledRejection", (e) => {
  console.error("✗", e?.message ?? e, e?.where ? `\n  ${e.where}` : "");
  process.exit(1);
});

export async function setup(opts = {}) {
  const db = await boot({ quiet: true, ...opts });
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const as = async (uid) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  const mkUser = async (roleKey, extra = {}) => {
    const id = crypto.randomUUID();
    await q(`insert into auth.users(id,email) values ($1,$2)`, [id, `${roleKey}-${id.slice(0, 4)}@t.ci`]);
    const role = await one(`select id from roles where key=$1`, [roleKey]);
    await q(
      `insert into app_users(id,email,full_name,role,role_id,section_id,company_id) values ($1,$2,$3,(select base_role from roles where key=$4),$5,$6,$7)`,
      [id, `${roleKey}@t.ci`, roleKey, roleKey, role.id, extra.section_id ?? null, extra.company_id ?? null]
    );
    return id;
  };
  const expectFail = async (fn, re) => {
    try { await fn(); } catch (e) {
      if (re && !re.test(e.message)) throw new Error(`message inattendu: ${e.message}`);
      return e.message;
    }
    throw new Error("aurait dû échouer" + (re ? " : " + re : ""));
  };
  return { db, q, one, as, mkUser, expectFail };
}

let n = 0;
export async function test(name, fn) {
  await fn();
  n += 1;
  console.log(`✓ ${name}`);
}

/** Crée un ODF lancé simple : 1 ligne, sections données (noms), tailles {cle: qte}. */
export async function makeOdf(ctx, { admin, company, sections, sizes, couleur = true, status = "brouillon" }) {
  const { q, one } = ctx;
  const model = await one(`insert into product_models(name) values ('T-shirt test') returning id`);
  const color = await one(`insert into colors(name, code) values ('Blanc'||substr(gen_random_uuid()::text,1,4), 'BL'||substr(gen_random_uuid()::text,1,4)) returning id`);
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const po = await one(
    `insert into production_orders(reference, company_id, total_quantity, status, comptabilite_validee_le, comptabilite_validee_par)
     values ('OF-T-'||substr(gen_random_uuid()::text,1,6), $1, $2, $3, now(), $4) returning *`,
    [company, total, status, admin]
  );
  const line = await one(
    `insert into production_order_lines(production_order_id, product_model_id, description, quantity, couleur_unique_id)
     values ($1,$2,'T-shirt blanc',$3,$4) returning *`,
    [po.id, model.id, total, couleur ? color.id : null]
  );
  let ordre = 0;
  for (const s of sections) {
    const spec = typeof s === "string" ? { name: s } : s;
    const sec = await one(`select id from sections where name=$1`, [spec.name]);
    ordre += 1;
    await q(
      `insert into production_order_line_sections(production_order_line_id, section_id, ordre, etape, partie, quantite) values ($1,$2,$3,$4,$5,$6)`,
      [line.id, sec.id, ordre, spec.etape ?? ordre, spec.partie ?? null, spec.quantite ?? null]
    );
  }
  for (const [cle, qte] of Object.entries(sizes)) {
    await q(`insert into production_order_sizes(production_order_line_id, taille, quantite_demandee) values ($1,$2,$3)`, [line.id, cle, qte]);
  }
  return { po, line, model, color };
}
