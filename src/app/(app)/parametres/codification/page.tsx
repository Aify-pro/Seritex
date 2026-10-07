import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { CODING_NATURE_RULES, DEFAULT_CODING, type CodeSegment, type CodingNature } from "@/lib/articles/codification";
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
  const { profile } = await requireModule("codification");
  const supabase = await createClient();
  const [
    { data: rules },
    { data: categories },
    { data: matieres },
    { data: textiles },
    { data: colors },
    { data: sizes },
    { data: depots },
    { data: families },
    { data: consumables },
  ] = await Promise.all([
    supabase.from("coding_rules").select("nature,segments,longueur_max,separateur"),
    supabase.from("product_categories").select("id,nom,code_court").order("nom"),
    supabase.from("matieres").select("id,nom,code_court").order("nom"),
    supabase.from("textiles").select("id,nom,grammage,code_court,matiere_id").eq("active", true).order("nom"),
    supabase.from("colors").select("id,name,code_court").eq("active", true).order("name"),
    supabase.from("sizes").select("id,cle,groupe,libelle,code_court").eq("active", true).order("groupe").order("display_order"),
    supabase.from("sage_depot_by_nature").select("nature,depot,stock_natures(libelle,ordre)"),
    supabase.from("consumable_families").select("id,nom,code_court").order("nom"),
    supabase.from("consumables").select("famille_id"),
  ]);
  const consumablesPerFamily = new Map<string, number>();
  for (const c of consumables ?? []) consumablesPerFamily.set(c.famille_id, (consumablesPerFamily.get(c.famille_id) ?? 0) + 1);
  const isAdmin = profile.role === "administrateur";
  const canEditRefs = isAdmin || profile.role === "responsable_production";
  const canEditDepots = isAdmin || profile.role === "gestionnaire_stock";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Codification"
        description="Règle de génération du code Seritex des articles (ex. TS012JE165BLAXL), codes courts des référentiels et dépôt Sage par nature."
      />

      {/* Une règle par nature d'article (migration 0102) : les déclinaisons en dépendent. */}
      <div className="grid gap-4 xl:grid-cols-3">
        {(Object.keys(CODING_NATURE_RULES) as CodingNature[]).map((nature) => {
          const rule = (rules ?? []).find((r) => r.nature === nature);
          return (
            <Card key={nature}>
              <CardHeader
                title={`Règle de code — ${CODING_NATURE_RULES[nature].label}`}
                description={
                  nature === "pf"
                    ? "Le suffixe d'état — P personnalisé, D 2e choix — s'ajoute au code et compte dans la longueur maximale."
                    : nature === "mp"
                      ? "Déclinaison d'un tissu : grammage × couleur (ex. JE180BLA). Le rouleau ajoute sa laize et son poids."
                      : "Déclinaison d'un consommable : couleur et/ou dimension (ex. COBO0001BLA12)."
                }
              />
              <CardBody>
                <CodingSettingsForm
                  nature={nature}
                  editable={isAdmin}
                  initial={
                    rule
                      ? { segments: rule.segments as CodeSegment[], longueurMax: rule.longueur_max, separateur: rule.separateur }
                      : { ...DEFAULT_CODING, segments: CODING_NATURE_RULES[nature].segments }
                  }
                />
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Un référentiel par nature : il fournit le début du code (modèle PF, matière MP, famille de consommable). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Catégories — produits finis" description="Préfixe du code modèle (TS → TS012)." />
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
          <CardHeader title="Matières — tissus" description="Début du code d'un tissu et de ses déclinaisons : jersey JE, piqué PI…" />
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

        <Card>
          <CardHeader
            title="Familles — consommables"
            description="Préfixe du code consommable, 2 caractères (BO → COBO0001). Un code déjà attribué ne change pas."
          />
          <CardBody className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border">
              {(families ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span>
                    {f.nom}{" "}
                    <span className="text-xs text-foreground-muted">
                      {consumablesPerFamily.get(f.id) ?? 0} consommable{(consumablesPerFamily.get(f.id) ?? 0) > 1 ? "s" : ""}
                    </span>
                  </span>
                  <ShortCodeInput table="consumable_families" id={f.id} value={f.code_court} editable={isAdmin} max={2} />
                </li>
              ))}
              {(families ?? []).length === 0 && <li className="px-3 py-2 text-sm text-foreground-muted">Aucune famille.</li>}
            </ul>
            {isAdmin && <NamedReferentialForm table="consumable_families" label="Nouvelle famille" codeLength={2} />}
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
