import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getFichePlacementById } from "@/lib/patronnage/fiches-query";
import { chargerTraceSource } from "@/lib/patronnage/trace-source";
import { genererTracePdf } from "@/lib/patronnage/trace-pdf";
import { STATUT_TRACE_LABELS } from "@/lib/patronnage/types";
import { buildOrdreTracePdf, libelleTaille, type OrdreTracePdfArticle, type OrdreTracePdfTrace } from "@/lib/pdf/ordre-trace-pdf";

const STATUT_FICHE: Record<string, string> = {
  demande: "Demande",
  traces_deposes: "Tracés déposés",
  bon_pour_coupe: "Bon pour coupe",
  archive: "Archivé",
};
const FORME: Record<string, string> = { ouvert: "Ouvert (au large)", tubulaire: "Tubulaire" };

/**
 * Ordre de tracé imprimable (fiche de placement), construit à la demande.
 * `?trace=<id>` : la seule fiche matelas de ce tracé (module Coupe).
 * Lecture sous la RLS de l'utilisateur, comme les autres PDF de l'application.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const traceSeule = new URL(req.url).searchParams.get("trace");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const fiche = await getFichePlacementById(id);
  if (!fiche) return NextResponse.json({ error: "Ordre de tracé introuvable" }, { status: 404 });

  const traces = fiche.traces.filter((t) => (traceSeule ? t.id === traceSeule : t.statut !== "annule"));
  if (traceSeule && traces.length === 0) return NextResponse.json({ error: "Tracé introuvable" }, { status: 404 });

  // Articles d'ODF : regroupés, ou l'article unique de la fiche.
  const lineIds = fiche.regroupee ? fiche.lignesRegroupees.map((l) => l.lineId) : fiche.lineId ? [fiche.lineId] : [];
  const traceIds = traces.map((t) => t.id);
  const [{ data: lignesOdf }, { data: modele }, { data: rouleaux }] = await Promise.all([
    lineIds.length > 0
      ? supabase
          .from("production_order_lines")
          .select("id,description,quantity,production_order_sizes(taille,quantite_demandee),production_orders(reference,status,companies(name))")
          .in("id", lineIds)
      : Promise.resolve({ data: [] }),
    fiche.productModelId
      ? supabase.from("product_models").select("name").eq("id", fiche.productModelId).maybeSingle()
      : Promise.resolve({ data: null }),
    traceIds.length > 0
      ? supabase.from("trace_rouleaux").select("trace_id,textile_rolls(code,laize_cm,bain,poids_kg)").in("trace_id", traceIds)
      : Promise.resolve({ data: [] }),
  ]);

  type LigneOdf = {
    id: string;
    description: string;
    quantity: number | null;
    production_order_sizes: { taille: string; quantite_demandee: number }[] | null;
    production_orders: { reference: string; status: string; companies: { name: string } | null } | null;
  };
  const parLigne = new Map(((lignesOdf ?? []) as unknown as LigneOdf[]).map((l) => [l.id, l]));
  const clientDe = (lineId: string) => parLigne.get(lineId)?.production_orders?.companies?.name ?? (parLigne.get(lineId)?.production_orders ? "Stock" : null);
  const odfDe = (lineId: string) => parLigne.get(lineId)?.production_orders?.reference ?? null;

  const articles: OrdreTracePdfArticle[] = fiche.regroupee
    ? fiche.lignesRegroupees.map((l) => ({
        odf: l.odfReference,
        client: clientDe(l.lineId),
        article: l.description,
        couleur: l.couleur ?? ([...new Set(l.semiFinis.map((p) => p.couleur).filter(Boolean))].join(", ") || null),
        quantite: l.quantite,
        tailles: Object.entries(l.repartition).map(([t, q]) => [libelleTaille(t), q] as [string, number]),
        pieces: l.semiFinis.map((p) => ({ nom: p.nom, couleur: p.couleur })),
        odfAnnule: l.odfAnnule,
      }))
    : fiche.lineId
      ? [
          {
            odf: odfDe(fiche.lineId),
            client: clientDe(fiche.lineId) ?? fiche.clientLibelle,
            article: parLigne.get(fiche.lineId)?.description ?? fiche.designationArticle ?? "-",
            couleur: fiche.couleur,
            quantite: parLigne.get(fiche.lineId)?.quantity ?? fiche.quantiteTotale,
            tailles: (parLigne.get(fiche.lineId)?.production_order_sizes ?? []).map((s) => [libelleTaille(s.taille), s.quantite_demandee] as [string, number]),
            pieces: [],
            odfAnnule: parLigne.get(fiche.lineId)?.production_orders?.status === "annulee",
          },
        ]
      : [
          {
            odf: null,
            client: fiche.clientLibelle,
            article: fiche.designationArticle ?? "-",
            couleur: fiche.couleur,
            quantite: fiche.quantiteTotale,
            tailles: Object.entries(fiche.repartitionTailles).map(([t, q]) => [libelleTaille(t), q] as [string, number]),
            pieces: [],
            odfAnnule: false,
          },
        ];

  type RouleauRow = { trace_id: string; textile_rolls: { code: string; laize_cm: number | null; bain: string | null; poids_kg: number | null } | null };
  const baseUrl = await getBaseUrl();
  const ligneRegroupee = new Map(fiche.lignesRegroupees.map((l) => [l.lineId, l]));

  const tracesPdf: OrdreTracePdfTrace[] = await Promise.all(
    traces.map(async (t) => {
      const regroupe = t.couches.length > 0;
      const idsPieces = new Set(t.pieces.map((p) => p.semiFiniId));
      const couchesParArticle = t.couches.map((c) => {
        const l = ligneRegroupee.get(c.lineId);
        const couleurs = [...new Set((l?.semiFinis ?? []).filter((p) => idsPieces.has(p.id)).map((p) => p.couleur ?? "à préciser"))];
        return {
          libelle: `${l?.odfReference ?? odfDe(c.lineId) ?? "-"} · ${l?.description ?? parLigne.get(c.lineId)?.description ?? "-"}`,
          couleur: couleurs.length > 0 ? couleurs.join(", ") : (l?.couleur ?? null),
          couches: c.nbCouches,
          odfAnnule: l?.odfAnnule ?? false,
        };
      });
      const piecesParCouche = regroupe
        ? t.pieces.map((p) => ({ piece: p.semiFiniNom, taille: libelleTaille(p.taille), quantite: p.quantiteParCouche }))
        : Object.entries(t.repartitionParCouche)
            .filter(([, q]) => Number(q) > 0)
            .map(([taille, q]) => ({ piece: fiche.designationArticle ?? "Vêtement", taille: libelleTaille(taille), quantite: Number(q) }));

      // Dessin du tracé sans marquage : facultatif, le document se fait sans.
      let dessin: Uint8Array | null = null;
      if (t.fichierPath) {
        try {
          const source = await chargerTraceSource(supabase, t.id, fiche.id);
          if (!("error" in source)) {
            const r = await genererTracePdf(source.contours, null);
            if (!("error" in r)) dessin = r.pdf;
          }
        } catch {
          dessin = null;
        }
      }

      return {
        reference: t.reference,
        statut: STATUT_TRACE_LABELS[t.statut] ?? t.statut,
        forme: FORME[t.forme] ?? t.forme,
        referencePatron: t.referencePatron,
        longueurCm: t.longueurMatelasCm,
        laizeCm: t.largeurMatelasCm,
        couches: regroupe ? t.couches.reduce((s, c) => s + c.nbCouches, 0) : t.nbPlis,
        tissus: t.compositionTissus ?? [],
        couchesParArticle,
        piecesParCouche,
        rouleaux: ((rouleaux ?? []) as unknown as RouleauRow[])
          .filter((r) => r.trace_id === t.id && r.textile_rolls)
          .map((r) => ({
            code: r.textile_rolls!.code,
            laizeCm: r.textile_rolls!.laize_cm !== null ? Number(r.textile_rolls!.laize_cm) : null,
            bain: r.textile_rolls!.bain,
            poidsKg: r.textile_rolls!.poids_kg !== null ? Number(r.textile_rolls!.poids_kg) : null,
          })),
        url: `${baseUrl}/atelier/patronnage/${fiche.id}?trace=${t.id}`,
        dessin,
      };
    })
  );

  const clients = [...new Set(articles.map((a) => a.client).filter(Boolean))];
  const pdf = await buildOrdreTracePdf({
    numeroOt: fiche.numeroOt,
    statutLabel: STATUT_FICHE[fiche.statut] ?? fiche.statut,
    regroupee: fiche.regroupee,
    designation: fiche.designationArticle ?? (fiche.regroupee ? "Pièces" : "-"),
    modele: (modele as { name: string } | null)?.name ?? fiche.referenceModele,
    tissu: fiche.tissuType,
    grammage: fiche.grammage,
    laizeUtileCm: fiche.laizeUtileCm,
    couleur: fiche.regroupee ? null : fiche.couleur,
    client: clients.length > 0 ? clients.join(", ") : fiche.clientLibelle,
    dateEmission: fiche.dateEmission ? formatFr(fiche.dateEmission) : null,
    dateRetour: fiche.dateRetourSouhaitee ? formatFr(fiche.dateRetourSouhaitee) : null,
    contraintes: fiche.contraintes,
    observations: fiche.observations,
    articles,
    traces: tracesPdf,
    url: `${baseUrl}/atelier/patronnage/${fiche.id}`,
    generatedAt: formatFr(new Date().toISOString()),
    ficheMatelasSeule: !!traceSeule,
  });

  const nom = traceSeule ? `fiche-matelas-${traces[0].reference}` : `ordre-de-trace-${fiche.numeroOt}`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nom.replace(/"/g, "")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function formatFr(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
