import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ecrireListe, type LigneListe } from "@/lib/personnel/xlsx";

/**
 * Export Excel de la liste du personnel (migration 0159), au « format
 * spécial » que l'import relit : Matricule, Nom, Prénom, Atelier, Fonction,
 * Type de contrat, Statut. `?modele=1` renvoie le classeur vide (en-têtes et
 * listes déroulantes). AUCUN montant : seuls les salaires du livre de paie
 * sont des données sensibles, et ils ne sortent pas d'ici.
 *
 * Même garde que l'écran : droit « voir » du module Personnel. La lecture
 * passe par la RLS de l'utilisateur, jamais par un accès privilégié.
 */
export async function GET(request: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client" || current.profile.role === "livreur" || !(await can("personnel", "view"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const modele = request.nextUrl.searchParams.get("modele") === "1";
  let lignes: LigneListe[] = [];
  if (!modele) {
    const supabase = await createClient();
    const [{ data: employes, error }, { data: ateliers }] = await Promise.all([
      supabase
        .from("employes")
        .select("matricule, nom, prenom, fonction, type_contrat, statut, atelier_source, employes_sections(sections(name))")
        .order("matricule")
        .limit(20000),
      supabase.from("ateliers_vers_sections").select("atelier, libelle"),
    ]);
    if (error) return NextResponse.json({ error: "Export impossible : " + error.message }, { status: 500 });
    const libelles = new Map((ateliers ?? []).map((a) => [a.atelier as string, (a.libelle as string | null) ?? (a.atelier as string)]));
    lignes = (employes ?? []).map((e) => {
      const sections = (e.employes_sections as unknown as { sections: { name: string } | null }[] | null) ?? [];
      const atelier = e.atelier_source ? (libelles.get(e.atelier_source as string) ?? (e.atelier_source as string)) : (sections[0]?.sections?.name ?? "");
      return {
        matricule: e.matricule as string,
        nom: e.nom as string,
        prenom: (e.prenom as string | null) ?? "",
        atelier,
        fonction: (e.fonction as string | null) ?? "",
        type_contrat: (e.type_contrat as string | null) ?? "",
        statut: e.statut as string,
      };
    });
  }

  const classeur = await ecrireListe(lignes);
  const jour = new Date().toISOString().slice(0, 10);
  return new NextResponse(classeur as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${modele ? "modele-liste-personnel" : `personnel-seritex-${jour}`}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
