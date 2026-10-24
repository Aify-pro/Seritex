import Link from "next/link";
import { FileDown } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/utils";
import { getSizes } from "@/lib/sizes";
import { getProductionReports } from "@/lib/production-report-data";
import { buildReportValeur, buildReportView, DECISION_LABELS, formatDuree, type ReportDecision } from "@/lib/production-report";

const th = "px-2 py-1.5 text-right";
const td = "px-2 py-1.5 text-right";
const kg = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(Math.round(v)));
const signe = (v: number) => (v > 0 ? `+${v}` : String(v));
const DECISION_TONE: Record<ReportDecision, "success" | "warning" | "danger"> = { validee: "success", renvoyee: "warning", cloture_forcee: "danger" };

/**
 * Onglet Rapport de l'ODF (migration 0145) : le rapport de production figé à
 * la demande de clôture — quantités par taille (manquants, en plus), travaux
 * par section, tissu et déchets, consommables — et, pour qui voit les coûts,
 * les valeurs. Les rapports précédents (ODF renvoyé en production) restent
 * consultables.
 */
export async function ProductionReportTab({
  productionOrderId,
  numero,
  canSeeCosts,
}: {
  productionOrderId: string;
  numero?: number;
  canSeeCosts: boolean;
}) {
  const [{ list, report }, sizes] = await Promise.all([getProductionReports(productionOrderId, { numero, withCosts: canSeeCosts }), getSizes()]);
  if (!report) {
    return (
      <Card>
        <CardBody className="text-sm text-foreground-muted">
          Aucun rapport de production : il est généré automatiquement quand le chef de production demande la clôture.
        </CardBody>
      </Card>
    );
  }
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;
  const v = buildReportView(report.contenu);
  const valeur = canSeeCosts && report.couts ? buildReportValeur(v, report.couts) : null;
  const pdfHref = `/api/production/${productionOrderId}/rapport/pdf?numero=${report.numero}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Rapport de production n°${report.numero}`}
          description={`Généré le ${formatDateTime(report.genereLe)}${report.demandePar ? ` à la demande de clôture de ${report.demandePar}` : ""}. Figé : il ne change plus.`}
          action={
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted"
            >
              <FileDown className="h-3.5 w-3.5" /> PDF
            </a>
          }
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {report.decision ? (
              <Badge tone={DECISION_TONE[report.decision]}>{DECISION_LABELS[report.decision]}</Badge>
            ) : (
              <Badge tone="warning">En attente de la décision de la direction</Badge>
            )}
            {report.decisionLe && (
              <span className="text-xs text-foreground-muted">
                le {formatDateTime(report.decisionLe)}
                {report.decisionPar ? ` par ${report.decisionPar}` : ""}
              </span>
            )}
          </div>
          {report.decisionNote && <p className="rounded-md bg-surface-muted px-2.5 py-2 text-xs">Note : {report.decisionNote}</p>}
          {report.contenu.bilan.indisponible && (
            <p className="rounded-md bg-warning-soft px-2.5 py-2 text-xs text-warning">Le bilan par taille n&apos;a pas pu être calculé à la génération de ce rapport.</p>
          )}
          {report.motifDemande && <p className="rounded-md bg-warning-soft px-2.5 py-2 text-xs text-warning">Motif de la demande : {report.motifDemande}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Demandé" value={v.totaux.demande} />
            <Stat label="Sorti (1er + 2e choix)" value={v.totaux.sorties} />
            <Stat label="Manquants" value={v.totaux.manquants} tone={v.totaux.manquants > 0 ? "danger" : undefined} />
            <Stat label="En plus" value={v.totaux.en_plus} tone={v.totaux.en_plus > 0 ? "warning" : undefined} />
            <Stat label="2e choix" value={v.totaux.deuxieme_choix} />
            <Stat label="Déchets (pièces)" value={v.totaux.dechets} />
            <Stat label="Tissu consommé" value={kg(v.tissu.kgNet || null)} />
            <Stat label="Déchets de tissu" value={kg(v.tissu.kgDechets || null)} />
          </dl>
          {list.length > 1 && (
            <p className="text-xs text-foreground-muted">
              Rapports de cet ODF :{" "}
              {list.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && " · "}
                  {r.numero === report.numero ? (
                    <span className="font-medium text-foreground">n°{r.numero}</span>
                  ) : (
                    <Link href={`/atelier/production/${productionOrderId}?onglet=rapport&rapport=${r.numero}`} className="font-medium text-brand hover:underline">
                      n°{r.numero}
                    </Link>
                  )}
                  {r.decision ? ` (${DECISION_LABELS[r.decision].toLowerCase()})` : ""}
                </span>
              ))}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Quantités par article et par taille" description="Écart = 1er + 2e choix − demandé : négatif = manquant, positif = pièces en plus." />
        <CardBody className="space-y-4">
          {v.lignes.map((l, i) => (
            <div key={i} className="overflow-x-auto">
              <p className="mb-1 text-sm font-medium text-foreground">{l.description}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                    <th className="py-1.5 pr-3">Taille</th>
                    <th className={th}>Demandé</th>
                    <th className={th}>1er choix</th>
                    <th className={th}>2e choix</th>
                    <th className={th}>Écart</th>
                    <th className={th}>Surplus déclaré</th>
                    <th className={th}>Déchets</th>
                    <th className={th}>En cours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {l.tailles.map((t) => (
                    <tr key={t.taille}>
                      <td className="py-1.5 pr-3 font-medium">{libelle(t.taille)}</td>
                      <td className={td}>{t.demande}</td>
                      <td className={td}>{t.premier_choix}</td>
                      <td className={td}>{t.deuxieme_choix}</td>
                      <td className={`${td} font-semibold ${t.ecart < 0 ? "text-danger" : t.ecart > 0 ? "text-warning" : ""}`}>{t.ecart === 0 ? "0" : signe(t.ecart)}</td>
                      <td className={td}>{t.surplus ? `+${t.surplus}` : "—"}</td>
                      <td className={td}>{t.dechets}</td>
                      <td className={td}>{t.en_cours}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5 pr-3">Total</td>
                    <td className={td}>{l.totaux.demande}</td>
                    <td className={td}>{l.totaux.premier_choix}</td>
                    <td className={td}>{l.totaux.deuxieme_choix}</td>
                    <td className={td}>{l.totaux.ecart === 0 ? "0" : signe(l.totaux.ecart)}</td>
                    <td className={td}>{l.totaux.surplus ? `+${l.totaux.surplus}` : "—"}</td>
                    <td className={td}>{l.totaux.dechets}</td>
                    <td className={td}>{l.totaux.en_cours}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Travaux par section"
          description="Ce que chaque section a déclaré. Durée écoulée = de la première à la dernière déclaration de la section (pas des heures travaillées)."
        />
        <CardBody className="overflow-x-auto p-0">
          {v.sections.length === 0 ? (
            <p className="px-5 py-4 text-sm text-foreground-muted">Aucun ordre de travail.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-foreground-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Étape · section</th>
                  <th className={th}>Prévu</th>
                  <th className={th}>Fait</th>
                  <th className={th}>Bonnes</th>
                  <th className={th}>1er / 2e choix</th>
                  <th className={th}>Déchets</th>
                  <th className="px-2 py-1.5 text-left">Début → fin</th>
                  <th className={th}>Durée écoulée</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {v.sections.map((s) => (
                  <tr key={s.work_order_id}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium">
                        {s.etape ? `${s.etape} · ` : ""}
                        {s.section}
                      </span>
                      {s.ligne && <span className="block text-[11px] text-foreground-muted">{s.ligne}</span>}
                    </td>
                    <td className={td}>{s.prevu}</td>
                    <td className={td}>{s.fait}</td>
                    <td className={td}>{s.bonnes || "—"}</td>
                    <td className={td}>{s.premier_choix || s.deuxieme_choix ? `${s.premier_choix} / ${s.deuxieme_choix}` : "—"}</td>
                    <td className={td}>{s.dechets || "—"}</td>
                    <td className="px-2 py-1.5 text-[11px] text-foreground-muted">
                      {s.premiere_declaration ? `${formatDateTime(s.premiere_declaration)} → ${formatDateTime(s.derniere_declaration)}` : "aucune déclaration"}
                    </td>
                    <td className={td}>{formatDuree(s.duree_ecoulee_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tissu, déchets et consommables" description="Pesées de la coupe et sacs de déchets ; consommables calculés par la nomenclature et ajustés avant la clôture." />
        <CardBody className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Tissu reçu à la coupe" value={kg(v.tissu.kgReception)} />
            <Stat label="Retour au stock" value={kg(v.tissu.kgRetour)} />
            <Stat label="Tissu consommé (net)" value={kg(v.tissu.kgNet)} />
            <Stat label="Par pièce sortie" value={v.tissu.kgParPiece === null ? "—" : `${(v.tissu.kgParPiece * 1000).toFixed(0)} g`} />
            <Stat label="Déchets de tissu (sacs)" value={kg(v.tissu.kgDechets)} />
            <Stat label="Matelas clôturés" value={v.tissu.matelasClotures} />
          </dl>
          {v.consommables.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-1.5 pr-3">Consommable</th>
                  <th className={th}>Théorique</th>
                  <th className={th}>Réel</th>
                  <th className={th}>Écart</th>
                  <th className="px-2 py-1.5 text-left">Motif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {v.consommables.map((k) => (
                  <tr key={k.code}>
                    <td className="py-1.5 pr-3">
                      <span className="mr-1.5 font-mono text-[11px] text-foreground-muted">{k.code}</span>
                      {k.designation}
                    </td>
                    <td className={td}>
                      {k.theorique} {k.unite}
                    </td>
                    <td className={td}>{k.reel === null ? "—" : `${k.reel} ${k.unite}`}</td>
                    <td className={td}>{k.ecart === null || k.ecart === 0 ? "—" : signe(k.ecart)}</td>
                    <td className="px-2 py-1.5 text-foreground-muted">{k.motif ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {valeur && (
        <Card>
          <CardHeader
            title="Valeurs"
            description={`Réservé au droit Tarification. Prix du tissu figé à la demande de clôture${
              valeur.prixKgSource === "odf" ? " (saisi pour l'ODF)" : valeur.prixKgSource === "article" ? " (fiche article du tissu)" : ""
            }.`}
          />
          <CardBody className="space-y-3">
            {valeur.warnings.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md bg-warning-soft/60 py-2 pl-7 pr-3 text-xs text-foreground">
                {valeur.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Stat label="Prix du tissu au kg" value={money(valeur.prixKg)} />
              <Stat label="Tissu consommé" value={money(valeur.valeurTissu)} />
              <Stat label="Tissu par pièce sortie" value={money(valeur.tissuParPiece)} />
              <Stat label="Déchets de tissu" value={money(valeur.valeurDechets)} />
              {valeur.prixRevient?.reel && (
                <>
                  <Stat label="Prix de revient réel (total)" value={money(valeur.prixRevient.reel.prixRevient)} />
                  <Stat
                    label="Prix de revient réel par pièce"
                    value={money(valeur.prixRevient.quantite ? valeur.prixRevient.reel.prixRevient / valeur.prixRevient.quantite : null)}
                  />
                  <Stat label="Théorique (devis)" value={money(valeur.prixRevient.theorique.prixRevient)} />
                  <Stat
                    label="Écart réel − théorique"
                    value={valeur.prixRevient.ecart === null ? "—" : `${money(valeur.prixRevient.ecart)}${valeur.prixRevient.ecartPct !== null ? ` (${valeur.prixRevient.ecartPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)` : ""}`}
                    tone={valeur.prixRevient.ecart !== null && valeur.prixRevient.ecart > 0 ? "danger" : undefined}
                  />
                </>
              )}
            </dl>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "warning" }) {
  return (
    <div>
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}
