import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";

/** Rouleaux de tissu sortis pour cet ODF (migration 0096) : en cours et déjà revenus. */
export async function OdfRolls({ productionOrderId }: { productionOrderId: string }) {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("textile_roll_events")
    .select("type,poids_avant,poids_apres,created_at,textile_rolls(code,statut,bain,laize_cm,sage_reference,textiles(nom))")
    .eq("production_order_id", productionOrderId)
    .in("type", ["sortie_odf", "retour_stock"])
    .order("created_at");
  if (!events || events.length === 0) return null;

  type Ev = { type: string; poids_avant: number | null; poids_apres: number | null; textile_rolls: { code: string; statut: string; bain: string | null; laize_cm: number | null; sage_reference: string | null; textiles: { nom: string } | null } | null };
  const byRoll = new Map<string, { info: NonNullable<Ev["textile_rolls"]>; sorti: number; revenu: number | null }>();
  for (const e of events as unknown as Ev[]) {
    if (!e.textile_rolls) continue;
    const cur = byRoll.get(e.textile_rolls.code) ?? { info: e.textile_rolls, sorti: 0, revenu: null };
    if (e.type === "sortie_odf") cur.sorti += Number(e.poids_avant ?? 0);
    else cur.revenu = (cur.revenu ?? 0) + Number(e.poids_apres ?? 0);
    byRoll.set(e.textile_rolls.code, cur);
  }
  const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader
        title="Rouleaux de tissu"
        description="Sortis du stock pour cet ODF ; au retour, le reste est pesé et la consommation en découle."
        action={
          <Link href="/atelier/stock?onglet=rouleaux" className="text-sm font-medium text-brand hover:underline">
            Rouleaux →
          </Link>
        }
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">
          {[...byRoll.values()].map(({ info, sorti, revenu }) => (
            <li key={info.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="font-mono text-xs font-medium">{info.code}</span>
              <span>
                {info.textiles?.nom}
                {info.sage_reference && <span className="text-foreground-muted"> · {info.sage_reference}</span>}
              </span>
              <span className="text-xs text-foreground-muted">bain {info.bain ?? "—"}</span>
              <span className="text-xs text-foreground-muted">{info.laize_cm ? `${info.laize_cm} cm` : "laize —"}</span>
              <span className="tabular-nums">sorti {fmt(sorti)} kg</span>
              <span className="tabular-nums text-foreground-muted">
                {revenu === null ? "en production" : `revenu ${fmt(revenu)} kg · consommé ${fmt(sorti - revenu)} kg`}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
