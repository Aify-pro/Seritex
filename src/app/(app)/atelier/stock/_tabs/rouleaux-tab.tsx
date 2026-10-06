import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { odfClientLabel } from "@/lib/production/client-label";
import { RollReception, type TissuOption } from "../rouleaux/roll-reception";
import { RollList, ROLL_STATUT_LABELS, type RollRow } from "../rouleaux/roll-list";
import { RollScanSearch } from "../rouleaux/roll-scan-search";

const STATUTS = ["actifs", "en_stock", "en_production", "epuise", "rebut", "tous"] as const;
const EVENT_LABELS: Record<string, string> = {
  reception: "Réception",
  sortie_odf: "Sortie pour la coupe",
  matelas: "Scanné sur un matelas",
  retour_stock: "Retour au stock",
  rebut: "Mis au rebut",
};

/**
 * Onglet Rouleaux de la gestion de stock (migration 0096) : réception (saisie
 * ou liste du fournisseur), recherche et scan d'un rouleau, sortie pour la
 * coupe d'un ODF (mouvement « Coupe pour ODF n° … »), retour pesé, rebut.
 */
export async function RouleauxTab({ params, canAct }: { params: { tissu?: string; statut?: string; q?: string }; canAct: boolean }) {
  const statut = (STATUTS as readonly string[]).includes(params.statut ?? "") ? (params.statut as (typeof STATUTS)[number]) : "actifs";
  const q = (params.q ?? "").trim();
  const safe = q.replace(/[%,()]/g, "");
  const supabase = await createClient();

  let rollsQuery = supabase
    .from("textile_rolls")
    .select("id,code,code_complet,statut,bain,numero_fournisseur,laize_cm,poids_kg,poids_initial_kg,emplacement,sage_reference,textile_id,colors(name),textiles(nom,product_model_id),production_orders(id,reference)")
    .order("recu_le", { ascending: false })
    .limit(500);
  if (params.tissu) rollsQuery = rollsQuery.eq("textile_id", params.tissu);
  // Une recherche par code cherche dans tous les états.
  if (!q && statut === "actifs") rollsQuery = rollsQuery.in("statut", ["en_stock", "en_production"]);
  else if (!q && statut !== "tous") rollsQuery = rollsQuery.eq("statut", statut);
  if (q) rollsQuery = rollsQuery.or(`code.ilike.%${safe}%,code_complet.ilike.%${safe}%,bain.ilike.%${safe}%,numero_fournisseur.ilike.%${safe}%`);

  const [{ data: rolls }, { data: textiles }, { data: coloris }, { data: odfs }] = await Promise.all([
    rollsQuery,
    supabase.from("textiles").select("id,nom").eq("active", true).order("nom"),
    supabase.from("textile_sage_articles").select("textile_id,sage_reference,colors(name)"),
    supabase
      .from("production_orders")
      .select("id,reference,company_id,companies(name),production_order_lines(textile_id,product_models(textile_id))")
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
    return {
      code: r.code as string,
      codeComplet: (r.code_complet as string | null) ?? null,
      textileId: r.textile_id as string,
      tissu: tx?.nom ?? "—",
      articleId: tx?.product_model_id ?? null,
      coloris: [r.sage_reference, (r.colors as unknown as { name: string } | null)?.name].filter(Boolean).join(" · ") || null,
      bain: (r.bain as string | null) ?? null,
      numeroFournisseur: (r.numero_fournisseur as string | null) ?? null,
      laizeCm: r.laize_cm != null ? Number(r.laize_cm) : null,
      poidsKg: Number(r.poids_kg),
      poidsInitialKg: Number(r.poids_initial_kg),
      statut: r.statut as RollRow["statut"],
      odf: r.production_orders as unknown as { id: string; reference: string } | null,
      emplacement: (r.emplacement as string | null) ?? null,
    };
  });
  const totalKg = rows.filter((r) => r.statut === "en_stock").reduce((s, r) => s + r.poidsKg, 0);

  // Un seul rouleau trouvé : son historique et son bilan.
  let detail: React.ReactNode = null;
  if (rolls && rolls.length === 1) {
    const roll = rolls[0];
    const [{ data: events }, { data: summary }] = await Promise.all([
      supabase
        .from("textile_roll_events")
        .select("type,poids_avant,poids_apres,commentaire,created_at,production_orders(reference),traces_placement(reference),app_users(full_name)")
        .eq("roll_id", roll.id)
        .order("created_at"),
      supabase.rpc("roll_summary", { p_code: roll.code }),
    ]);
    const s = summary as { consomme_kg: number; grammage_reel: number | null } | null;
    detail = (
      <Card>
        <CardHeader
          title={`Historique de ${roll.code}`}
          description={
            s && Number(s.consomme_kg) > 0
              ? `${Number(s.consomme_kg).toLocaleString("fr-FR")} kg consommés${s.grammage_reel ? ` · grammage réel ${s.grammage_reel} g/m²` : ""}`
              : "Pas encore de consommation mesurée."
          }
        />
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {(events ?? []).map((e, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 px-5 py-2 text-sm">
                <span>
                  {EVENT_LABELS[e.type as string] ?? e.type}
                  {(e.production_orders as unknown as { reference: string } | null)?.reference && ` · ODF ${(e.production_orders as unknown as { reference: string }).reference}`}
                  {(e.traces_placement as unknown as { reference: string } | null)?.reference && ` · matelas ${(e.traces_placement as unknown as { reference: string }).reference}`}
                  {e.poids_apres != null && ` · ${Number(e.poids_apres).toLocaleString("fr-FR")} kg`}
                  {e.commentaire && <span className="text-foreground-muted"> · {e.commentaire as string}</span>}
                </span>
                <span className="text-xs text-foreground-muted">
                  {formatDateTime(e.created_at as string)}
                  {(e.app_users as unknown as { full_name: string } | null)?.full_name && ` · ${(e.app_users as unknown as { full_name: string }).full_name}`}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Rouleaux (${rows.length})`}
          description={`${totalKg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kg en stock dans cette sélection. Un rouleau sorti pour un ODF porte le motif « Coupe pour ODF n° … » ; à la coupe, il se scanne sur chaque matelas.`}
        />
        <CardBody className="flex flex-wrap items-end gap-4 border-b border-border">
          <RollScanSearch initial={q} />
          <form className="flex flex-wrap items-end gap-2" action="/atelier/stock">
            <input type="hidden" name="onglet" value="rouleaux" />
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
              <input name="q" defaultValue={q} className="h-9 w-56 rounded-md border border-border bg-surface px-2 text-sm" />
            </label>
            <button type="submit" className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted">
              Rechercher
            </button>
            {(params.tissu || statut !== "actifs" || q) && (
              <Link href="/atelier/stock?onglet=rouleaux" className="text-xs text-foreground-muted hover:underline">
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
              // Tissus coupés par l'ODF : grammage choisi sur la ligne, sinon tissu principal du modèle.
              textileIds: [
                ...new Set(
                  ((o.production_order_lines ?? []) as unknown as { textile_id: string | null; product_models: { textile_id: string | null } | null }[])
                    .map((l) => l.textile_id ?? l.product_models?.textile_id ?? null)
                    .filter((t): t is string => !!t)
                ),
              ],
            }))}
          />
        </CardBody>
      </Card>

      {detail}

      {canAct && (
        <Card>
          <CardHeader title="Réception" description="Saisie rouleau par rouleau, ou liste de colisage du fournisseur collée. Imprimez ensuite les étiquettes QR." />
          <CardBody>
            <RollReception tissus={tissus} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
