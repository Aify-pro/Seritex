import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { Lock } from "lucide-react";
import { MIRROR_PAGE_SIZE, orIlike, pageRange, parseMirrorParams } from "@/lib/sage-mirror/list";
import { MirrorToolbar, type MirrorFilterDef } from "@/components/sage-mirror/mirror-toolbar";
import { MirrorPagination } from "@/components/sage-mirror/mirror-pagination";
import { DetailRows, type DetailRow } from "@/components/sage-mirror/detail-rows";

const FILTER_KEYS = ["statut", "type", "rapprochement"] as const;
const SEARCH_COLUMNS = ["sage_code", "name", "siret", "phone", "email", "city", "famille", "typologie"];

const FILTERS: MirrorFilterDef[] = [
  {
    key: "statut",
    label: "Statut Sage",
    options: [
      { value: "", label: "Tous" },
      { value: "actif", label: "Actifs" },
      { value: "inactif", label: "En sommeil" },
    ],
  },
  {
    key: "type",
    label: "Type",
    options: [
      { value: "", label: "Clients et prospects" },
      { value: "client", label: "Clients" },
      { value: "prospect", label: "Prospects" },
    ],
  },
  {
    key: "rapprochement",
    label: "Rapprochement",
    options: [
      { value: "", label: "Tous" },
      { value: "oui", label: "Rapprochés" },
      { value: "non", label: "Non rapprochés" },
    ],
  },
];

const CELL_CLASSES = [
  "px-5 py-3 font-mono text-xs text-foreground-muted",
  "px-5 py-3 font-medium text-foreground",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3",
  "px-5 py-3 text-foreground-muted",
];

export default async function ClientsSagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule("clients_sage");
  const supabase = await createClient();
  const params = parseMirrorParams(await searchParams, FILTER_KEYS);
  const { statut, type, rapprochement } = params.filters;

  let query = supabase.from("sage_customers_view").select("*,companies(name)", { count: "exact" });
  const search = orIlike(SEARCH_COLUMNS, params.q);
  if (search) query = query.or(search);
  if (statut === "actif") query = query.eq("is_active", true);
  if (statut === "inactif") query = query.eq("is_active", false);
  if (type === "client") query = query.eq("is_prospect", false);
  if (type === "prospect") query = query.eq("is_prospect", true);
  if (rapprochement === "oui") query = query.not("linked_company_id", "is", null);
  if (rapprochement === "non") query = query.is("linked_company_id", null);

  const [from, to] = pageRange(params.page);
  const { data: customers, count, error } = await query.order("name").range(from, to);
  const total = count ?? 0;

  const repNos = Array.from(new Set((customers ?? []).map((c) => c.representant_no).filter((n): n is number => n != null)));
  const { data: reps } = repNos.length
    ? await supabase.from("sage_representants").select("co_no,name").in("co_no", repNos)
    : { data: [] as { co_no: number; name: string }[] };
  const repNames = new Map((reps ?? []).map((r) => [r.co_no, r.name]));

  const rows: DetailRow[] = (customers ?? []).map((c) => {
    const linked = (c.companies as unknown as { name: string } | null)?.name;
    const rapproche = linked ? <Badge tone="success">{linked}</Badge> : <Badge tone="warning">Non rapproché</Badge>;
    const adresse = [c.address, [c.postal_code, c.city].filter(Boolean).join(" "), c.country].filter(Boolean).join(", ");
    return {
      id: c.sage_code,
      cells: [c.sage_code, c.name, c.phone ?? "—", c.city ?? "—", rapproche, formatDateTime(c.last_sync_at)],
      title: c.name,
      subtitle: `Code Sage ${c.sage_code}`,
      fields: [
        { label: "Code Sage", value: c.sage_code },
        { label: "Raison sociale", value: c.name },
        { label: "Statut Sage", value: c.is_active === false ? "En sommeil" : "Actif" },
        { label: "Type", value: c.is_prospect ? "Prospect" : "Client" },
        { label: "SIRET", value: c.siret },
        { label: "N° TVA", value: c.vat_number },
        { label: "Code APE", value: c.ape_code },
        { label: "Adresse", value: adresse },
        { label: "Téléphone", value: c.phone },
        { label: "E-mail", value: c.email },
        { label: "Site web", value: c.website },
        { label: "Famille", value: c.famille },
        { label: "Sous-famille", value: c.sous_famille },
        { label: "Catégorie", value: c.categorie },
        { label: "Typologie", value: c.typologie },
        { label: "Commercial (Sage)", value: c.representant_no != null ? (repNames.get(c.representant_no) ?? `n° ${c.representant_no}`) : null },
        { label: "Créé dans Sage le", value: c.sage_created_at ? formatDateTime(c.sage_created_at) : null },
        { label: "Rapprochement Seritex", value: rapproche },
        { label: "Dernière synchro", value: formatDateTime(c.last_sync_at) },
      ],
    };
  });

  const activeQuery = { q: params.q, ...params.filters };
  const filtered = Boolean(params.q) || Object.values(params.filters).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients (Sage)"
        description="Vue miroir en lecture seule — Sage reste l'unique source de vérité pour la fiche client comptable ; la fiche client CRM Seritex (Clients) reste distincte et sert la relation commerciale."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Aucune écriture n&apos;est possible depuis Seritex sur cette vue. Cliquez sur une ligne pour voir la fiche complète.
      </div>

      <MirrorToolbar
        q={params.q}
        filterValues={params.filters}
        filters={FILTERS}
        label="Rechercher un client Sage"
        placeholder="Rechercher : code Sage, raison sociale, SIRET, téléphone, e-mail, ville…"
      />

      {error && error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les clients Sage ({error.message}).
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Code Sage</th>
                <th className="px-5 py-3 font-medium">Raison sociale</th>
                <th className="px-5 py-3 font-medium">Téléphone</th>
                <th className="px-5 py-3 font-medium">Ville</th>
                <th className="px-5 py-3 font-medium">Rapprochement</th>
                <th className="px-5 py-3 font-medium">Dernière synchro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <DetailRows rows={rows} cellClassNames={CELL_CLASSES} />
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {filtered ? "Aucun client ne correspond à la recherche." : "Aucune donnée — lancez une synchronisation."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <MirrorPagination
            basePath="/parametres/clients-sage"
            query={activeQuery}
            page={params.page}
            size={MIRROR_PAGE_SIZE}
            total={total}
            noun="client"
          />
        </CardBody>
      </Card>
    </div>
  );
}
