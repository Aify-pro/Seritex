// @ts-nocheck -- script exécuté hors build Next.js (tsx) ; la chaîne
// d'inférence générique de supabase-js sans Database typé produit ici des
// faux positifs TS7022 sur des inserts pourtant valides à l'exécution.
/**
 * Seed de démonstration Seritex.
 *
 * Crée des comptes Supabase Auth pour chaque rôle (via l'API admin, donc avec
 * la clé service_role — ne jamais exposer cette clé côté client) et des
 * données métier représentatives (entreprises, sections, gamme opératoire,
 * demandes, devis, échantillon, ordre de fabrication en cours).
 *
 * Usage : npm run seed   (nécessite .env.local avec les clés Supabase)
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Variables manquantes : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies dans .env.local"
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = "Seritex2026!"; // Compte de démonstration uniquement — à changer en production

type DemoUser = {
  email: string;
  full_name: string;
  role:
    | "client"
    | "commercial"
    | "infographiste"
    | "responsable_production"
    | "chef_section"
    | "administrateur";
  companyKey?: string;
  sectionName?: string;
};

async function upsertAuthUser(email: string, fullName: string) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email === email);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  console.log("→ Sections");
  const sectionNames = ["Coupe", "Sérigraphie", "Confection"];
  const sectionIds: Record<string, string> = {};
  for (const [i, name] of sectionNames.entries()) {
    const { data, error } = await admin
      .from("sections")
      .upsert({ name, display_order: i + 1, active: true }, { onConflict: "name" })
      .select()
      .single();
    if (error) throw error;
    sectionIds[name] = data.id;
  }

  console.log("→ Gamme opératoire");
  const { data: routing, error: routingErr } = await admin
    .from("routing_templates")
    .insert({ name: "T-shirt sérigraphié standard" })
    .select()
    .single();
  if (routingErr) throw routingErr;

  const stepsInput = [
    { section: "Coupe", order: 1, duration: 45 },
    { section: "Sérigraphie", order: 2, duration: 90 },
    { section: "Confection", order: 3, duration: 60 },
  ];
  const stepIds: string[] = [];
  let prevStepId: string | null = null;
  for (const s of stepsInput) {
    const { data, error } = await admin
      .from("routing_steps")
      .insert({
        routing_template_id: routing.id,
        section_id: sectionIds[s.section],
        sequence_order: s.order,
        depends_on_step_id: prevStepId,
        standard_duration_minutes: s.duration,
        instructions: `Étape ${s.section} — gamme standard T-shirt sérigraphié.`,
      })
      .select()
      .single();
    if (error) throw error;
    stepIds.push(data.id);
    prevStepId = data.id;
  }

  console.log("→ Catalogue produit");
  const { data: product, error: productErr } = await admin
    .from("product_models")
    .insert({
      name: "T-shirt col rond 180g",
      category: "T-shirt",
      base_price: 3500,
      routing_template_id: routing.id,
    })
    .select()
    .single();
  if (productErr) throw productErr;

  await admin.from("product_zones").insert([
    { product_model_id: product.id, name: "Devant" },
    { product_model_id: product.id, name: "Dos" },
    { product_model_id: product.id, name: "Manche gauche" },
  ]);

  console.log("→ Entreprises clientes");
  const { data: companyA } = await admin
    .from("companies")
    .insert({
      name: "Ivoire Sport Distribution",
      address: "Zone 4, Abidjan",
      phone: "+225 07 00 00 00 01",
      email: "contact@ivoiresport.example",
    })
    .select()
    .single();

  const { data: companyB } = await admin
    .from("companies")
    .insert({
      name: "Cotonivoire Textile Corp",
      address: "Yopougon, Abidjan",
      phone: "+225 07 00 00 00 02",
      email: "contact@cotonivoire.example",
    })
    .select()
    .single();

  const { data: prospect } = await admin
    .from("companies")
    .insert({ name: "Nouvelle Ère Events", email: "hello@nouvelleere.example" })
    .select()
    .single();

  const { data: contactA } = await admin
    .from("contacts")
    .insert({
      company_id: companyA!.id,
      first_name: "Aïcha",
      last_name: "Koné",
      email: "aicha.kone@ivoiresport.example",
      role_title: "Responsable achats",
    })
    .select()
    .single();

  const { data: contactB } = await admin
    .from("contacts")
    .insert({
      company_id: companyB!.id,
      first_name: "Moussa",
      last_name: "Traoré",
      email: "moussa.traore@cotonivoire.example",
      role_title: "Directeur opérations",
    })
    .select()
    .single();

  console.log("→ Comptes utilisateurs de démonstration");
  const demoUsers: DemoUser[] = [
    { email: "admin@seritex.local", full_name: "Awa Bamba", role: "administrateur" },
    { email: "commercial@seritex.local", full_name: "Fatou Diarra", role: "commercial" },
    { email: "infographiste@seritex.local", full_name: "Yacouba Sanogo", role: "infographiste" },
    {
      email: "production@seritex.local",
      full_name: "Ibrahim Coulibaly",
      role: "responsable_production",
    },
    {
      email: "coupe@seritex.local",
      full_name: "Chef Coupe",
      role: "chef_section",
      sectionName: "Coupe",
    },
    {
      email: "serigraphie@seritex.local",
      full_name: "Chef Sérigraphie",
      role: "chef_section",
      sectionName: "Sérigraphie",
    },
    {
      email: "confection@seritex.local",
      full_name: "Chef Confection",
      role: "chef_section",
      sectionName: "Confection",
    },
    {
      email: "client@ivoiresport.example",
      full_name: "Aïcha Koné",
      role: "client",
      companyKey: "A",
    },
    {
      email: "client@cotonivoire.example",
      full_name: "Moussa Traoré",
      role: "client",
      companyKey: "B",
    },
  ];

  const companyByKey: Record<string, string> = {
    A: companyA!.id,
    B: companyB!.id,
  };

  const userIds: Record<string, string> = {};
  for (const u of demoUsers) {
    const id = await upsertAuthUser(u.email, u.full_name);
    userIds[u.email] = id;
    const { error } = await admin.from("app_users").upsert(
      {
        id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        company_id: u.companyKey ? companyByKey[u.companyKey] : null,
        section_id: u.sectionName ? sectionIds[u.sectionName] : null,
        active: true,
      },
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  const commercialId = userIds["commercial@seritex.local"];

  console.log("→ Demandes, devis, échantillons");
  const { data: req1 } = await admin
    .from("requests")
    .insert({
      reference: "REQ-2026-0001",
      company_id: companyA!.id,
      contact_id: contactA!.id,
      assigned_commercial_id: commercialId,
      status: "devis_envoye",
      description: "500 T-shirts col rond floqués logo Ivoire Sport, événement du 20/09.",
      needs_graphics: true,
    })
    .select()
    .single();

  const { data: quote1 } = await admin
    .from("quotes")
    .insert({
      reference: "DEV-2026-0001",
      request_id: req1!.id,
      company_id: companyA!.id,
      status: "envoye",
      total_amount: 1750000,
      created_by: commercialId,
    })
    .select()
    .single();
  await admin.from("quote_lines").insert({
    quote_id: quote1!.id,
    product_model_id: product.id,
    description: "T-shirt col rond 180g, marquage sérigraphie 1 couleur",
    quantity: 500,
    unit_price: 3500,
  });

  const { data: req2 } = await admin
    .from("requests")
    .insert({
      reference: "REQ-2026-0002",
      company_id: companyB!.id,
      contact_id: contactB!.id,
      assigned_commercial_id: commercialId,
      status: "acceptee",
      description: "1000 T-shirts col rond pour campagne coton local.",
    })
    .select()
    .single();

  const { data: quote2 } = await admin
    .from("quotes")
    .insert({
      reference: "DEV-2026-0002",
      request_id: req2!.id,
      company_id: companyB!.id,
      status: "accepte",
      total_amount: 3200000,
      created_by: commercialId,
    })
    .select()
    .single();
  await admin.from("quote_lines").insert({
    quote_id: quote2!.id,
    product_model_id: product.id,
    description: "T-shirt col rond 180g, marquage sérigraphie 2 couleurs",
    quantity: 1000,
    unit_price: 3200,
  });

  await admin.from("requests").insert({
    reference: "REQ-2026-0003",
    company_id: prospect!.id,
    assigned_commercial_id: commercialId,
    status: "nouvelle",
    description: "Demande entrante via portail — informations à qualifier.",
  });

  console.log("→ Ordre de fabrication + ordres de travail (démo pilotage atelier)");
  const { data: po } = await admin
    .from("production_orders")
    .insert({
      reference: "OF-2026-0002",
      quote_id: quote2!.id,
      company_id: companyB!.id,
      status: "en_cours",
      total_quantity: 1000,
      planned_start_date: "2026-08-20",
      planned_end_date: "2026-09-05",
      created_by: userIds["production@seritex.local"],
    })
    .select()
    .single();

  const { data: wo1 } = await admin
    .from("work_orders")
    .insert({
      reference: "OF-2026-0002-OT1",
      production_order_id: po!.id,
      section_id: sectionIds["Coupe"],
      routing_step_id: stepIds[0],
      status: "termine",
      quantity_planned: 1000,
      quantity_done: 1000,
      assigned_section_chief_id: userIds["coupe@seritex.local"],
      actual_start: "2026-08-20T08:00:00Z",
      actual_end: "2026-08-21T16:00:00Z",
    })
    .select()
    .single();

  const { data: wo2 } = await admin
    .from("work_orders")
    .insert({
      reference: "OF-2026-0002-OT2",
      production_order_id: po!.id,
      section_id: sectionIds["Sérigraphie"],
      routing_step_id: stepIds[1],
      predecessor_work_order_id: wo1!.id,
      status: "en_cours",
      quantity_planned: 1000,
      quantity_done: 400,
      assigned_section_chief_id: userIds["serigraphie@seritex.local"],
      actual_start: "2026-08-22T08:00:00Z",
    })
    .select()
    .single();

  await admin.from("work_orders").insert({
    reference: "OF-2026-0002-OT3",
    production_order_id: po!.id,
    section_id: sectionIds["Confection"],
    routing_step_id: stepIds[2],
    predecessor_work_order_id: wo2!.id,
    status: "en_attente",
    quantity_planned: 1000,
    quantity_done: 0,
  });

  await admin.from("work_order_events").insert([
    {
      work_order_id: wo1!.id,
      event_type: "demarre",
      user_id: userIds["coupe@seritex.local"],
      occurred_at: "2026-08-20T08:00:00Z",
    },
    {
      work_order_id: wo1!.id,
      event_type: "termine",
      user_id: userIds["coupe@seritex.local"],
      quantity: 1000,
      occurred_at: "2026-08-21T16:00:00Z",
    },
    {
      work_order_id: wo2!.id,
      event_type: "demarre",
      user_id: userIds["serigraphie@seritex.local"],
      occurred_at: "2026-08-22T08:00:00Z",
    },
  ]);

  console.log("→ Demande d'échantillon");
  await admin.from("sample_requests").insert({
    reference: "ECH-2026-0001",
    company_id: companyA!.id,
    contact_id: contactA!.id,
    created_by_user_id: commercialId,
    need_description: "Échantillon T-shirt 180g avant commande ferme, coloris à valider.",
    quantity_requested: 3,
    status: "en_fabrication",
    due_date: "2026-09-03",
  });

  console.log("→ Vue stock Sage (mock lecture seule)");
  await admin.from("stock_item_view").upsert(
    [
      {
        sage_reference: "TIS-COT-180",
        designation: "Tissu coton 180g blanc",
        category: "tissu",
        unit: "kg",
        quantity_available: 420.5,
        warehouse: "Entrepôt principal",
      },
      {
        sage_reference: "ENC-SER-NOIR",
        designation: "Encre sérigraphie noire",
        category: "encre",
        unit: "L",
        quantity_available: 18,
        warehouse: "Atelier sérigraphie",
      },
      {
        sage_reference: "FIL-POLY-BLC",
        designation: "Fil polyester blanc",
        category: "fil",
        unit: "cône",
        quantity_available: 260,
        warehouse: "Entrepôt principal",
      },
    ],
    { onConflict: "sage_reference" }
  );

  console.log("\n✔ Seed terminé.");
  console.log("\nComptes de démonstration (mot de passe : " + DEMO_PASSWORD + ") :");
  for (const u of demoUsers) {
    console.log(`  - ${u.email}  →  ${u.role}${u.sectionName ? " (" + u.sectionName + ")" : ""}`);
  }
}

main().catch((err) => {
  console.error("Erreur pendant le seed :", err);
  process.exit(1);
});
