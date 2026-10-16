import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { chargerAbsences, chargerCommerciaux, type Commercial } from "@/lib/prospection/serveur";
import {
  MOTIFS_ABSENCE,
  NATURES_VISITE,
  SOURCES_VISITE,
  STATUTS_ABSENCE,
  STATUTS_JOURNEE,
  aujourdhuiAbidjan,
  dateCourte,
  type NatureVisite,
  type SourceVisite,
  type StatutAbsence,
  type StatutJournee,
} from "@/lib/prospection/constantes";
import { BoutonAbsence, RetirerAbsence, TraiterAbsence } from "./absences";
import { FilterBar, type FilterField } from "@/components/filters/filter-bar";
import { Presets } from "@/components/filters/presets";
import { ListPagination } from "@/components/filters/pagination";
import { PAGE_SIZES, type ListQuery, type RawParams } from "@/lib/filters/params";
import { VISITE_NATURES, VISITE_SORTS, VISITE_SOURCES, applyVisiteFilters, parseVisiteFilters, type VisiteSortKey } from "@/lib/prospection/filtres";

const TON_ABSENCE: Record<StatutAbsence, "warning" | "success" | "danger"> = {
  demandee: "warning",
  validee: "success",
  refusee: "danger",
};

/**
 * Prospection (lot PR-0, migration 0122) : qui doit un rapport aujourd'hui,
 * et les absences. Le planning des visites et les rapports arrivent avec
 * les lots suivants.
 */
export default async function ProspectionPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const { profile } = await requireModule("prospection");
  const [direction, peutDeclarer] = await Promise.all([can("prospection", "validate"), can("prospection", "create")]);
  const aujourdhui = aujourdhuiAbidjan();
  const raw = await searchParams;
  const filtres = parseVisiteFilters(raw);
  const supabase = await createClient();

  const commerciaux = await chargerCommerciaux();
  const suivis: Commercial[] = direction ? commerciaux.filter((c) => c.actif) : commerciaux.filter((c) => c.appUserId === profile.id);
  const statuts = await Promise.all(
    suivis.map(async (c) => {
      const { data } = await supabase.rpc("prospection_statut_journee", { p_user: c.appUserId, p_jour: aujourdhui });
      return { commercial: c, statut: (data as StatutJournee | null) ?? "hors_prospection" };
    })
  );
  const attendus = statuts.filter((s) => s.statut === "due").length;

  // Journal des visites (0124, vue visites_list 0134) : recherche, filtres, tri et pagination en base.
  // `aRattacher` : visites sans fiche client (prospect non fiché, code inconnu de la reprise Excel).
  const depart = (filtres.page - 1) * filtres.taille;
  const [visitesRes, { count: aRattacher }] = await Promise.all([
    applyVisiteFilters(
      supabase
        .from("visites_list")
        .select("id,jour,nature,source,compte_rendu,tiers,a_rattacher,auteur", { count: "exact" }) as unknown as ListQuery,
      filtres
    ).range(depart, depart + filtres.taille - 1),
    supabase.from("visites").select("id", { count: "exact", head: true }).is("company_id", null),
  ]);
  const visites = ((visitesRes.data ?? []) as {
    id: string;
    jour: string;
    nature: NatureVisite;
    source: SourceVisite;
    compte_rendu: string;
    tiers: string | null;
    a_rattacher: boolean;
    auteur: string | null;
  }[]).map((v) => ({
    id: v.id,
    jour: v.jour,
    nature: v.nature,
    source: v.source,
    compteRendu: v.compte_rendu,
    tiers: v.tiers ?? "—",
    aRattacher: v.a_rattacher,
    auteur: v.auteur ?? "—",
  }));
  const champsVisites: FilterField[] = [
    { kind: "multi", key: "nature", label: "Nature", primary: true, options: VISITE_NATURES.map((n) => ({ value: n, label: NATURES_VISITE[n] })) },
    ...(direction
      ? [
          {
            kind: "select" as const,
            key: "commercial",
            label: "Commercial",
            placeholder: "Tous",
            options: commerciaux.map((c) => ({ value: c.appUserId, label: c.nom })),
          },
        ]
      : []),
    { kind: "select", key: "source", label: "Provenance", placeholder: "Toutes", options: VISITE_SOURCES.map((v) => ({ value: v, label: SOURCES_VISITE[v] })) },
    {
      kind: "select",
      key: "rattachement",
      label: "Rattachement",
      placeholder: "Peu importe",
      options: [
        { value: "a_rattacher", label: "À rattacher à une fiche" },
        { value: "rattachee", label: "Déjà rattachées" },
      ],
    },
    { kind: "date", key: "du", label: "Visites à partir du" },
    { kind: "date", key: "au", label: "Visites jusqu'au" },
  ];
  const paramsVisites = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));

  const debutMois = `${aujourdhui.slice(0, 7)}-01`;
  const absences = await chargerAbsences(debutMois);
  const aTraiter = absences.filter((a) => a.statut === "demandee");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospection"
        description="Suivi des commerciaux : rapports attendus et absences. Le planning des visites, les rapports WhatsApp et les synthèses hebdomadaires arrivent avec les prochains lots."
      />

      <Card>
        <CardHeader
          title={`Aujourd'hui · ${dateCourte(aujourdhui)}`}
          description={
            direction
              ? `${attendus} ${attendus > 1 ? "commerciaux doivent" : "commercial doit"} au moins un rapport aujourd'hui.`
              : "Au moins un rapport par jour de visites, par WhatsApp ou dans le module."
          }
        />
        <CardBody className="p-0">
          {statuts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">
              {direction
                ? "Aucun commercial enregistré : ajoutez-les dans Paramètres > Commercial > Prospection."
                : "Votre compte n'est pas encore enregistré comme commercial (Paramètres > Prospection)."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {statuts.map(({ commercial, statut }) => (
                <li key={commercial.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-medium text-foreground">{commercial.nom}</span>
                    {commercial.zone && <span className="ml-2 text-xs text-foreground-muted">{commercial.zone}</span>}
                  </span>
                  <Badge tone={statut === "due" ? "brand" : "neutral"} dot={statut === "due"}>
                    {STATUTS_JOURNEE[statut]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        <Presets module="prospection" />
        <FilterBar
          fields={champsVisites}
          sorts={(Object.keys(VISITE_SORTS) as VisiteSortKey[]).map((k) => ({ value: k, label: VISITE_SORTS[k].label }))}
          defaultSort={{ tri: "date", ordre: "desc" }}
          placeholder="Rechercher une visite : client, prospect, compte rendu, commercial…"
          searchLabel="Rechercher une visite"
          pageSizes={PAGE_SIZES}
        />
      </div>

      <Card>
        <CardHeader
          title="Journal des visites"
          description={
            (aRattacher ?? 0) > 0
              ? `${aRattacher} visite${(aRattacher ?? 0) > 1 ? "s" : ""} à rattacher à une fiche client ou prospect.`
              : "Le journal des visites, toutes sources confondues."
          }
        />
        <CardBody className="p-0">
          {visites.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">
              {visitesRes.error ? `Impossible de charger le journal (${visitesRes.error.message}). Si la migration 0134 n'est pas appliquée, appliquez-la puis rechargez.` : "Aucune visite ne correspond."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visites.map((v) => (
                <li key={v.id} className="px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs text-foreground-muted">{dateCourte(v.jour)}</span>
                    <span className="font-medium text-foreground">{v.tiers}</span>
                    {v.aRattacher && <Badge tone="warning">À rattacher</Badge>}
                    <Badge tone="neutral">{NATURES_VISITE[v.nature]}</Badge>
                    <span className="ml-auto text-xs text-foreground-muted">
                      {v.auteur} · {SOURCES_VISITE[v.source]}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-foreground-muted">{v.compteRendu}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ListPagination
        basePath="/prospection"
        params={paramsVisites}
        page={filtres.page}
        taille={filtres.taille}
        total={visitesRes.count ?? 0}
        noun="visite"
      />

      <Card>
        <CardHeader
          title="Absences"
          description={
            direction
              ? `${aTraiter.length} demande${aTraiter.length > 1 ? "s" : ""} à traiter. Seule une absence validée dispense du rapport quotidien.`
              : "Déclarez vos permissions, arrêts maladie et congés : une fois validés par la direction, aucun rapport n'est attendu ces jours-là."
          }
          action={
            peutDeclarer ? (
              <BoutonAbsence
                aujourdhui={aujourdhui}
                commerciaux={direction ? commerciaux.filter((c) => c.actif).map((c) => ({ appUserId: c.appUserId, nom: c.nom })) : null}
              />
            ) : undefined
          }
        />
        <CardBody className="p-0">
          {absences.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucune absence depuis le début du mois.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border text-left text-xs text-foreground-muted">
                  <tr>
                    {direction && <th className="px-5 py-2 font-medium">Commercial</th>}
                    <th className="px-5 py-2 font-medium">Période</th>
                    <th className="px-3 py-2 font-medium">Motif</th>
                    <th className="px-3 py-2 font-medium">Statut</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {absences.map((a) => {
                    const sienne = a.appUserId === profile.id;
                    return (
                      <tr key={a.id}>
                        {direction && <td className="px-5 py-2.5 font-medium text-foreground">{a.nom}</td>}
                        <td className="px-5 py-2.5">
                          {a.debut === a.fin ? dateCourte(a.debut) : `${dateCourte(a.debut)} → ${dateCourte(a.fin)}`}
                        </td>
                        <td className="px-3 py-2.5">
                          {MOTIFS_ABSENCE[a.motif]}
                          {a.commentaire && <p className="text-xs text-foreground-muted">{a.commentaire}</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={TON_ABSENCE[a.statut]}>{STATUTS_ABSENCE[a.statut]}</Badge>
                          {a.motifRefus && <p className="mt-1 text-xs text-foreground-muted">{a.motifRefus}</p>}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="flex items-center justify-end gap-1">
                            {direction && a.statut === "demandee" && !sienne && <TraiterAbsence absence={a} />}
                            {(direction || (sienne && a.statut === "demandee")) && <RetirerAbsence absence={a} />}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
