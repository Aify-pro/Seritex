import { requireRole } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/shell/page-header";
import { QueryTabs } from "@/components/shell/query-tabs";
import { ArticlesTab } from "./_tabs/articles-tab";
import { RouleauxTab } from "./_tabs/rouleaux-tab";
import { PrelevementsTab } from "./_tabs/prelevements-tab";
import { MouvementsTab } from "./_tabs/mouvements-tab";

type Onglet = "articles" | "rouleaux" | "prelevements" | "mouvements";
const ONGLETS: { key: Onglet; label: string }[] = [
  { key: "articles", label: "Articles en stock" },
  { key: "rouleaux", label: "Rouleaux" },
  { key: "prelevements", label: "Prélèvements" },
  { key: "mouvements", label: "Mouvements et export Sage" },
];

/**
 * Gestion de stock, en onglets (réorganisation du 2026-10-06) :
 *   - Articles en stock : tous les articles, stock Sage, réservé, disponible,
 *     rouleaux d'un tissu ;
 *   - Rouleaux : réception, recherche et scan, sortie pour la coupe d'un ODF
 *     (motif « Coupe pour ODF n° … »), retour pesé ;
 *   - Prélèvements : produits finis à sortir pour les ODF (section Stock) ;
 *   - Mouvements et export Sage : fiches CSV, derniers mouvements, saisie
 *     par ODF.
 * `record_pesee`, `generate_stock_export_fiche` et les fonctions des rouleaux
 * autorisent exactement les trois rôles ci-dessous.
 */
export default async function StockManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string; odf?: string; q?: string; nature?: string; dispo?: string; tissu?: string; statut?: string }>;
}) {
  const { profile } = await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const params = await searchParams;
  // Ancien lien « ?odf=… » : il ouvre la saisie par ODF.
  const onglet: Onglet = ONGLETS.some((o) => o.key === params.onglet)
    ? (params.onglet as Onglet)
    : params.odf
      ? "mouvements"
      : "articles";
  const canAct = ["administrateur", "responsable_production", "gestionnaire_stock"].includes(profile.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion de stock"
        description="Articles en stock, rouleaux de tissu, prélèvements pour les ODF, mouvements et export vers Sage."
      />
      <QueryTabs basePath="/atelier/stock" tabs={ONGLETS} current={onglet} label="Sections de la gestion de stock" />
      {onglet === "articles" && <ArticlesTab params={params} />}
      {onglet === "rouleaux" && <RouleauxTab params={params} canAct={canAct} />}
      {onglet === "prelevements" && <PrelevementsTab />}
      {onglet === "mouvements" && <MouvementsTab odfId={params.odf ?? null} />}
    </div>
  );
}
