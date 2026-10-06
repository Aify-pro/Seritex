import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { GroupingForm, type ProposalTextile } from "./grouping-form";

/**
 * Regroupement des tissus (migration 0103) : chaque grammage était un article
 * (« Jersey 165 », « Jersey 180 ») ; un tissu devient un article (« Jersey »)
 * décliné en grammages × couleurs. Proposition par matière ; rien ne change
 * tant que l'utilisateur ne valide pas un groupe.
 */
export default async function TextileGroupingPage() {
  const { canModify } = await requireArticles();
  if (!canModify) redirect("/articles");
  const supabase = await createClient();
  const { data: proposals, error } = await supabase.rpc("textile_grouping_proposals");

  return (
    <div className="space-y-6">
      <Link href="/articles" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Articles
      </Link>
      <PageHeader
        title="Regrouper les tissus"
        description="Un tissu est un article (ex. Jersey) décliné en grammages et en couleurs. Voici, par matière, les tissus qui sont encore un article par grammage. Vérifiez chaque groupe, corrigez-le si besoin, puis validez : rien ne change avant."
      />
      {error && <p className="text-sm text-danger">Propositions indisponibles : {error.message}</p>}
      {(proposals ?? []).length === 0 && !error && (
        <Card>
          <CardBody className="text-sm text-foreground-muted">
            Aucun regroupement à proposer : chaque matière n&apos;a qu&apos;un article tissu (ou les tissus n&apos;ont pas de matière renseignée).
          </CardBody>
        </Card>
      )}
      {((proposals ?? []) as { matiere_id: string; matiere: string; nom_propose: string; textiles: Record<string, unknown>[] }[]).map((p) => (
        <Card key={p.matiere_id}>
          <CardHeader title={`Matière : ${p.matiere}`} description="Les rouleaux, les produits finis et les mouvements restent liés à leurs grammages ; seuls la fiche et les déclinaisons sont regroupées." />
          <CardBody>
            <GroupingForm
              nomPropose={p.nom_propose}
              textiles={p.textiles.map(
                (t): ProposalTextile => ({
                  textileId: t.textile_id as string,
                  nom: t.nom as string,
                  grammage: t.grammage != null ? Number(t.grammage) : null,
                  articleId: t.article_id as string,
                  article: t.article as string,
                  rouleaux: Number(t.rouleaux),
                  declinaisons: Number(t.declinaisons),
                })
              )}
            />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
