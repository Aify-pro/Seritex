import { Download, FileText, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { BoutonSeparation } from "@/components/separation/bouton-separation";
import { estFonce } from "@/lib/separation/nuancier";
import { chargerEncres, chargerParametresSerigraphie } from "@/lib/separation/encres-serveur";
import { chargerRecettes } from "@/lib/separation/recettes-serveur";
import { chargerParc } from "@/lib/atelier/parc-serveur";
import { requireUser } from "@/lib/auth/current-user";

/** Composition envoyée par le client depuis l'outil « Personnaliser » du site (migration 0110). */
export interface SitePersonnalisation {
  modele: string;
  couleur_id?: string | null;
  couleur?: string | null;
  grammage?: number | null;
  quantite: number;
  repartition?: Record<string, number>;
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

/** « 2 cm vers la droite, 1,5 cm plus haut, incliné de 15° » (vue du client, face au vêtement). */
function position(m: SitePersonnalisation["marquages"][number]): string | null {
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

/**
 * Fichiers (logos, maquette PDF) lus par URL signée : la ligne n'est visible
 * que si l'utilisateur voit la demande (RLS de request_site_files), et c'est
 * seulement après cette lecture que le serveur signe le lien.
 */
export async function SiteComposition({ requestId, composition }: { requestId: string; composition: SitePersonnalisation }) {
  const supabase = await createClient();
  const { data: files } = await supabase
    .from("request_site_files")
    .select("path,file_name,mime_type,role,marquage")
    .eq("request_id", requestId)
    .order("role", { ascending: false })
    .order("marquage");
  const paths = (files ?? []).map((f) => f.path as string);
  const signed = paths.length
    ? ((await createAdminClient().storage.from("site-personnalisation").createSignedUrls(paths, 3600)).data ?? [])
    : [];
  const url = (path: string) => signed.find((s) => s.path === path)?.signedUrl ?? null;
  // Pour la séparation des couleurs : nuancier, et textile foncé (sous-couche conseillée).
  const avecImages = (files ?? []).some((f) => (f.mime_type as string | null)?.startsWith("image/"));
  const [encres, parametres, recettes, parc, { data: textile }] = avecImages
    ? await Promise.all([
        chargerEncres(supabase),
        chargerParametresSerigraphie(supabase),
        requireUser().then(({ profile }) => chargerRecettes(profile, supabase)),
        chargerParc(supabase, { actifsSeulement: true }),
        composition.couleur_id
          ? supabase.from("colors").select("hex,famille").eq("id", composition.couleur_id).maybeSingle()
          : composition.couleur
            ? supabase.from("colors").select("hex,famille").eq("name", composition.couleur).limit(1).maybeSingle()
            : Promise.resolve({ data: null }),
      ])
    : [[], null, [], { machines: [], ecrans: [] }, { data: null }];
  const textileFonce = textile ? textile.famille === "fonce" || estFonce(textile.hex as string | null) : false;
  const repartition = Object.entries(composition.repartition ?? {});

  return (
    <Card>
      <CardHeader
        title="Composition envoyée depuis le site"
        description="Faite par le client avec l'outil « Personnaliser » de www.seritex.ci. L'article, le grammage et les emplacements sont repris dans le devis."
      />
      <CardBody className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-foreground-muted">Article</dt>
          <dd className="font-medium">{composition.modele}</dd>
          {composition.couleur && (
            <>
              <dt className="text-foreground-muted">Couleur</dt>
              <dd>{composition.couleur}</dd>
            </>
          )}
          {composition.grammage && (
            <>
              <dt className="text-foreground-muted">Tissu</dt>
              <dd>{composition.grammage} g/m²</dd>
            </>
          )}
          <dt className="text-foreground-muted">Quantité</dt>
          <dd>
            {composition.quantite} pièce(s)
            {repartition.length > 0
              ? ` — ${repartition.map(([k, v]) => `${k.split("/").pop()} : ${v}`).join(", ")}`
              : " — répartition à proposer avec le devis"}
          </dd>
        </dl>

        <ul className="space-y-2">
          {composition.marquages.map((m, i) => (
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
            </li>
          ))}
        </ul>

        {(files ?? []).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Fichiers du client</p>
            <ul className="mt-2 flex flex-wrap gap-3">
              {(files ?? []).map((f) => {
                const lien = url(f.path as string);
                const image = (f.mime_type as string | null)?.startsWith("image/");
                return (
                  <li key={f.path as string} className="flex items-center gap-2">
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
                        <span className="block font-medium">{f.role === "maquette" ? "Maquette (PDF)" : `Logo${f.marquage ? ` · marquage ${f.marquage}` : ""}`}</span>
                        <span className="block text-xs text-foreground-muted">{f.file_name as string}</span>
                      </span>
                      <Download className="h-4 w-4 text-foreground-muted" />
                    </a>
                    {image && lien && (
                      <BoutonSeparation
                        url={lien}
                        nom={f.file_name as string}
                        largeurCm={f.marquage ? composition.marquages[(f.marquage as number) - 1]?.largeur_cm : null}
                        encres={encres}
                        textileFonce={textileFonce}
                        parametres={parametres}
                        quantite={composition.quantite}
                        recettes={recettes}
                        machines={parc.machines}
                        ecransParc={parc.ecrans}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-foreground-muted">
              Fichiers d&apos;aperçu : pour la production, demandez au client le fichier source (vectoriel de préférence).
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
