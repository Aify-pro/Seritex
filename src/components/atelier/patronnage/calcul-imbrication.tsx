"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, Cpu, Eye, Play, Square, CheckCircle2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  annulerCalculTrace,
  apercuCalcul,
  calculsDuTrace,
  contexteCalculTrace,
  lancerCalculsTrace,
  utiliserCalculPourTrace,
  type ApercuCalcul,
  type CalculTraceResume,
  type ContexteCalculTrace,
} from "@/app/(app)/atelier/patronnage/imbrication-actions";

/**
 * Calcul automatique du tracé par Seritex (imbrication), dans la fenêtre du
 * tracé. FACULTATIF : le dépôt d'un fichier Modaris reste juste au-dessus.
 * On lance un calcul (ou plusieurs, un par laize, pour comparer), on regarde
 * l'aperçu, et on choisit — ou non — d'en faire le fichier du tracé.
 */

const champ = "h-9 rounded-md border border-border bg-surface px-2 text-base sm:text-sm";
const nf = (v: number, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });

const STATUTS: Record<CalculTraceResume["statut"], { libelle: string; tone: "neutral" | "info" | "success" | "danger" | "warning" }> = {
  en_attente: { libelle: "En attente", tone: "neutral" },
  en_cours: { libelle: "En cours", tone: "info" },
  termine: { libelle: "Terminé", tone: "success" },
  echec: { libelle: "Échec", tone: "danger" },
  annule: { libelle: "Annulé", tone: "warning" },
};

const DUREES: { cle: keyof ContexteCalculTrace["prereglages"]; libelle: string }[] = [
  { cle: "rapide", libelle: "Rapide (30 s)" },
  { cle: "normal", libelle: "Normal (2 min)" },
  { cle: "approfondi", libelle: "Approfondi (10 min)" },
];

const ORIGINES: Record<string, string> = {
  rouleaux_choisis: "rouleaux choisis",
  stock: "en stock",
  trace: "saisie sur le tracé",
  fiche: "saisie sur la fiche",
};

export function CalculImbrication({
  traceId,
  ficheId,
  canModify,
  onChanged,
}: {
  traceId: string;
  ficheId: string;
  canModify: boolean;
  onChanged: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [contexte, setContexte] = useState<ContexteCalculTrace | null>(null);
  const [calculs, setCalculs] = useState<CalculTraceResume[]>([]);
  const [laizes, setLaizes] = useState<number[]>([]);
  const [laizeLibre, setLaizeLibre] = useState("");
  const [marge, setMarge] = useState("0");
  const [espacement, setEspacement] = useState("0");
  const [duree, setDuree] = useState<keyof ContexteCalculTrace["prereglages"]>("normal");
  const [apercu, setApercu] = useState<ApercuCalcul | null>(null);
  const [pending, startTransition] = useTransition();

  const rafraichir = useCallback(async () => {
    const res = await calculsDuTrace(traceId);
    if (!("error" in res)) setCalculs(res);
  }, [traceId]);

  useEffect(() => {
    if (!ouvert) return;
    let actif = true;
    contexteCalculTrace(traceId).then((res) => {
      if (!actif) return;
      if ("error" in res) {
        toast.error("Calcul automatique indisponible", { description: res.error });
        return;
      }
      setContexte(res);
      // Pré-sélection : la laize des rouleaux choisis, sinon la première proposée.
      const choisies = res.laizes.filter((l) => l.origine === "rouleaux_choisis").map((l) => l.laizeCm);
      setLaizes(choisies.length ? choisies.slice(0, 4) : res.laizes.slice(0, 1).map((l) => l.laizeCm));
    });
    calculsDuTrace(traceId).then((res) => {
      if (actif && !("error" in res)) setCalculs(res);
    });
    return () => {
      actif = false;
    };
  }, [ouvert, traceId]);

  // Suivi des calculs en cours : relecture toutes les 5 s.
  const enCours = calculs.some((c) => c.statut === "en_attente" || c.statut === "en_cours");
  useEffect(() => {
    if (!ouvert || !enCours) return;
    const t = setInterval(() => void rafraichir(), 5000);
    return () => clearInterval(t);
  }, [ouvert, enCours, rafraichir]);

  // Comparaison : dans le dernier groupe lancé, le moins de tissu par couche.
  const dernierGroupe = calculs[0]?.groupe ?? null;
  const meilleurId = useMemo(() => {
    const termines = calculs.filter((c) => c.groupe === dernierGroupe && c.statut === "termine" && c.surfaceCoucheM2 !== null);
    if (termines.length < 2) return null;
    return termines.reduce((a, b) => (b.surfaceCoucheM2! < a.surfaceCoucheM2! ? b : a)).id;
  }, [calculs, dernierGroupe]);

  if (!ouvert) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-surface-muted p-3">
        <p className="text-sm text-foreground-muted">Ou faire calculer le tracé par Seritex (facultatif).</p>
        <Button size="sm" variant="secondary" type="button" onClick={() => setOuvert(true)}>
          <Cpu className="h-3.5 w-3.5" /> Calcul automatique
        </Button>
      </div>
    );
  }

  const peutLancer = !!contexte && !contexte.blocage && contexte.modifiable && canModify && laizes.length > 0;

  function basculerLaize(l: number) {
    setLaizes((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : prev.length >= 4 ? prev : [...prev, l]));
  }

  function ajouterLaizeLibre() {
    const l = Number(laizeLibre.replace(",", "."));
    if (!Number.isFinite(l) || l <= 0 || l > 1000) {
      toast.error("Laize invalide", { description: "Indiquez une laize en centimètres, par exemple 167." });
      return;
    }
    const arrondie = Math.round(l * 10) / 10;
    setContexte((c) => (c && !c.laizes.some((x) => x.laizeCm === arrondie) ? { ...c, laizes: [...c.laizes, { laizeCm: arrondie, origine: "trace", nbRouleaux: 0, poidsKg: 0 }] } : c));
    setLaizes((prev) => (prev.includes(arrondie) || prev.length >= 4 ? prev : [...prev, arrondie]));
    setLaizeLibre("");
  }

  function lancer() {
    if (!contexte) return;
    startTransition(async () => {
      const res = await lancerCalculsTrace(traceId, ficheId, {
        laizesCm: laizes,
        margeLisiereMm: Number(marge.replace(",", ".")) || 0,
        espacementMm: Number(espacement.replace(",", ".")) || 0,
        tempsS: contexte.prereglages[duree],
      });
      if ("error" in res) toast.error("Calcul non lancé", { description: res.error });
      else {
        toast.success(res.ids.length > 1 ? `${res.ids.length} calculs lancés (un par laize)` : "Calcul lancé");
        setApercu(null);
        await rafraichir();
      }
    });
  }

  function voir(id: string) {
    if (apercu?.id === id) {
      setApercu(null);
      return;
    }
    startTransition(async () => {
      const res = await apercuCalcul(id);
      if ("error" in res) toast.error("Aperçu indisponible", { description: res.error });
      else setApercu(res);
    });
  }

  function annuler(id: string) {
    startTransition(async () => {
      const res = await annulerCalculTrace(id);
      if (res.error) toast.error("Annulation impossible", { description: res.error });
      await rafraichir();
    });
  }

  function utiliser(c: CalculTraceResume) {
    if (!confirm(`Utiliser ce tracé (laize ${nf(c.laizeCm)} cm, ${nf(c.longueurCm ?? 0)} cm) comme fichier du tracé ? Le fichier actuel sera remplacé.`)) return;
    startTransition(async () => {
      const res = await utiliserCalculPourTrace(c.id, traceId, ficheId);
      if ("error" in res) toast.error("Tracé non utilisé", { description: res.error });
      else {
        toast.success("Tracé Seritex enregistré comme fichier du tracé", {
          description: res.reconnaissanceComplete ? "Toutes les pièces sont reconnues." : "Attention : des pièces ne sont pas reconnues, voir le détail.",
        });
        const ctx = await contexteCalculTrace(traceId);
        if (!("error" in ctx)) setContexte(ctx);
        onChanged();
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Cpu className="h-4 w-4 text-brand" /> Calcul automatique du tracé
        </p>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOuvert(false)}>
          Fermer
        </Button>
      </div>

      {!contexte ? (
        <p className="text-xs text-foreground-muted">Chargement…</p>
      ) : (
        <>
          {contexte.pieces.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="text-foreground-muted">Pièces par couche :</span>
              {contexte.pieces.map((p) => (
                <span key={`${p.semiFiniId}|${p.taille}`} className="rounded bg-surface px-1.5 py-0.5 text-foreground">
                  {p.semiFiniNom} · {p.taille.split("/").pop()} ×{p.quantite}
                </span>
              ))}
            </div>
          )}

          {contexte.blocage ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">{contexte.blocage}</p>
          ) : (
            contexte.modifiable &&
            canModify && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground-muted">
                    Laize(s) à calculer — cochez-en plusieurs pour comparer (4 au plus)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {contexte.laizes.map((l) => (
                      <label
                        key={l.laizeCm}
                        className={cn(
                          "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                          laizes.includes(l.laizeCm) ? "border-brand bg-brand/5 text-foreground" : "border-border bg-surface text-foreground-muted"
                        )}
                      >
                        <input type="checkbox" checked={laizes.includes(l.laizeCm)} onChange={() => basculerLaize(l.laizeCm)} />
                        <span className="font-medium text-foreground">{nf(l.laizeCm)} cm</span>
                        <span>
                          {l.nbRouleaux > 0 ? `${l.nbRouleaux} rouleau(x), ${nf(l.poidsKg, 0)} kg, ` : ""}
                          {ORIGINES[l.origine]}
                        </span>
                      </label>
                    ))}
                    <span className="flex items-center gap-1">
                      <input
                        value={laizeLibre}
                        onChange={(e) => setLaizeLibre(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            ajouterLaizeLibre();
                          }
                        }}
                        placeholder="Autre laize (cm)"
                        inputMode="decimal"
                        className={cn(champ, "w-32")}
                      />
                      <Button size="sm" variant="ghost" type="button" onClick={ajouterLaizeLibre}>
                        Ajouter
                      </Button>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-xs text-foreground-muted">
                    <span className="block">Lisière à retirer de chaque bord (mm)</span>
                    <input value={marge} onChange={(e) => setMarge(e.target.value)} inputMode="decimal" className={cn(champ, "w-28")} />
                  </label>
                  <label className="space-y-1 text-xs text-foreground-muted">
                    <span className="block">Espace entre pièces (mm)</span>
                    <input value={espacement} onChange={(e) => setEspacement(e.target.value)} inputMode="decimal" className={cn(champ, "w-28")} />
                  </label>
                  <label className="space-y-1 text-xs text-foreground-muted">
                    <span className="block">Durée du calcul</span>
                    <select value={duree} onChange={(e) => setDuree(e.target.value as typeof duree)} className={champ}>
                      {DUREES.map((d) => (
                        <option key={d.cle} value={d.cle}>
                          {d.libelle}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button size="sm" type="button" onClick={lancer} loading={pending} disabled={!peutLancer}>
                    <Play className="h-3.5 w-3.5" /> {laizes.length > 1 ? `Comparer ${laizes.length} laizes` : "Lancer le calcul"}
                  </Button>
                </div>
                <p className="text-xs text-foreground-muted">
                  Pièces posées dans le sens du fil (droit ou tourné de 180°). Le calcul tourne en arrière-plan : vous pouvez fermer cette fenêtre.
                </p>
              </div>
            )
          )}

          {calculs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-foreground-muted">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Laize</th>
                    <th className="py-1 pr-2 font-medium">État</th>
                    <th className="py-1 pr-2 text-right font-medium">Longueur</th>
                    <th className="py-1 pr-2 text-right font-medium">Efficience</th>
                    <th className="py-1 pr-2 text-right font-medium">Tissu / couche</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {calculs.map((c) => {
                    const s = STATUTS[c.statut];
                    const progression = c.tempsTotalS > 0 ? Math.min(100, (c.tempsConsommeS / c.tempsTotalS) * 100) : 0;
                    const utilise = contexte.imbricationCalculId === c.id;
                    return (
                      <tr key={c.id} className={cn("border-t border-border", c.groupe !== dernierGroupe && "opacity-60")}>
                        <td className="py-1.5 pr-2 font-medium text-foreground">{nf(c.laizeCm)} cm</td>
                        <td className="py-1.5 pr-2">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={s.tone}>{c.annulationDemandee && c.statut === "en_cours" ? "Arrêt demandé" : s.libelle}</Badge>
                            {(c.statut === "en_cours" || c.statut === "en_attente") && (
                              <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-border">
                                <span className="block h-full bg-brand" style={{ width: `${progression}%` }} />
                              </span>
                            )}
                            {c.agent && (
                              <Badge tone="accent">
                                <Bot className="h-3 w-3" /> Proposé par {c.agent}
                              </Badge>
                            )}
                            {meilleurId === c.id && (
                              <Badge tone="brand">
                                <Trophy className="h-3 w-3" /> Moins de tissu
                              </Badge>
                            )}
                            {utilise && (
                              <Badge tone="success">
                                <CheckCircle2 className="h-3 w-3" /> Fichier du tracé
                              </Badge>
                            )}
                          </span>
                          {c.erreur && <span className="mt-0.5 block text-danger">{c.erreur}</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{c.longueurCm !== null ? `${nf(c.longueurCm)} cm` : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{c.tauxUtilisation !== null ? `${nf(c.tauxUtilisation * 100)} %` : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{c.surfaceCoucheM2 !== null ? `${nf(c.surfaceCoucheM2, 2)} m²` : "—"}</td>
                        <td className="py-1.5 text-right">
                          <span className="inline-flex gap-1">
                            {c.longueurCm !== null && (
                              <Button size="sm" variant="ghost" type="button" onClick={() => voir(c.id)} disabled={pending}>
                                <Eye className="h-3.5 w-3.5" /> {apercu?.id === c.id ? "Masquer" : "Aperçu"}
                              </Button>
                            )}
                            {(c.statut === "en_cours" || c.statut === "en_attente") && canModify && !c.annulationDemandee && (
                              <Button size="sm" variant="ghost" type="button" onClick={() => annuler(c.id)} disabled={pending}>
                                <Square className="h-3.5 w-3.5" /> Arrêter
                              </Button>
                            )}
                            {c.statut === "termine" && contexte.modifiable && canModify && !utilise && (
                              <Button size="sm" type="button" onClick={() => utiliser(c)} loading={pending}>
                                Utiliser ce tracé
                              </Button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-foreground-muted">
                Pendant le calcul, la longueur affichée est celle du meilleur tracé trouvé jusque-là. « Arrêter » garde ce meilleur tracé.
              </p>
            </div>
          )}

          {apercu && <ApercuTrace apercu={apercu} />}
        </>
      )}
    </div>
  );
}

const COULEURS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#4d7c0f", "#c026d3"];

/** Aperçu du tracé calculé : longueur selon X, laize selon Y (comme le fichier). */
export function ApercuTrace({ apercu }: { apercu: ApercuCalcul }) {
  const { longueurMm: L, largeurMm: W, margeMm: m } = apercu;
  const contours = new Map(apercu.pieces.map((p) => [p.id, p]));
  // Une couleur par taille (fin du libellé « … · L »).
  const tailles = [...new Set(apercu.pieces.map((p) => p.libelle.split(" · ")[1]?.replace(" (retournée)", "") ?? ""))];
  const couleur = (libelle: string) => COULEURS[Math.max(0, tailles.indexOf(libelle.split(" · ")[1]?.replace(" (retournée)", "") ?? "")) % COULEURS.length];
  const marge = Math.max(L, W) * 0.01;

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-md border border-border bg-white">
        <svg viewBox={`${-marge} ${-marge} ${L + 2 * marge} ${W + 2 * marge}`} className="h-auto w-full min-w-[640px]" role="img" aria-label="Aperçu du tracé calculé">
          <g transform={`translate(0 ${W}) scale(1 -1)`}>
            <rect x={0} y={0} width={L} height={W} fill="#f8fafc" stroke="#94a3b8" strokeWidth={W / 400} />
            {m > 0 && (
              <>
                <line x1={0} y1={m} x2={L} y2={m} stroke="#cbd5e1" strokeDasharray={`${W / 80} ${W / 80}`} strokeWidth={W / 600} />
                <line x1={0} y1={W - m} x2={L} y2={W - m} stroke="#cbd5e1" strokeDasharray={`${W / 80} ${W / 80}`} strokeWidth={W / 600} />
              </>
            )}
            {apercu.placements.map((pl, i) => {
              const piece = contours.get(pl.pieceId);
              if (!piece) return null;
              const a = (pl.rotation * Math.PI) / 180;
              const c = Math.cos(a);
              const s = Math.sin(a);
              const pts = piece.contour
                .map(([x, y0]) => {
                  const y = pl.miroir ? -y0 : y0;
                  return `${(x * c - y * s + pl.x).toFixed(1)},${(x * s + y * c + pl.y).toFixed(1)}`;
                })
                .join(" ");
              const col = couleur(piece.libelle);
              return (
                <polygon key={i} points={pts} fill={col} fillOpacity={0.18} stroke={col} strokeWidth={W / 500}>
                  <title>{piece.libelle}</title>
                </polygon>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-foreground-muted">
        {tailles.map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COULEURS[tailles.indexOf(t) % COULEURS.length] }} /> {t}
          </span>
        ))}
        <span>
          · {nf(L / 10)} cm × {nf(W / 10)} cm — survolez une pièce pour son nom
        </span>
      </div>
    </div>
  );
}
