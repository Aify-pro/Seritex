import { ChevronRight, Download, FileText, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { BoutonSeparation } from "@/components/separation/bouton-separation";
import { estFonce } from "@/lib/separation/nuancier";
import { chargerEncres, chargerParametresSerigraphie } from "@/lib/separation/encres-serveur";
import { chargerRecettes } from "@/lib/separation/recettes-serveur";
import { chargerParc } from "@/lib/atelier/parc-serveur";
import { requireUser } from "@/lib/auth/current-user";

/** Un article de la composition envoyée par le client depuis l'outil « Personnaliser » du site (migration 0110). */
export interface SiteArticle {
  modele: string;
  couleur_id?: string | null;
  couleur?: string | null;
  grammage?: number | null;
  quantite: number;
  repartition?: Record<string, number>;
  /** Couleur par zone choisie sur le site (0121). */
  couleurs_zones?: Record<string, { zone: string; couleur: string }> | null;
  marquages: {
    emplacement_libelle?: string;
    largeur_cm?: number;
    technique_libelle?: string;
    nb_couleurs?: number;
    degrade?: boolean;
    consigne?: string;
    alertes?: string[];
    /** Position ajustée par le client sur l'aperçu : décalage du centre (cm, droite / bas) et inclinaison (degrés). */
    decalage_x_cm?: number;
    decalage_y_cm?: number;
    rotation_deg?: number;
  }[];
}

/**
 * Composition d'une demande du site : un seul article (format historique, 0110)
 * ou plusieurs (panier de l'e-shop) sous la clé `articles`. Pour retrouver à
 * quel article appartient un fichier, `request_site_files.article` (à partir de 1,
 * absent = 1) est lu avec `marquage` ; sans plan de ce côté, tout va au 1er article.
 */
export type SitePersonnalisation = SiteArticle | { articles: SiteArticle[] };

export function articlesDe(p: SitePersonnalisation): SiteArticle[] {
  return "articles" in p && Array.isArray(p.articles) ? p.articles : [p as SiteArticle];
}

/** « 2 cm vers la droite, 1,5 cm plus haut, incliné de 15° » (vue du client, face au vêtement). */
function position(m: SiteArticle["marquages"][number]): string | null {
  const n = (v: number) => Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const dx = m.decalage_x_cm ?? 0;
  const dy = m.decalage_y_cm ?? 0;
  const r = m.rotation_deg ?? 0;
  const parties = [
    dx ? `${n(dx)} cm vers la ${dx > 0 ? "droite" : "gauche"}` : null,
    dy ? `${n(dy)} cm plus ${dy > 0 ? "bas" : "haut"}` : null,
    r ? `incliné de ${r}°` : null,
  ].filter(Boolean);
  return parties.length ? parties.join(", ") : null;
}

type FichierSite = {
  path: string;
  file_name: string;
  mime_type: string | null;
  role: string;
  marquage: number | null;
  /** Rang de l'article (à partir de 1) quand la demande en porte plusieurs ; absent = 1. */
  article?: number | null;
};

/**
 * Fichiers (logos, maquette PDF) lus par URL signée : la ligne n'est visible
 * que si l'utilisateur voit la demande (RLS de request_site_files), et c'est
 * seulement après cette lecture que le serveur signe le lien.
 *
 * Un article = une ligne dépliable (un panier peut en porter plusieurs) ; le
 * visuel de chaque marquage est rangé dans le cadre de ce marquage, la maquette
 * de l'article en bas de l'article.
 */
export async function SiteComposition({ requestId, composition }: { requestId: string; composition: SitePersonnalisation }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("request_site_files")
    .select("*")
    .eq("request_id", requestId)
    .order("role", { ascending: false })
    .order("marquage");
  const files = (data ?? []) as unknown as FichierSite[];
  const signed = files.length
    ? ((await createAdminClient().storage.from("site-personnalisation").createSignedUrls(files.map((f) => f.path), 3600)).data ?? [])
    : [];
  const url = (path: string) => signed.find((s) => s.path === path)?.signedUrl ?? null;
  const articles = articlesDe(composition);

  // Pour la séparation des couleurs : nuancier, et textile foncé (sous-couche conseillée) par article.
  const avecImages = files.some((f) => f.mime_type?.startsWith("image/"));
  const [encres, parametres, recettes, parc] = avecImages
    ? await Promise.all([
        chargerEncres(supabase),
        chargerParametresSerigraphie(supabase),
        requireUser().then(({ profile }) => chargerRecettes(profile, supabase)),
        chargerParc(supabase, { actifsSeulement: true }),
      ])
    : [[], null, [], { machines: [], ecrans: [] }];
  const textilesFonces = await Promise.all(
    articles.map(async (a) => {
      if (!avecImages) return false;
      const { data: textile } = a.couleur_id
        ? await supabase.from("colors").select("hex,famille").eq("id", a.couleur_id).maybeSingle()
        : a.couleur
          ? await supabase.from("colors").select("hex,famille").eq("name", a.couleur).limit(1).maybeSingle()
          : { data: null };
      return textile ? textile.famille === "fonce" || estFonce(textile.hex as string | null) : false;
    }),
  );

  function Fichier({ f, article, textileFonce }: { f: FichierSite; article: SiteArticle; textileFonce: boolean }) {
    const lien = url(f.path);
    const image = f.mime_type?.startsWith("image/");
    return (
      <li className="flex items-center gap-2">
        <a
          href={lien ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-surface-muted"
        >
          {image && lien ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lien} alt="" className="h-10 w-10 rounded object-contain" />
          ) : f.role === "maquette" ? (
            <FileText className="h-5 w-5 text-brand" />
          ) : (
            <ImageIcon className="h-5 w-5 text-foreground-muted" />
          )}
          <span>
            <span className="block font-medium">{f.role === "maquette" ? "Maquette (PDF)" : "Visuel"}</span>
            <span className="block text-xs text-foreground-muted">{f.file_name}</span>
          </span>
          <Download className="h-4 w-4 text-foreground-muted" />
        </a>
        {image && lien && (
          <BoutonSeparation
            url={lien}
            nom={f.file_name}
            largeurCm={f.marquage ? article.marquages[f.marquage - 1]?.largeur_cm : null}
            encres={encres}
            textileFonce={textileFonce}
            parametres={parametres}
            quantite={article.quantite}
            recettes={recettes}
            machines={parc.machines}
            ecransParc={parc.ecrans}
          />
        )}
      </li>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Composition envoyée depuis le site"
        description={
          articles.length > 1
            ? `${articles.length} articles, faits par le client avec l'outil « Personnaliser » de www.seritex.ci. Cliquez sur un article pour voir ses détails.`
            : "Faite par le client avec l'outil « Personnaliser » de www.seritex.ci. L'article, le grammage et les emplacements sont repris dans le devis."
        }
      />
      <CardBody className="space-y-2 text-sm">
        {articles.map((a, n) => {
          const rang = n + 1;
          const siens = files.filter((f) => (f.article ?? 1) === rang);
          const maquettes = siens.filter((f) => f.role === "maquette");
          const logos = siens.filter((f) => f.role !== "maquette");
          const dansUnCadre = (i: number) => logos.filter((f) => f.marquage === i + 1);
          const orphelins = logos.filter((f) => !f.marquage || f.marquage > a.marquages.length);
          const repartition = Object.entries(a.repartition ?? {});
          const textileFonce = textilesFonces[n];
          return (
            <details key={n} open={articles.length === 1} className="group rounded-md border border-border">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3 hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-90" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {articles.length > 1 ? `${rang}. ` : ""}
                    {a.modele}
                    {a.couleur ? ` · ${a.couleur}` : ""}
                    {a.grammage ? ` · ${a.grammage} g/m²` : ""}
                  </span>
                  <span className="block text-xs text-foreground-muted">
                    {a.quantite} pièce(s) · {a.marquages.length} marquage(s)
                  </span>
                </span>
              </summary>

              <div className="space-y-4 border-t border-border p-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-foreground-muted">Article</dt>
                  <dd className="font-medium">{a.modele}</dd>
                  {a.couleur && (
                    <>
                      <dt className="text-foreground-muted">Couleur</dt>
                      <dd>{a.couleur}</dd>
                    </>
                  )}
                  {a.grammage && (
                    <>
                      <dt className="text-foreground-muted">Tissu</dt>
                      <dd>{a.grammage} g/m²</dd>
                    </>
                  )}
                  {a.couleurs_zones && Object.keys(a.couleurs_zones).length > 0 && (
                    <>
                      <dt className="text-foreground-muted">Couleurs par zone</dt>
                      <dd>
                        {Object.values(a.couleurs_zones)
                          .map((z) => `${z.zone} : ${z.couleur}`)
                          .join(" · ")}
                      </dd>
                    </>
                  )}
                  <dt className="text-foreground-muted">Quantité</dt>
                  <dd>
                    {a.quantite} pièce(s)
                    {repartition.length > 0
                      ? ` — ${repartition.map(([k, v]) => `${k.split("/").pop()} : ${v}`).join(", ")}`
                      : " — répartition à proposer avec le devis"}
                  </dd>
                </dl>

                <ul className="space-y-2">
                  {a.marquages.map((m, i) => (
                    <li key={i} className="rounded-md border border-border p-3">
                      <p className="font-medium">
                        Marquage {i + 1} · {m.emplacement_libelle ?? "Emplacement"}
                        {m.largeur_cm ? ` · ${m.largeur_cm} cm` : ""}
                        {m.technique_libelle ? ` · ${m.technique_libelle}` : ""}
                      </p>
                      <p className="text-xs text-foreground-muted">
                        {m.degrade ? "Dégradés détectés" : m.nb_couleurs ? `${m.nb_couleurs} couleur(s) détectée(s)` : "Pas de logo analysé"}
                        {m.alertes?.length ? ` · À vérifier : ${m.alertes.join(" ; ")}` : ""}
                      </p>
                      {position(m) && (
                        <p className="mt-1 text-xs">
                          <span className="text-foreground-muted">Position ajustée par le client (vue de face) :</span> {position(m)}
                        </p>
                      )}
                      {m.consigne && <p className="mt-1">« {m.consigne} »</p>}
                      {dansUnCadre(i).length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-3">
                          {dansUnCadre(i).map((f) => (
                            <Fichier key={f.path} f={f} article={a} textileFonce={textileFonce} />
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>

                {orphelins.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Visuels non rattachés à un marquage</p>
                    <ul className="mt-2 flex flex-wrap gap-3">
                      {orphelins.map((f) => (
                        <Fichier key={f.path} f={f} article={a} textileFonce={textileFonce} />
                      ))}
                    </ul>
                  </div>
                )}

                {maquettes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Maquette de l&apos;article</p>
                    <ul className="mt-2 flex flex-wrap gap-3">
                      {maquettes.map((f) => (
                        <Fichier key={f.path} f={f} article={a} textileFonce={textileFonce} />
                      ))}
                    </ul>
                  </div>
                )}

                {siens.length > 0 && (
                  <p className="text-xs text-foreground-muted">
                    Fichiers d&apos;aperçu : pour la production, demandez au client le fichier source (vectoriel de préférence).
                  </p>
                )}
              </div>
            </details>
          );
        })}
      </CardBody>
    </Card>
  );
}
