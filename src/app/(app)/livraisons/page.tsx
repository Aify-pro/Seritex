import Link from "next/link";
import { redirect } from "next/navigation";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import { normalizeSearch } from "@/lib/clients/filters";
import {
  REGLEMENT_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TABS,
  type ReglementMention,
  type ShipmentStatus,
  type ShipmentTabKey,
} from "@/lib/delivery/status";

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
};

/**
 * Service livraison (LIV-1) : les expéditions par étape — à préparer, à
 * valider par la comptabilité, à planifier, prêtes à enlever, en cours,
 * livrées, échecs et litiges. Filtres : zone, date, client, transporteur.
 */
export default async function LivraisonsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { profile } = await requireModule("livraisons");
  if (!(await can("livraisons", "view"))) redirect("/dashboard?erreur=acces_refuse");
  const params = await searchParams;
  const defaultTab: ShipmentTabKey = profile.role === "comptabilite" ? "a_valider" : "a_preparer";
  const tab = (SHIPMENT_TABS.find((t) => t.key === one(params, "onglet"))?.key ?? defaultTab) as ShipmentTabKey;
  const filters = { zone: one(params, "zone"), date: one(params, "date"), client: one(params, "client"), transporteur: one(params, "transporteur") };
  const supabase = await createClient();

  const [{ data: rows }, { data: zones }, { data: carriers }] = await Promise.all([
    supabase
      .from("shipments")
      .select("id,reference,statut,mode,client_nom,lieu_libelle,lieu_zone,date_promise,date_planifiee,carrier_id,reglement_mention,reglement_montant,created_at,production_orders(reference),shipment_lines(quantite)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("delivery_zones").select("nom").eq("actif", true).order("ordre"),
    supabase.from("carriers").select("id,nom").order("nom"),
  ]);

  const all = (rows ?? []).filter((r) => {
    if (filters.zone && r.lieu_zone !== filters.zone) return false;
    if (filters.date && r.date_planifiee !== filters.date && r.date_promise !== filters.date) return false;
    if (filters.transporteur && r.carrier_id !== filters.transporteur) return false;
    if (filters.client) {
      const hay = normalizeSearch(`${r.client_nom ?? ""} ${r.reference ?? ""} ${(r.production_orders as unknown as { reference: string } | null)?.reference ?? ""}`);
      if (!normalizeSearch(filters.client).split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const current = SHIPMENT_TABS.find((t) => t.key === tab)!;
  const visible = all.filter((r) => (current.statuts as readonly string[]).includes(r.statut));
  const count = (statuts: readonly string[]) => all.filter((r) => statuts.includes(r.statut)).length;
  const qs = (patch: Record<string, string>) => {
    const sp = new URLSearchParams({ ...filters, onglet: tab, ...patch });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    return `/livraisons?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livraisons"
        description="Les pièces de 1er choix entrent ici dès la finition. Préparation, validation comptable, planification, livraison ou retrait."
        action={
          ["administrateur", "responsable_livraison"].includes(profile.role) ? (
            <Link href="/livraisons/tournees" className="text-sm font-medium text-brand hover:underline">
              Tournées du jour →
            </Link>
          ) : undefined
        }
      />

      <nav aria-label="Étapes" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {SHIPMENT_TABS.map((t) => (
          <Link
            key={t.key}
            href={qs({ onglet: t.key })}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab ? "border-brand text-brand" : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {t.label} <span className="text-xs text-foreground-muted">({count(t.statuts)})</span>
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <input type="hidden" name="onglet" value={tab} />
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Client, BL, ODF</span>
          <input name="client" defaultValue={filters.client} className="h-9 w-56 rounded-md border border-border bg-surface px-2" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Zone</span>
          <select name="zone" defaultValue={filters.zone} className="h-9 rounded-md border border-border bg-surface px-2">
            <option value="">Toutes</option>
            {(zones ?? []).map((z) => (
              <option key={z.nom} value={z.nom}>
                {z.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Date</span>
          <input type="date" name="date" defaultValue={filters.date} className="h-9 rounded-md border border-border bg-surface px-2" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Transporteur</span>
          <select name="transporteur" defaultValue={filters.transporteur} className="h-9 rounded-md border border-border bg-surface px-2">
            <option value="">Tous</option>
            {(carriers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-muted">
          Filtrer
        </button>
        <Link href={`/livraisons?onglet=${tab}`} className="h-9 px-2 py-2 text-xs text-foreground-muted hover:text-foreground">
          Réinitialiser
        </Link>
      </form>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>BL</Th>
              <Th>Client</Th>
              <Th>ODF</Th>
              <Th align="right">Pièces</Th>
              <Th>Lieu</Th>
              <Th>Date</Th>
              <Th>Règlement</Th>
              <Th>Statut</Th>
            </tr>
          </Thead>
          <Tbody>
            {visible.length === 0 && <EmptyRow colSpan={8}>Aucune expédition dans cet onglet.</EmptyRow>}
            {visible.map((r) => {
              const pieces = ((r.shipment_lines ?? []) as { quantite: number }[]).reduce((s, l) => s + l.quantite, 0);
              return (
                <ClickableTr key={r.id} href={`/livraisons/${r.id}`}>
                  <Td className="font-mono text-xs">{r.reference ?? "—"}</Td>
                  <Td className="font-medium">{r.client_nom}</Td>
                  <Td className="text-xs">{(r.production_orders as unknown as { reference: string } | null)?.reference ?? "—"}</Td>
                  <Td align="right">{pieces}</Td>
                  <Td className="text-xs">
                    {r.mode === "retrait" ? <Badge tone="accent">Retrait</Badge> : [r.lieu_libelle, r.lieu_zone].filter(Boolean).join(" · ") || "—"}
                  </Td>
                  <Td className="text-xs">{formatDate(r.date_planifiee ?? r.date_promise)}</Td>
                  <Td className="text-xs">
                    {r.reglement_mention
                      ? `${REGLEMENT_LABELS[r.reglement_mention as ReglementMention]}${r.reglement_montant ? ` ${formatAmount(Number(r.reglement_montant))}` : ""}`
                      : "—"}
                  </Td>
                  <Td>
                    <Badge tone={["echec", "litige"].includes(r.statut) ? "danger" : ["livree", "enlevee", "reception_confirmee"].includes(r.statut) ? "success" : "brand"}>
                      {SHIPMENT_STATUS_LABELS[r.statut as ShipmentStatus]}
                    </Badge>
                  </Td>
                </ClickableTr>
              );
            })}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
}
