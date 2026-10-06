import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { odfClientLabel } from "@/lib/production/client-label";
import { RollReception, type TissuOption } from "./roll-reception";
import { RollList, ROLL_STATUT_LABELS, type RollRow } from "./roll-list";

const STATUTS = ["actifs", "en_stock", "en_production", "epuise", "rebut", "tous"] as const;

/**
 * Rouleaux de tissu (migration 0095) : la laize, le poids et le bain sont
 * ceux de chaque rouleau, pas de l'article. Réception (saisie ou liste du
 * fournisseur), étiquette QR, sortie vers un ODF, retour pesé.
 */
export default async function RollsPage({ searchParams }: { searchParams: Promise<{ tissu?: string; statut?: string; q?: string }> }) {
  const { profile } = await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const canAct = ["administrateur", "responsable_production", "gestionnaire_stock"].includes(profile.role);
  const params = await searchParams;
  const statut = (STATUTS as readonly string[]).includes(params.statut ?? "") ? (params.statut as (typeof STATUTS)[number]) : "actifs";
  const supabase = await createClient();

  let rollsQuery = supabase
    .from("textile_rolls")
    .select("code,statut,bain,numero_fournisseur,laize_cm,poids_kg,poids_initial_kg,emplacement,sage_reference,colors(name),textiles(nom,product_model_id),production_orders(id,reference)")
    .order("recu_le", { ascending: false })
    .limit(500);
  if (params.tissu) rollsQuery = rollsQuery.eq("textile_id", params.tissu);
  if (statut === "actifs") rollsQuery = rollsQuery.in("statut", ["en_stock", "en_production"]);
  else if (statut !== "tous") rollsQuery = rollsQuery.eq("statut", statut);
  const q = (params.q ?? "").trim();
  if (q) rollsQuery = rollsQuery.or(`code.ilike.%${q.replace(/[%,()]/g, "")}%,bain.ilike.%${q.replace(/[%,()]/g, "")}%,numero_fournisseur.ilike.%${q.replace(/[%,()]/g, "")}%`);

  const [{ data: rolls }, { data: textiles }, { data: coloris }, { data: odfs }] = await Promise.all([
    rollsQuery,
    supabase.from("textiles").select("id,nom").eq("active", true).order("nom"),
    supabase.from("textile_sage_articles").select("textile_id,sage_reference,colors(name)"),
    supabase
      .from("production_orders")
      .select("id,reference,company_id,companies(name)")
      .in("status", ["en_attente_validation", "en_production"])
      .order("created_at", { ascending: false }),
  ]);

  const tissus: TissuOption[] = (textiles ?? []).map((t) => ({
    id: t.id as string,
    nom: t.nom as string,
    coloris: (coloris ?? [])
      .filter((c) => c.textile_id === t.id)
      .map((c) => ({ sageReference: c.sage_reference as string, couleur: (c.colors as unknown as { name: string } | null)?.name ?? null })),
  }));
  const rows: RollRow[] = (rolls ?? []).map((r) => {
    const tx = r.textiles as unknown as { nom: string; product_model_id: string | null } | null;
    const po = r.production_orders as unknown as { id: string; reference: string } | null;
    return {
      code: r.code as string,
      tissu: tx?.nom ?? "—",
      articleId: tx?.product_model_id ?? null,
      coloris: [r.sage_reference, (r.colors as unknown as { name: string } | null)?.name].filter(Boolean).join(" · ") || null,
      bain: (r.bain as string | null) ?? null,
      numeroFournisseur: (r.numero_fournisseur as string | null) ?? null,
      laizeCm: r.laize_cm != null ? Number(r.laize_cm) : null,
      poidsKg: Number(r.poids_kg),
      poidsInitialKg: Number(r.poids_initial_kg),
      statut: r.statut as RollRow["statut"],
      odf: po,
      emplacement: (r.emplacement as string | null) ?? null,
    };
  });
  const totalKg = rows.filter((r) => r.statut === "en_stock").reduce((s, r) => s + r.poidsKg, 0);
  const filterHref = (patch: Record<string, string>) => {
    const sp = new URLSearchParams({ ...(params.tissu ? { tissu: params.tissu } : {}), ...(statut !== "actifs" ? { statut } : {}), ...(q ? { q } : {}), ...patch });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    const s = sp.toString();
    return s ? `/atelier/stock/rouleaux?${s}` : "/atelier/stock/rouleaux";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rouleaux de tissu"
        description="Chaque rouleau a sa laize, son poids et son bain. Il sort vers un ODF, sert des matelas à la coupe et revient pesé : sa consommation et son grammage réel en découlent."
        action={
          <Link href="/atelier/stock" className="text-sm font-medium text-brand hover:underline">
            Gestion de stock →
          </Link>
        }
      />

      {canAct && (
        <Card>
          <CardHeader title="Réception" description="Saisie rouleau par rouleau, ou liste de colisage du fournisseur collée. Imprimez ensuite les étiquettes QR." />
          <CardBody>
            <RollReception tissus={tissus} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Rouleaux (${rows.length})`}
          description={`${totalKg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kg en stock dans cette sélection.`}
        />
        <CardBody className="space-y-3 border-b border-border">
          <form className="flex flex-wrap items-end gap-2" action="/atelier/stock/rouleaux">
            <label className="text-xs">
              <span className="mb-1 block text-foreground-muted">Tissu</span>
              <select name="tissu" defaultValue={params.tissu ?? ""} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
                <option value="">Tous</option>
                {tissus.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-foreground-muted">État</span>
              <select name="statut" defaultValue={statut} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
                <option value="actifs">En stock et en production</option>
                {(["en_stock", "en_production", "epuise", "rebut"] as const).map((s) => (
                  <option key={s} value={s}>
                    {ROLL_STATUT_LABELS[s]}
                  </option>
                ))}
                <option value="tous">Tous</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-foreground-muted">Code, bain ou n° fournisseur</span>
              <input name="q" defaultValue={q} placeholder="ROL-…" className="h-9 w-56 rounded-md border border-border bg-surface px-2 text-sm" />
            </label>
            <button type="submit" className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted">
              Filtrer
            </button>
            {(params.tissu || statut !== "actifs" || q) && (
              <Link href={filterHref({ tissu: "", statut: "", q: "" })} className="text-xs text-foreground-muted hover:underline">
                Réinitialiser
              </Link>
            )}
          </form>
        </CardBody>
        <CardBody className="p-0">
          <RollList
            rows={rows}
            canAct={canAct}
            odfs={(odfs ?? []).map((o) => ({
              id: o.id as string,
              label: `${o.reference} · ${odfClientLabel(o.company_id as string | null, (o.companies as unknown as { name: string } | null)?.name)}`,
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
