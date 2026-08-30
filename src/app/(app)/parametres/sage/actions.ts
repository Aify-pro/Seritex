"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const configSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  sync_mode: z.enum(["simulation", "agent_local"]),
  host: z.string().trim().optional(),
  port: z.coerce.number().int().positive().optional(),
  database_name: z.string().trim().optional(),
  schema_stock: z.string().trim().optional(),
  schema_clients: z.string().trim().optional(),
  schema_articles: z.string().trim().optional(),
  sync_frequency_minutes: z.coerce.number().int().positive().default(60),
});

/**
 * Enregistre les paramètres de connexion Sage — ne CONNECTE encore rien
 * (`sync_mode` reste `simulation` tant que l'application locale de
 * synchronisation, hors périmètre de ce chantier, n'existe pas). Ce qui est
 * intégré dès maintenant, c'est la logique et le modèle de données : dès
 * que cette application sera prête, elle n'aura qu'à écrire dans
 * `stock_item_view` / `sage_customers_view` / `sage_articles_view` avec les
 * paramètres définis ici (hôte, base, schémas), sans rien changer côté
 * interface.
 */
export async function updateSageConnectionConfig(formData: FormData) {
  await requireRole(["administrateur"]);
  const parsed = configSchema.safeParse({
    id: formData.get("id"),
    label: formData.get("label"),
    sync_mode: formData.get("sync_mode"),
    host: formData.get("host"),
    port: formData.get("port") || undefined,
    database_name: formData.get("database_name"),
    schema_stock: formData.get("schema_stock"),
    schema_clients: formData.get("schema_clients"),
    schema_articles: formData.get("schema_articles"),
    sync_frequency_minutes: formData.get("sync_frequency_minutes") || 60,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sage_connection_configs")
    .update({
      label: parsed.data.label,
      sync_mode: parsed.data.sync_mode,
      host: parsed.data.host || null,
      port: parsed.data.port || null,
      database_name: parsed.data.database_name || null,
      schema_stock: parsed.data.schema_stock || null,
      schema_clients: parsed.data.schema_clients || null,
      schema_articles: parsed.data.schema_articles || null,
      sync_frequency_minutes: parsed.data.sync_frequency_minutes,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  revalidatePath("/parametres/sage");
  return {};
}

export async function toggleSageConnectionActive(id: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("sage_connection_configs")
    .update({ active, last_test_status: active ? "activee_manuellement" : null, last_test_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/parametres/sage");
  return {};
}

/**
 * Simule un cycle de synchronisation des CLIENTS Sage — même logique et
 * mêmes réserves que `simulateStockSync()` (parametres/actions.ts) : réservé à
 * l'administrateur, uniquement pour illustrer le mécanisme avant que
 * l'application locale de synchronisation Sage n'existe.
 */
export async function simulateClientsSync() {
  await requireRole(["administrateur"]);
  const admin = createAdminClient();
  const { data: companies } = await admin.from("companies").select("id,name,siret,address,phone,email");

  for (const c of companies ?? []) {
    await admin.from("sage_customers_view").upsert(
      {
        sage_code: `SAGE-${c.id.slice(0, 8).toUpperCase()}`,
        name: c.name,
        siret: c.siret,
        address: c.address,
        phone: c.phone,
        email: c.email,
        linked_company_id: c.id,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "sage_code" }
    );
  }
  revalidatePath("/parametres/clients-sage");
  return {};
}

/** Simule un cycle de synchronisation des ARTICLES Sage — même principe. */
export async function simulateArticlesSync() {
  await requireRole(["administrateur"]);
  const admin = createAdminClient();
  const { data: models } = await admin.from("product_models").select("id,name,category,base_price,active");

  for (const m of models ?? []) {
    await admin.from("sage_articles_view").upsert(
      {
        sage_reference: `ART-${m.id.slice(0, 8).toUpperCase()}`,
        designation: m.name,
        category: m.category,
        unit: "pièce",
        sale_price: m.base_price,
        active: m.active,
        linked_product_model_id: m.id,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "sage_reference" }
    );
  }
  revalidatePath("/parametres/articles-sage");
  return {};
}
