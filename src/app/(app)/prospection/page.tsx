import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { chargerAbsences, chargerCommerciaux, type Commercial } from "@/lib/prospection/serveur";
import {
  MOTIFS_ABSENCE,
  STATUTS_ABSENCE,
  STATUTS_JOURNEE,
  aujourdhuiAbidjan,
  dateCourte,
  type StatutAbsence,
  type StatutJournee,
} from "@/lib/prospection/constantes";
import { BoutonAbsence, RetirerAbsence, TraiterAbsence } from "./absences";

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
export default async function ProspectionPage() {
  const { profile } = await requireModule("prospection");
  const [direction, peutDeclarer] = await Promise.all([can("prospection", "validate"), can("prospection", "create")]);
  const aujourdhui = aujourdhuiAbidjan();
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
