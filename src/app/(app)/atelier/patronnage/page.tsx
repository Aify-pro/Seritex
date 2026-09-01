import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { BookMarked } from "lucide-react";
import type { FichePlacement, PatronReconnu, PieceNonReconnue } from "@/lib/patronnage/types";
import { FichesPlacementClient } from "@/components/atelier/patronnage/fiches-placement-client";

export default async function PatronnagePage() {
  const { profile } = await requireUser();
  const [canView, canCreate, canModify, canValidate, canUnlock, canArchive, canDelete] = await Promise.all([
    can("patronnage", "view"),
    can("patronnage", "create"),
    can("patronnage", "modify"),
    can("patronnage", "validate"),
    can("patronnage", "unlock"),
    can("patronnage", "archive"),
    can("patronnage", "delete"),
  ]);
  if (!canView) redirect("/dashboard?erreur=acces_refuse");

  const supabase = await createClient();
  const { data: fichesRaw } = await supabase
    .from("fiches_placement")
    .select(
      `id,numero_ot,statut,statut_precedent,odf_id,premiere_liaison_odf_le,client_code,client_libelle,
       date_emission,date_retour_souhaitee,designation_article,reference_modele,quantite_totale,
       repartition_tailles,tissu_type,grammage,couleur,laize_utile_cm,contraintes,observations,
       valide_le,created_at,
       production_orders(reference),
       traces_placement(id,ordre,reference,reference_patron,longueur_matelas_m,largeur_matelas_cm,nb_plis,
         repartition_par_couche,fichier_path,fichier_nom,charge_le,
         analyses_trace(id,nb_pieces_detectees,facteur_echelle,patrons_reconnus,pieces_non_reconnues,
           taux_reconnaissance,reconnaissance_complete,alerte_miroir,alerte_echelle,analysee_le))`
    )
    .order("created_at", { ascending: false });

  const { data: libraryPieces } = await supabase
    .from("pattern_pieces")
    .select("id,name,patterns(size,pattern_articles(article_code))")
    .order("id");

  const referenceOptions = (libraryPieces ?? []).map((p) => {
    const pat = p.patterns as unknown as { size: string; pattern_articles: { article_code: string } | null } | null;
    return {
      pieceId: p.id as string,
      articleCode: pat?.pattern_articles?.article_code ?? "?",
      size: pat?.size ?? "?",
      name: p.name as string,
    };
  });

  const fiches: FichePlacement[] = (fichesRaw ?? []).map((f) => ({
    id: f.id,
    numeroOt: f.numero_ot,
    statut: f.statut,
    statutPrecedent: f.statut_precedent,
    odfId: f.odf_id,
    odfReference: (f.production_orders as unknown as { reference: string } | null)?.reference ?? null,
    premiereLiaisonOdfLe: f.premiere_liaison_odf_le,
    clientCode: f.client_code,
    clientLibelle: f.client_libelle,
    dateEmission: f.date_emission,
    dateRetourSouhaitee: f.date_retour_souhaitee,
    designationArticle: f.designation_article,
    referenceModele: f.reference_modele,
    quantiteTotale: f.quantite_totale,
    repartitionTailles: f.repartition_tailles ?? {},
    tissuType: f.tissu_type,
    grammage: f.grammage,
    couleur: f.couleur,
    laizeUtileCm: f.laize_utile_cm,
    contraintes: f.contraintes,
    observations: f.observations,
    valideLe: f.valide_le,
    createdAt: f.created_at,
    traces: (f.traces_placement ?? [])
      .sort((a, b) => a.ordre - b.ordre)
      .map((t) => {
        const analyse = (t.analyses_trace as unknown as
          | {
              id: string;
              nb_pieces_detectees: number;
              facteur_echelle: number;
              patrons_reconnus: unknown;
              pieces_non_reconnues: unknown;
              taux_reconnaissance: number;
              reconnaissance_complete: boolean;
              alerte_miroir: boolean;
              alerte_echelle: boolean;
              analysee_le: string;
            }[]
          | null)?.[0];
        return {
          id: t.id,
          ordre: t.ordre,
          reference: t.reference,
          referencePatron: t.reference_patron,
          longueurMatelasM: t.longueur_matelas_m,
          largeurMatelasCm: t.largeur_matelas_cm,
          nbPlis: t.nb_plis,
          repartitionParCouche: t.repartition_par_couche ?? {},
          fichierPath: t.fichier_path,
          fichierNom: t.fichier_nom,
          chargeLe: t.charge_le,
          analyse: analyse
            ? {
                id: analyse.id,
                nbPiecesDetectees: analyse.nb_pieces_detectees,
                facteurEchelle: analyse.facteur_echelle,
                patronsReconnus: (analyse.patrons_reconnus ?? []) as PatronReconnu[],
                piecesNonReconnues: (analyse.pieces_non_reconnues ?? []) as PieceNonReconnue[],
                tauxReconnaissance: analyse.taux_reconnaissance,
                reconnaissanceComplete: analyse.reconnaissance_complete,
                alerteMiroir: analyse.alerte_miroir,
                alerteEchelle: analyse.alerte_echelle,
                analyseeLe: analyse.analysee_le,
              }
            : null,
        };
      }),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patronnage"
        description="Fiches de placement : demandes, tracés Diamino déposés et contrôle géométrique — tolérance zéro avant bon pour coupe."
        action={
          <div className="flex items-center gap-2">
            <Link href="/atelier/patronnage/bibliotheque">
              <Button variant="secondary" size="sm">
                <BookMarked className="h-3.5 w-3.5" /> Bibliothèque de patrons
              </Button>
            </Link>
          </div>
        }
      />

      <FichesPlacementClient
        fiches={fiches}
        referenceOptions={referenceOptions}
        currentUserRole={profile.role}
        permissions={{ canCreate, canModify, canValidate, canUnlock, canArchive, canDelete }}
      />
    </div>
  );
}
