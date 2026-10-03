import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { DEFAULT_CODING, type CodeSegment } from "@/lib/articles/codification";
import {
  CodingSettingsForm,
  NamedReferentialForm,
  SageDepotInput,
  ShortCodeInput,
  TextileMatiereSelect,
} from "./codification-forms";

/**
 * Paramètres > Codification (COM-0, A4) : le code Seritex des articles est
 * généré automatiquement selon cette règle (D10 : la codification Sage est
 * abandonnée). Codes courts des référentiels, dépôt Sage par nature (D5).
 */
export default async function CodificationPage() {
  const { profile } = await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const supabase = await createClient();
  const [
    { data: settings },
    { data: categories },
    { data: matieres },
    { data: textiles },
    { data: colors },
    { data: sizes },
    { data: depots },
  ] = await Promise.all([
    supabase.from("coding_settings").select("*").maybeSingle(),
    supabase.from("product_categories").select("id,nom,code_court").order("nom"),
    supabase.from("matieres").select("id,nom,code_court").order("nom"),
    supabase.from("textiles").select("id,nom,grammage,code_court,matiere_id").eq("active", true).order("nom"),
    supabase.from("colors").select("id,name,code_court").eq("active", true).order("name"),
    supabase.from("sizes").select("id,cle,groupe,libelle,code_court").eq("active", true).order("groupe").order("display_order"),
    supabase.from("sage_depot_by_nature").select("nature,depot,stock_natures(libelle,ordre)"),
  ]);
  const isAdmin = profile.role === "administrateur";
  const canEditRefs = isAdmin || profile.role === "responsable_production";
  const canEditDepots = isAdmin || profile.role === "gestionnaire_stock";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Codification"
        description="Règle de génération du code Seritex des articles (ex. TS012JE165BLAXL), codes courts des référentiels et dépôt Sage par nature."
      />

      <Card>
        <CardHeader
          title="Règle de code"
          description="Segments du code, dans l'ordre. Le suffixe d'état — P personnalisé, D 2e choix — s'ajoute au code et compte dans la longueur maximale."
        />
        <CardBody>
          <CodingSettingsForm
            editable={isAdmin}
            initial={
              settings
                ? { segments: settings.segments as CodeSegment[], longueurMax: settings.longueur_max, separateur: settings.separateur }
                : DEFAULT_CODING
            }
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Catégories" description="Préfixe du code modèle (TS → TS012)." />
          <CardBody className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border">
              {(categories ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  {c.nom} <ShortCodeInput table="product_categories" id={c.id} value={c.code_court} editable={canEditRefs} />
                </li>
              ))}
            </ul>
            {canEditRefs && <NamedReferentialForm table="product_categories" label="Nouvelle catégorie" />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Matières" description="Portée par le modèle (A6) : jersey JE, piqué PI…" />
          <CardBody className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border">
              {(matieres ?? []).map((m) => (
                <li key={m.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  {m.nom} <ShortCodeInput table="matieres" id={m.id} value={m.code_court} editable={canEditRefs} />
                </li>
              ))}
              {(matieres ?? []).length === 0 && <li className="px-3 py-2 text-sm text-foreground-muted">Aucune matière.</li>}
            </ul>
            {canEditRefs && <NamedReferentialForm table="matieres" label="Nouvelle matière" />}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Textiles (grammages)" description="Chaque textile est une matière dans un grammage ; son code court est le grammage (165)." />
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {(textiles ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
                <span>
                  {t.nom} <span className="text-xs text-foreground-muted">{t.grammage ? `${t.grammage} g/m²` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <TextileMatiereSelect textileId={t.id} matiereId={t.matiere_id} matieres={matieres ?? []} editable={canEditRefs} />
                  <ShortCodeInput table="textiles" id={t.id} value={t.code_court} editable={canEditRefs} max={5} />
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Couleurs" />
          <CardBody className="max-h-96 overflow-y-auto p-0">
            <ul className="divide-y divide-border">
              {(colors ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between px-5 py-1.5 text-sm">
                  {c.name} <ShortCodeInput table="colors" id={c.id} value={c.code_court} editable={canEditRefs} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tailles" description="Deux tailles de groupes différents (M homme, M femme) doivent avoir des codes distincts si un modèle les porte toutes les deux." />
          <CardBody className="max-h-96 overflow-y-auto p-0">
            <ul className="divide-y divide-border">
              {(sizes ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between px-5 py-1.5 text-sm">
                  <span>
                    {s.libelle} <span className="text-xs text-foreground-muted">{s.groupe}</span>
                  </span>
                  <ShortCodeInput table="sizes" id={s.id} value={s.code_court} editable={canEditRefs} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Dépôt Sage par nature" description="Pré-rempli à l'export des mouvements, modifiable ligne par ligne (D5)." />
        <CardBody className="space-y-2">
          {(depots ?? [])
            .sort(
              (a, b) =>
                ((a.stock_natures as unknown as { ordre: number } | null)?.ordre ?? 0) -
                ((b.stock_natures as unknown as { ordre: number } | null)?.ordre ?? 0)
            )
            .map((d) => (
              <div key={d.nature} className="flex items-center justify-between gap-3 text-sm">
                <span>{(d.stock_natures as unknown as { libelle: string } | null)?.libelle ?? d.nature}</span>
                <SageDepotInput nature={d.nature} depot={d.depot} editable={canEditDepots} />
              </div>
            ))}
        </CardBody>
      </Card>
    </div>
  );
}
