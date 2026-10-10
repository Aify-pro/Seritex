import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { chargerCanaux, chargerCommerciaux, chargerReglages } from "@/lib/prospection/serveur";
import { aujourdhuiAbidjan, dateCourte } from "@/lib/prospection/constantes";
import {
  AjoutJourFerie,
  BoutonCommercial,
  FormulaireCalendrier,
  LigneCanal,
  SupprimerCommercial,
  SupprimerJourFerie,
  type OptionCompte,
  type OptionSage,
} from "./formulaires";

/**
 * Paramètres > Prospection (migration 0122) : qui est commercial (et par
 * quel numéro WhatsApp il sera reconnu), quels jours un rapport est
 * attendu, les jours fériés, et ce que fait chaque canal.
 */
export default async function ParametresProspectionPage() {
  await requireModule("parametres_prospection");
  const [peutCreer, peutModifier, peutSupprimer] = await Promise.all([
    can("parametres_prospection", "create"),
    can("parametres_prospection", "modify"),
    can("parametres_prospection", "delete"),
  ]);
  const supabase = await createClient();
  const debutAnnee = `${aujourdhuiAbidjan().slice(0, 4)}-01-01`;
  const [commerciaux, reglages, canaux, { data: comptesBruts }, { data: repsBruts }, { data: feries }] = await Promise.all([
    chargerCommerciaux(),
    chargerReglages(),
    chargerCanaux(),
    supabase.from("app_users").select("id, full_name, email, role").eq("active", true).not("role", "in", "(client,livreur)").order("full_name"),
    supabase.from("sage_representants").select("co_no, name").order("name"),
    supabase.from("jours_feries").select("jour, libelle").gte("jour", debutAnnee).order("jour"),
  ]);

  const dejaCommerciaux = new Set(commerciaux.map((c) => c.appUserId));
  const comptes: OptionCompte[] = (comptesBruts ?? [])
    .filter((c) => !dejaCommerciaux.has(c.id as string))
    .map((c) => ({ id: c.id as string, nom: c.full_name as string, email: c.email as string }));
  const representants: OptionSage[] = (repsBruts ?? []).map((r) => ({ coNo: r.co_no as number, nom: r.name as string }));
  const nomSage = new Map(representants.map((r) => [r.coNo, r.nom]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospection"
        description="Les commerciaux suivis, les jours où un rapport est attendu, les jours fériés et les canaux de réception et d'envoi."
      />

      <Card>
        <CardHeader
          title="Commerciaux"
          description="Le numéro WhatsApp identifie l'auteur d'un rapport vocal ; le collaborateur Sage rattache ses clients."
          action={peutCreer ? <BoutonCommercial comptes={comptes} representants={representants} /> : undefined}
        />
        <CardBody className="p-0">
          {commerciaux.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucun commercial enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border text-left text-xs text-foreground-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Commercial</th>
                    <th className="px-3 py-2 font-medium">Sage</th>
                    <th className="px-3 py-2 font-medium">WhatsApp</th>
                    <th className="px-3 py-2 font-medium">E-mail pro</th>
                    <th className="px-3 py-2 font-medium">Zone</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {commerciaux.map((c) => (
                    <tr key={c.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-foreground">{c.nom}</p>
                        <p className="text-xs text-foreground-muted">{c.email}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {c.sageRepresentantNo != null ? (nomSage.get(c.sageRepresentantNo) ?? `n° ${c.sageRepresentantNo}`) : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">{c.whatsapp ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs">{c.emailPro ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs">{c.zone ?? "—"}</td>
                      <td className="px-5 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          {!c.actif && <Badge tone="neutral">Inactif</Badge>}
                          {c.actif && !c.soumisObligation && <Badge tone="info">Sans obligation</Badge>}
                          {peutModifier && <BoutonCommercial commercial={c} comptes={comptes} representants={representants} />}
                          {peutSupprimer && <SupprimerCommercial commercial={c} />}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Calendrier"
          description="Un rapport par jour est attendu les jours de visites. La direction, les jours fériés et les absences validées en sont dispensés."
        />
        <CardBody>
          <FormulaireCalendrier reglages={reglages} editable={peutModifier} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Jours fériés" description="À saisir chaque année, fêtes à date mobile comprises (Tabaski, fin du Ramadan, Maouloud…)." />
        <CardBody className="space-y-4">
          {(feries ?? []).length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucun jour férié saisi pour cette année.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {(feries ?? []).map((f) => (
                <li key={f.jour as string} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    <span className="inline-block w-36 text-foreground-muted">{dateCourte(f.jour as string)}</span>
                    {f.libelle as string}
                  </span>
                  {peutSupprimer && <SupprimerJourFerie jour={f.jour as string} libelle={f.libelle as string} />}
                </li>
              ))}
            </ul>
          )}
          {peutCreer && <AjoutJourFerie />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Canaux"
          description="Réception des rapports, et envoi des rappels (le soir) et des alertes (le lendemain matin), canal par canal. Les envois partiront avec le lot des alertes."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Canal</th>
                  <th className="px-3 py-2 text-center font-medium">Réception</th>
                  <th className="px-3 py-2 text-center font-medium">Rappels</th>
                  <th className="px-3 py-2 text-center font-medium">Alertes</th>
                  <th className="px-3 py-2 font-medium">Repère</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {canaux.map((c) => (
                  <LigneCanal key={c.canal} canal={c} editable={peutModifier} />
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
