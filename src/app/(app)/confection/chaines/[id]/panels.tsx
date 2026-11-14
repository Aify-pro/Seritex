"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Travail } from "@/lib/confection/data";
import {
  affecterEmploye,
  attribuerTravail,
  changerPrioriteTravail,
  changerStatutTravail,
  corrigerSortie,
  fermerArret,
  ouvrirArret,
  regulariserSortie,
  retirerTravail,
  saisirEffectif,
  terminerAffectation,
} from "../../actions";

export type CandidatRow = { id: string; odf: string; article: string; prevu: number; fait: number };
export type EmployeRow = { id: string; matricule: string; nom: string; prenom: string | null; section_id: string | null };
export type AffectationRow = { id: string; employe_id: string; poste_id: string | null; fonction: string; debut: string; fin: string | null; nom: string };
export type PosteOption = { id: string; numero: number; libelle: string | null };
export type ArretRow = { id: string; debut: string; fin: string | null; cause: string; commentaire: string | null };
type SortieRow = { id: string; taille: string; tailleLibelle: string; type: "bonne" | "reprise" | "rebut"; quantite: number; heure: string; aRegulariser: string | null; correction: boolean };

const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

export const CAUSES_ARRET: Record<string, string> = {
  coupure_courant: "Coupure de courant",
  attente_ravitaillement: "Attente de ravitaillement",
  panne: "Panne",
  changement_modele: "Changement de modèle",
  autre: "Autre",
};
const FONCTIONS: Record<string, string> = { couture: "Couture", chef_chaine: "Chef de chaîne", agent: "Agent de chaîne", commun: "Poste commun", autre: "Autre" };
const STATUTS: Record<Travail["statut"], { label: string; tone: "info" | "success" | "neutral" }> = {
  a_faire: { label: "À faire", tone: "info" },
  en_cours: { label: "En cours", tone: "success" },
  termine: { label: "Terminé", tone: "neutral" },
};

/** Lance une action serveur, affiche le refus ou rafraîchit la page. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, ok = "Enregistré", apres?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok);
        apres?.();
        router.refresh();
      }
    });
  return { pending, run };
}

export function TravauxPanel({
  chaineId,
  travaux,
  candidats,
  peutCreer,
  peutModifier,
}: {
  chaineId: string;
  travaux: Travail[];
  candidats: CandidatRow[];
  peutCreer: boolean;
  peutModifier: boolean;
}) {
  const { pending, run } = useAction();
  const [wo, setWo] = useState("");
  const [priorite, setPriorite] = useState("0");
  const [consigne, setConsigne] = useState("");
  const [voirTermines, setVoirTermines] = useState(false);
  const visibles = travaux.filter((t) => voirTermines || t.statut !== "termine");
  const nbTermines = travaux.filter((t) => t.statut === "termine").length;

  return (
    <div className="divide-y divide-border">
      {visibles.length === 0 && <p className="px-5 py-6 text-sm text-foreground-muted">Aucun travail attribué à cette chaîne.</p>}
      {visibles.map((t) => {
        const reste = Math.max(t.demande - t.sorti, 0);
        const pct = t.demande > 0 ? Math.min(100, Math.round((t.sorti / t.demande) * 100)) : 0;
        return (
          <div key={t.id} className="space-y-2 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t.odf} · {t.article}
                </p>
                <p className="text-xs text-foreground-muted">{t.tailles.map((x) => `${x.libelle} : ${x.quantite}`).join(" · ")}</p>
                {t.consigne && <p className="mt-1 text-xs text-warning">Consigne : {t.consigne}</p>}
              </div>
              <div className="flex items-center gap-2">
                {t.priorite > 0 && <Badge tone="danger">Priorité {t.priorite}</Badge>}
                <Badge tone={STATUTS[t.statut].tone}>{STATUTS[t.statut].label}</Badge>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted">
              <span>
                Demandé {t.demande} · ravitaillé {t.ravitaille} · sorti <strong className="text-foreground">{t.sorti}</strong>
                {t.rebut > 0 && ` · rebut ${t.rebut}`} · reste {reste}
              </span>
              {peutModifier && (
                <span className="flex gap-1.5">
                  {t.statut !== "termine" && (
                    <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => changerStatutTravail(t.id, chaineId, "termine"), "Travail terminé")}>
                      Terminer
                    </Button>
                  )}
                  {t.statut === "termine" && (
                    <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => changerStatutTravail(t.id, chaineId, "en_cours"), "Travail rouvert")}>
                      Rouvrir
                    </Button>
                  )}
                  {t.statut === "a_faire" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending}
                        onClick={() => run(() => changerPrioriteTravail(t.id, chaineId, t.priorite + 1, t.consigne ?? ""), "Priorité augmentée")}
                      >
                        Passer devant
                      </Button>
                      <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => retirerTravail(t.id, chaineId), "Travail retiré")}>
                        Retirer
                      </Button>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {nbTermines > 0 && (
        <button type="button" onClick={() => setVoirTermines((v) => !v)} className="w-full px-5 py-2 text-left text-xs font-medium text-brand hover:underline">
          {voirTermines ? "Masquer" : "Voir"} les {nbTermines} travaux terminés
        </button>
      )}
      {peutCreer && (
        <div className="flex flex-wrap items-end gap-3 bg-surface-muted/40 px-5 py-3">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Attribuer un travail (ODF en production dans la section)</span>
            <select value={wo} onChange={(e) => setWo(e.target.value)} className={`${input} w-full`}>
              <option value="">Choisir un article d&apos;ODF…</option>
              {candidats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.odf} · {c.article} — {c.fait}/{c.prevu}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Priorité</span>
            <select value={priorite} onChange={(e) => setPriorite(e.target.value)} className={input}>
              <option value="0">Normale</option>
              <option value="1">Urgente</option>
              <option value="2">Très urgente</option>
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Consigne pour l&apos;agent (facultatif)</span>
            <input value={consigne} onChange={(e) => setConsigne(e.target.value)} maxLength={300} className={`${input} w-full`} />
          </label>
          <Button
            loading={pending}
            disabled={!wo}
            onClick={() =>
              run(() => attribuerTravail(chaineId, wo, Number(priorite), consigne), "Travail attribué", () => {
                setWo("");
                setConsigne("");
                setPriorite("0");
              })
            }
          >
            Attribuer
          </Button>
        </div>
      )}
    </div>
  );
}

export function SortiesPanel({ chaineId, sorties, peutRegulariser, peutCorriger }: { chaineId: string; sorties: SortieRow[]; peutRegulariser: boolean; peutCorriger: boolean }) {
  const { pending, run } = useAction();
  const LIBELLE = { bonne: "bonnes", reprise: "reprises", rebut: "rebuts" } as const;
  // Une seule ligne ouverte à la fois : régularisation (motif) ou correction (pièces en trop + motif).
  const [ouverte, setOuverte] = useState<{ id: string; mode: "regulariser" | "corriger" } | null>(null);
  const [motif, setMotif] = useState("");
  const [enTrop, setEnTrop] = useState("");
  const ouvrir = (id: string, mode: "regulariser" | "corriger") => {
    setOuverte({ id, mode });
    setMotif("");
    setEnTrop("");
  };
  const fermer = () => setOuverte(null);

  if (sorties.length === 0) return <p className="px-5 py-6 text-sm text-foreground-muted">Aucune sortie enregistrée.</p>;
  return (
    <div className="divide-y divide-border">
      {sorties.map((s) => (
        <div key={s.id} className="space-y-2 px-5 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{s.quantite > 0 ? s.quantite : `− ${-s.quantite}`}</strong> {LIBELLE[s.type]} · {s.tailleLibelle}
              {s.correction && <Badge className="ml-2">Correction</Badge>}
            </span>
            <span className="flex items-center gap-2 text-xs text-foreground-muted">
              {s.heure}
              {s.aRegulariser && <Badge tone="danger">À régulariser</Badge>}
              {s.aRegulariser && peutRegulariser && (
                <Button size="sm" variant="secondary" onClick={() => ouvrir(s.id, "regulariser")}>
                  Déclarer
                </Button>
              )}
              {peutCorriger && !s.correction && s.quantite > 0 && (
                <Button size="sm" variant="ghost" onClick={() => ouvrir(s.id, "corriger")}>
                  Corriger
                </Button>
              )}
            </span>
          </div>
          {ouverte?.id === s.id && (
            <div className="space-y-2 rounded-md bg-surface-muted/60 p-3">
              {ouverte.mode === "regulariser" && <p className="text-xs text-danger">Déclaration refusée : {s.aRegulariser}</p>}
              <div className="flex flex-wrap items-end gap-3">
                {ouverte.mode === "corriger" && (
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Pièces comptées en trop</span>
                    <input type="number" min={1} max={s.quantite} inputMode="numeric" value={enTrop} onChange={(e) => setEnTrop(e.target.value)} className={`${input} w-24`} />
                  </label>
                )}
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] font-medium text-foreground-muted">
                    {ouverte.mode === "regulariser" ? "Motif (pièces en plus de ce que la section a reçu)" : "Motif de la correction"}
                  </span>
                  <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={200} className={`${input} w-full`} />
                </label>
                <Button
                  size="sm"
                  loading={pending}
                  disabled={!motif.trim() || (ouverte.mode === "corriger" && !(Number(enTrop) > 0))}
                  onClick={() =>
                    ouverte.mode === "regulariser"
                      ? run(() => regulariserSortie(s.id, chaineId, motif), "Sortie déclarée", fermer)
                      : run(() => corrigerSortie(s.id, chaineId, -Math.trunc(Number(enTrop)), motif), "Comptage corrigé", fermer)
                  }
                >
                  Valider
                </Button>
                <Button size="sm" variant="ghost" onClick={fermer}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function EquipePanel({
  chaineId,
  affectations,
  employes,
  postes,
  peutModifier,
}: {
  chaineId: string;
  affectations: AffectationRow[];
  employes: EmployeRow[];
  postes: PosteOption[];
  peutModifier: boolean;
}) {
  const { pending, run } = useAction();
  const [employe, setEmploye] = useState("");
  const [recherche, setRecherche] = useState("");
  const [fonction, setFonction] = useState("couture");
  const [poste, setPoste] = useState("");
  const [historique, setHistorique] = useState(false);
  const enCours = affectations.filter((a) => !a.fin);
  const passees = affectations.filter((a) => a.fin);
  const dejaLa = new Set(enCours.map((a) => a.employe_id));
  const q = recherche.trim().toLowerCase();
  const proposes = employes.filter((e) => !dejaLa.has(e.id) && (!q || `${e.nom} ${e.prenom ?? ""} ${e.matricule}`.toLowerCase().includes(q))).slice(0, 60);
  const posteLabel = (id: string | null) => {
    const p = postes.find((x) => x.id === id);
    return p ? `Poste ${p.numero}${p.libelle ? ` · ${p.libelle}` : ""}` : null;
  };

  return (
    <div className="divide-y divide-border">
      {enCours.length === 0 && <p className="px-5 py-6 text-sm text-foreground-muted">Personne n&apos;est encore rattaché à cette chaîne.</p>}
      {enCours.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
          <span>
            <span className="font-medium">{a.nom}</span>
            <span className="ml-2 text-xs text-foreground-muted">
              {FONCTIONS[a.fonction] ?? a.fonction}
              {posteLabel(a.poste_id) && ` · ${posteLabel(a.poste_id)}`} · depuis le {formatDate(a.debut)}
            </span>
          </span>
          {peutModifier && (
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => terminerAffectation(a.id, chaineId), "Retiré de la chaîne")}>
              Retirer
            </Button>
          )}
        </div>
      ))}
      {peutModifier && (
        <div className="flex flex-wrap items-end gap-3 bg-surface-muted/40 px-5 py-3">
          <label>
            <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Chercher (nom ou matricule)</span>
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} className={`${input} w-40`} />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Personne</span>
            <select value={employe} onChange={(e) => setEmploye(e.target.value)} className={`${input} w-full`}>
              <option value="">Choisir…</option>
              {proposes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom} {e.prenom ?? ""} ({e.matricule})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Fonction</span>
            <select value={fonction} onChange={(e) => setFonction(e.target.value)} className={input}>
              {Object.entries(FONCTIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {postes.length > 0 && (
            <label>
              <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Poste (facultatif)</span>
              <select value={poste} onChange={(e) => setPoste(e.target.value)} className={input}>
                <option value="">—</option>
                {postes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.numero}
                    {p.libelle ? ` · ${p.libelle}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            loading={pending}
            disabled={!employe}
            onClick={() =>
              run(() => affecterEmploye(chaineId, employe, fonction, poste || null), "Ajouté à la chaîne", () => {
                setEmploye("");
                setRecherche("");
              })
            }
          >
            Ajouter
          </Button>
        </div>
      )}
      {employes.length === 0 && peutModifier && (
        <p className="px-5 py-3 text-xs text-foreground-muted">La liste du personnel est vide ou n&apos;est pas accessible : elle vient de Paramètres &gt; Personnel.</p>
      )}
      {passees.length > 0 && (
        <div className="px-5 py-2">
          <button type="button" onClick={() => setHistorique((v) => !v)} className="text-xs font-medium text-brand hover:underline">
            {historique ? "Masquer" : "Voir"} l&apos;historique ({passees.length})
          </button>
          {historique &&
            passees.map((a) => (
              <p key={a.id} className="mt-1 text-xs text-foreground-muted">
                {a.nom} · {FONCTIONS[a.fonction] ?? a.fonction} · du {formatDate(a.debut)} au {formatDate(a.fin)}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

export function EffectifForm({ chaineId, jour, presents, pointage }: { chaineId: string; jour: string; presents: number | null; pointage: number | null }) {
  const { pending, run } = useAction();
  const [n, setN] = useState(presents === null ? "" : String(presents));
  return (
    <div className="space-y-2">
      {pointage !== null && <p className="text-sm text-foreground">Pointage du jour : {pointage} présent(s). C&apos;est ce chiffre qui est retenu.</p>}
      <div className="flex items-end gap-3">
        <label>
          <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Personnes présentes sur la chaîne</span>
          <input type="number" min={0} max={500} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} className={`${input} w-28`} />
        </label>
        <Button variant="secondary" loading={pending} disabled={n === ""} onClick={() => run(() => saisirEffectif(chaineId, jour, Number(n)), "Effectif enregistré")}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

export function ArretsPanel({ chaineId, arrets }: { chaineId: string; arrets: ArretRow[] }) {
  const { pending, run } = useAction();
  const [cause, setCause] = useState("coupure_courant");
  const [commentaire, setCommentaire] = useState("");
  const ouvert = arrets.find((a) => !a.fin);
  return (
    <div className="divide-y divide-border">
      <div className="flex flex-wrap items-end gap-3 px-5 py-3">
        {ouvert ? (
          <>
            <p className="flex-1 text-sm">
              <Badge tone="danger" dot>
                Arrêt en cours
              </Badge>{" "}
              {CAUSES_ARRET[ouvert.cause] ?? ouvert.cause} depuis {ouvert.debut}
            </p>
            <Button variant="success" loading={pending} onClick={() => run(() => fermerArret(ouvert.id, chaineId), "Reprise enregistrée")}>
              La chaîne repart
            </Button>
          </>
        ) : (
          <>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Cause</span>
              <select value={cause} onChange={(e) => setCause(e.target.value)} className={input}>
                {Object.entries(CAUSES_ARRET).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Précision (facultatif)</span>
              <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={300} className={`${input} w-full`} />
            </label>
            <Button variant="danger" loading={pending} onClick={() => run(() => ouvrirArret(chaineId, cause, commentaire), "Arrêt enregistré", () => setCommentaire(""))}>
              Déclarer un arrêt
            </Button>
          </>
        )}
      </div>
      {arrets
        .filter((a) => a.fin)
        .slice(0, 8)
        .map((a) => (
          <p key={a.id} className="px-5 py-2 text-xs text-foreground-muted">
            {CAUSES_ARRET[a.cause] ?? a.cause} · {a.debut} → {a.fin}
            {a.commentaire && ` · ${a.commentaire}`}
          </p>
        ))}
    </div>
  );
}
