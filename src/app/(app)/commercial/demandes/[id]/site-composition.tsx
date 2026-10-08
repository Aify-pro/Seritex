import { Download, FileText, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { BoutonSeparation } from "@/components/separation/bouton-separation";

/** Composition envoyée par le client depuis l'outil « Personnaliser » du site (migration 0110). */
export interface SitePersonnalisation {
  modele: string;
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
  }[];
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
