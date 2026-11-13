import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { loadBilan, loadChaine, loadChaineTravail, loadSortiesJour, piecesParPersonne, today } from "@/lib/confection/data";
import { getSizes } from "@/lib/sizes";
import { ArretsPanel, EffectifForm, EquipePanel, SortiesPanel, TravauxPanel, type AffectationRow, type ArretRow, type CandidatRow, type EmployeRow, type PosteOption } from "./panels";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fiche d'une chaîne : ce que le chef de section pilote. Il attribue les
 * travaux (l'agent les voit sur sa tablette), tient l'équipe, et suit ce que
 * l'agent saisit : paquets livrés, sorties, effectif, arrêts.
 */
export default async function ChainePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ jour?: string }> }) {
  await requireModule("confection");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const chaine = await loadChaine(id);
  if (!chaine) notFound();
  const aujourdhui = today();
  const jour = sp.jour && JOUR.test(sp.jour) && sp.jour <= aujourdhui ? sp.jour : aujourdhui;
  const supabase = await createClient();

  const [bilan, travail, sorties, sizes, peutModifier, peutCreer, peutCorriger, { data: affRaw }, { data: employesRaw }, { data: postes }, { data: arrets }, { data: candidatsRaw }, { data: presence }] =
    await Promise.all([
      loadBilan(jour),
      loadChaineTravail(id, { avecTermines: true }),
      loadSortiesJour(id, jour),
      getSizes(),
      can("confection", "modify"),
      can("confection", "create"),
      can("confection_ravitaillement", "modify"),
      supabase.from("affectations_couture").select("id,employe_id,poste_id,fonction,debut,fin").eq("chaine_id", id).order("debut", { ascending: false }).limit(200),
      supabase.rpc("confection_employes"),
      supabase.from("postes_couture").select("id,numero,libelle").eq("chaine_id", id).eq("actif", true).order("numero"),
      supabase.from("arrets_chaine").select("id,debut,fin,cause,commentaire").eq("chaine_id", id).order("debut", { ascending: false }).limit(20),
      supabase
        .from("work_orders")
        .select("id,reference,quantity_planned,quantity_done,production_orders!inner(reference,status),production_order_lines(description)")
        .eq("section_id", chaine.section_id)
        .eq("production_orders.status", "en_production")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("presences_chaine").select("presents").eq("chaine_id", id).eq("jour", jour).maybeSingle(),
    ]);

  const b = bilan.find((x) => x.chaine_id === id);
  const employes = (employesRaw ?? []) as EmployeRow[];
  const nomEmploye = new Map(employes.map((e) => [e.id, `${e.nom}${e.prenom ? ` ${e.prenom}` : ""} (${e.matricule})`]));
  const affectations: AffectationRow[] = ((affRaw ?? []) as { id: string; employe_id: string; poste_id: string | null; fonction: string; debut: string; fin: string | null }[]).map((a) => ({
    ...a,
    nom: nomEmploye.get(a.employe_id) ?? "Personne hors liste",
  }));
  const dejaAttribues = new Set(travail.travaux.map((t) => t.workOrderId));
  const candidats: CandidatRow[] = ((candidatsRaw ?? []) as unknown as { id: string; reference: string; quantity_planned: number; quantity_done: number; production_orders: { reference: string } | null; production_order_lines: { description: string | null } | null }[])
    .filter((w) => !dejaAttribues.has(w.id))
    .map((w) => ({ id: w.id, odf: w.production_orders?.reference ?? w.reference, article: w.production_order_lines?.description ?? "Article", prevu: w.quantity_planned, fait: w.quantity_done }));
  const libelle = new Map(sizes.map((s) => [s.cle, s.libelle]));
  const ppp = b ? piecesParPersonne(b) : null;
  const estAujourdhui = jour === aujourdhui;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {chaine.nom}
            <span className="font-mono text-sm font-normal text-foreground-muted">{chaine.code}</span>
            {chaine.type === "support" && <Badge tone="info">Support</Badge>}
            {!chaine.active && <Badge tone="warning">Désactivée</Badge>}
          </span>
        }
        description={`${chaine.section} — ${estAujourdhui ? "aujourd'hui" : `journée du ${formatDate(jour)}`}`}
        action={
          <Link href={estAujourdhui ? "/confection" : `/confection?jour=${jour}`} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted">
            ← Toutes les chaînes
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Sorties" value={(b?.sorties ?? 0).toLocaleString("fr-FR")} tone="brand" />
        <StatCard label="Entrées (pièces)" value={(b?.entrees ?? 0).toLocaleString("fr-FR")} />
        <StatCard label="En-cours" value={(b?.en_cours ?? 0).toLocaleString("fr-FR")} hint="Vêtements complets pas encore sortis" />
        <StatCard
          label="Présents"
          value={b?.presents ?? "—"}
          hint={b?.presents == null ? "À renseigner" : `${b.source_presence === "pointage" ? "Pointage" : "Saisi"}${b.affectes ? ` · ${b.affectes} affectés` : ""}`}
          tone={b?.presents == null ? "warning" : "neutral"}
        />
        <StatCard label="Rendement" value={ppp === null ? "—" : ppp.toLocaleString("fr-FR")} hint="Pièces par personne présente" />
      </div>

      <Card>
        <CardHeader
          title="Travaux de la chaîne"
          description="Ce que la chaîne doit coudre, par ordre de priorité. L'agent le voit sur sa tablette et va chercher les paquets correspondants ; un travail s'ouvre aussi tout seul au premier paquet livré."
        />
        <TravauxPanel chaineId={id} travaux={travail.travaux} candidats={candidats} peutCreer={peutCreer} peutModifier={peutModifier} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Paquets sur la chaîne" description="Livrés par l'agent, pas encore retirés." />
          <CardBody className="space-y-1.5">
            {travail.paquetsSurChaine.length === 0 && <p className="text-sm text-foreground-muted">Aucun paquet.</p>}
            {travail.paquetsSurChaine.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link href={`/lots/${p.code}`} className="font-mono text-brand hover:underline">
                  {p.code}
                </Link>
                <span>{p.piece ?? "Vêtements"}</span>
                <span className="text-foreground-muted">{p.tailles.map((t) => `${t.libelle} : ${t.quantite}`).join(" · ")}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Sorties ${estAujourdhui ? "du jour" : `du ${formatDate(jour)}`}`} description="Comptées par l'agent en bout de chaîne et déclarées à l'ordre de fabrication." />
          <SortiesPanel
            chaineId={id}
            sorties={sorties.map((s) => ({ ...s, tailleLibelle: libelle.get(s.taille) ?? s.taille, heure: formatDateTime(s.heure) }))}
            peutRegulariser={peutModifier}
            peutCorriger={peutCorriger}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Équipe"
            description="Qui travaille sur cette chaîne. Changer quelqu'un de chaîne ferme sa place précédente : l'historique est gardé."
          />
          <EquipePanel chaineId={id} affectations={affectations} employes={employes} postes={(postes ?? []) as PosteOption[]} peutModifier={peutModifier} />
        </Card>

        <div className="space-y-6">
          {estAujourdhui && (
            <Card>
              <CardHeader title="Effectif présent" description="À saisir tant que le pointage du jour n'est pas importé dans Personnel ; le pointage fait foi dès qu'il existe." />
              <CardBody>
                <EffectifForm chaineId={id} jour={jour} presents={(presence as { presents: number } | null)?.presents ?? null} pointage={b?.source_presence === "pointage" ? b.presents : null} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Arrêts" description="Coupure de courant, attente de ravitaillement, panne, changement de modèle." />
            <ArretsPanel chaineId={id} arrets={((arrets ?? []) as ArretRow[]).map((a) => ({ ...a, debut: formatDateTime(a.debut), fin: a.fin ? formatDateTime(a.fin) : null }))} />
          </Card>
        </div>
      </div>
    </div>
  );
}
