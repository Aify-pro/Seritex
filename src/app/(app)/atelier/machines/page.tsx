import { can, requireModule } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { chargerParc } from "@/lib/atelier/parc-serveur";
import { ETATS_ECRAN, SECHAGES, TYPES_MACHINE, type EtatEcran } from "@/lib/atelier/parc";
import { BoutonEcran, BoutonMachine, EtatEcranSelect, SupprimerEcran, SupprimerMachine } from "./parc-formulaires";

const cm = (v: number | null) => (v == null ? null : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));

/**
 * Parc de sérigraphie (migration 0119) : machines et écrans. L'outil
 * « Séparation des couleurs » s'en sert pour les têtes, le format, le
 * maillage et les écrans disponibles ; le prix de revient, pour la cadence
 * et le coût horaire des machines (Direction).
 */
export default async function MachinesEcransPage() {
  await requireModule("machines_ecrans");
  const [peutCreer, peutModifier, peutSupprimer, voitCouts] = await Promise.all([
    can("machines_ecrans", "create"),
    can("machines_ecrans", "modify"),
    can("machines_ecrans", "delete"),
    can("tarification", "view"),
  ]);
  const { machines, ecrans } = await chargerParc();

  const maillages = [...new Set(ecrans.map((e) => e.maillage))].sort((a, b) => a - b);
  const compte = (m: number, etat: EtatEcran) => ecrans.filter((e) => e.maillage === m && e.etat === etat).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Machines et écrans"
        description="Le parc de sérigraphie. La séparation des couleurs vérifie les têtes, le format et les écrans disponibles ; le prix de revient utilise la cadence et le coût horaire de la machine."
      />

      <Card>
        <CardHeader title="Machines" action={peutCreer ? <BoutonMachine voitCouts={voitCouts} /> : undefined} />
        <CardBody className="p-0">
          {machines.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucune machine enregistrée.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border text-left text-xs text-foreground-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Machine</th>
                    <th className="px-3 py-2 font-medium">Têtes / stations</th>
                    <th className="px-3 py-2 font-medium">Format max</th>
                    <th className="px-3 py-2 font-medium">Séchage</th>
                    <th className="px-3 py-2 font-medium">Cadence</th>
                    {voitCouts && <th className="px-3 py-2 font-medium">Coût horaire</th>}
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {machines.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-foreground">{m.nom}</p>
                        <p className="text-xs text-foreground-muted">
                          {TYPES_MACHINE[m.type]}
                          {m.notes ? ` · ${m.notes}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        {m.nbTetes} / {m.nbStations}
                      </td>
                      <td className="px-3 py-2.5">{m.formatMaxLCm && m.formatMaxHCm ? `${cm(m.formatMaxLCm)} × ${cm(m.formatMaxHCm)} cm` : "—"}</td>
                      <td className="px-3 py-2.5">{SECHAGES[m.sechage]}</td>
                      <td className="px-3 py-2.5">{m.cadencePiecesH ? `${m.cadencePiecesH} pièces/h` : "—"}</td>
                      {voitCouts && <td className="px-3 py-2.5">{m.coutHoraire != null ? `${Math.round(m.coutHoraire).toLocaleString("fr-FR")} F/h` : "—"}</td>}
                      <td className="px-5 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          {!m.active && <Badge tone="neutral">Hors service</Badge>}
                          {peutModifier && <BoutonMachine machine={m} voitCouts={voitCouts} />}
                          {peutSupprimer && <SupprimerMachine machine={m} />}
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
          title="Écrans"
          description="Format intérieur du cadre, maillage et état. Un écran insolé porte un travail ; « à récupérer » attend le dégravage."
          action={peutCreer ? <BoutonEcran /> : undefined}
        />
        <CardBody className="space-y-4 p-0">
          {maillages.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 pt-4">
              {maillages.map((m) => (
                <div key={m} className="rounded-md border border-border px-3 py-2 text-xs">
                  <p className="font-medium text-foreground">{m} fils/cm</p>
                  <p className="text-foreground-muted">
                    {compte(m, "disponible")} disponible{compte(m, "disponible") > 1 ? "s" : ""} · {compte(m, "insole")} insolé{compte(m, "insole") > 1 ? "s" : ""} ·{" "}
                    {compte(m, "a_recuperer")} à récupérer
                  </p>
                </div>
              ))}
            </div>
          )}
          {ecrans.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucun écran enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-y border-border text-left text-xs text-foreground-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Format intérieur</th>
                    <th className="px-3 py-2 font-medium">Maillage</th>
                    <th className="px-3 py-2 font-medium">État</th>
                    <th className="px-3 py-2 font-medium">Travail</th>
                    <th className="px-3 py-2 font-medium">Emplacement</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ecrans.map((e) => (
                    <tr key={e.id}>
                      <td className="px-5 py-2.5 font-mono">{e.code}</td>
                      <td className="px-3 py-2.5">
                        {cm(e.largeurCm)} × {cm(e.hauteurCm)} cm
                      </td>
                      <td className="px-3 py-2.5">
                        {e.maillage} fils/cm{e.couleurMaille === "jaune" ? " · jaune" : ""}
                      </td>
                      <td className="px-3 py-2.5">
                        <EtatEcranSelect ecran={e} editable={peutModifier} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-foreground-muted">{e.travail ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground-muted">{e.emplacement ?? "—"}</td>
                      <td className="px-5 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          {peutModifier && <BoutonEcran ecran={e} />}
                          {peutSupprimer && <SupprimerEcran ecran={e} />}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-5 pb-4 text-xs text-foreground-muted">États : {Object.values(ETATS_ECRAN).join(", ")}.</p>
        </CardBody>
      </Card>
    </div>
  );
}
