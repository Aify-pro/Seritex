import Link from "next/link";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import { getSizes } from "@/lib/sizes";
import { loadBilan, loadChainesAgent, loadChaineTravail, today } from "@/lib/confection/data";
import { Tablette } from "./tablette";

/**
 * Tablette de l'agent de chaîne (C15-C17) : ce que la chaîne doit coudre, les
 * paquets à aller chercher, le scan de ravitaillement (livraison entière ou
 * partielle) et le comptage des sorties. Un agent ne voit que sa chaîne ; qui
 * pilote la confection peut choisir n'importe laquelle.
 */
export default async function TablettePage({ searchParams }: { searchParams: Promise<{ chaine?: string }> }) {
  const { profile } = await requireModule("confection_ravitaillement");
  const sp = await searchParams;
  const pilote = await can("confection", "modify");
  const chaines = await loadChainesAgent(profile.id, pilote);

  if (chaines.length === 0) {
    return (
      <Card>
        <CardBody className="space-y-2">
          <p className="text-base font-semibold text-foreground">Aucune chaîne ne vous est attribuée.</p>
          <p className="text-sm text-foreground-muted">
            Votre responsable doit rattacher votre compte à votre chaîne dans Paramètres &gt; Atelier &gt; Confection.
          </p>
        </CardBody>
      </Card>
    );
  }

  const chaine = chaines.find((c) => c.id === sp.chaine) ?? chaines[0];
  const jour = today();
  const supabase = await createClient();
  const [travail, bilan, sizes, { data: arret }, { data: presence }, peutLivrer] = await Promise.all([
    loadChaineTravail(chaine.id),
    loadBilan(jour),
    getSizes(),
    supabase.from("arrets_chaine").select("id,debut,cause").eq("chaine_id", chaine.id).is("fin", null).order("debut", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("presences_chaine").select("presents").eq("chaine_id", chaine.id).eq("jour", jour).maybeSingle(),
    can("confection_ravitaillement", "create"),
  ]);
  const b = bilan.find((x) => x.chaine_id === chaine.id) ?? null;
  const a = arret as { id: string; debut: string; cause: string } | null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {chaines.length > 1 && (
        <nav aria-label="Chaîne" className="flex gap-2 overflow-x-auto">
          {chaines.map((c) => (
            <Link
              key={c.id}
              href={`/tablette-chaine?chaine=${c.id}`}
              className={cn(
                "shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold",
                c.id === chaine.id ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface text-foreground"
              )}
            >
              {c.nom}
            </Link>
          ))}
        </nav>
      )}
      <Tablette
        key={chaine.id}
        chaine={{ id: chaine.id, nom: chaine.nom, code: chaine.code, section: chaine.section }}
        travaux={travail.travaux}
        paquetsAChercher={travail.paquetsAChercher}
        paquetsSurChaine={travail.paquetsSurChaine}
        tailles={Object.fromEntries(sizes.map((s) => [s.cle, s.libelle]))}
        jour={jour}
        bilan={b ? { sorties: b.sorties, entrees: b.entrees, enCours: b.en_cours, presents: b.presents, source: b.source_presence } : null}
        presentsSaisis={(presence as { presents: number } | null)?.presents ?? null}
        arret={a ? { id: a.id, cause: a.cause, debut: formatDateTime(a.debut) } : null}
        peutLivrer={peutLivrer}
      />
    </div>
  );
}
