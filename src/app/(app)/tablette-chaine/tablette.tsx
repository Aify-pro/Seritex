"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "qrcode";
import { AlertTriangle, CheckCircle2, ClipboardList, Minus, PackageCheck, PackagePlus, Plus, Printer, QrCode, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { printOnSunmi, qrModuleSize } from "@/lib/print/sunmi";
import { LOT_CODE_PATTERN } from "@/components/atelier/lot-code-input";
import { QrScannerDialog } from "@/components/atelier/qr-scanner-dialog";
import type { Paquet, Travail } from "@/lib/confection/data";
import {
  apercuPaquet,
  fermerArret,
  livrerPaquet,
  ouvrirArret,
  retournerPaquet,
  saisirEffectif,
  sortirChaine,
  type ApercuPaquet,
  type Livraison,
  type SortieEnregistree,
} from "../confection/actions";

type Onglet = "a_faire" | "ravitailler" | "sortie" | "chaine";
type ChaineLite = { id: string; nom: string; code: string; section: string };
type Bilan = { sorties: number; entrees: number; enCours: number; presents: number | null; source: string | null } | null;

const CAUSES: [string, string][] = [
  ["coupure_courant", "Coupure de courant"],
  ["attente_ravitaillement", "Attente de ravitaillement"],
  ["panne", "Panne"],
  ["changement_modele", "Changement de modèle"],
  ["autre", "Autre"],
];

/** Identifiant d'un geste (idempotence). `randomUUID` manque sur les vieilles tablettes. */
function nouvelleCle(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Étiquette d'un paquet sur l'imprimante de la tablette Sunmi (rouleau 58 mm). */
function imprimerEtiquette(code: string, lignes: string[]) {
  const url = `${window.location.origin}/lots/${code}`;
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size;
  printOnSunmi([
    { op: "align", v: 1 },
    { op: "text", v: "SERITEX\n", size: 56 },
    { op: "feed", n: 1 },
    { op: "qr", v: url, module: qrModuleSize(modules), level: 1 },
    { op: "feed", n: 1 },
    { op: "text", v: `${code}\n`, size: 40 },
    ...lignes.filter(Boolean).map((l) => ({ op: "text" as const, v: `${l}\n`, size: 28 })),
    { op: "feed", n: 4 },
  ]);
  toast.info("Impression envoyée à l'imprimante de la tablette");
}

// Gros boutons : utilisables debout, d'une main.
const gros = "flex min-h-14 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors disabled:opacity-50";
const principal = `${gros} bg-brand text-brand-foreground active:bg-brand/80`;
const secondaire = `${gros} border-2 border-border bg-surface text-foreground active:bg-surface-muted`;
const carte = "rounded-2xl border border-border bg-surface p-4 shadow-sm";

function Compteur({ value, onChange, max, petit = false }: { value: number; onChange: (n: number) => void; max?: number; petit?: boolean }) {
  const borne = (n: number) => Math.max(0, max === undefined ? n : Math.min(max, n));
  const bouton = cn("flex shrink-0 items-center justify-center rounded-lg border-2 border-border bg-surface active:bg-surface-muted", petit ? "h-10 w-10" : "h-12 w-12");
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label="Moins" className={bouton} onClick={() => onChange(borne(value - 1))}>
        <Minus className="h-5 w-5" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value === 0 ? "" : value}
        placeholder="0"
        onChange={(e) => onChange(borne(Math.trunc(Number(e.target.value) || 0)))}
        className={cn("rounded-lg border-2 border-border bg-surface text-center text-lg font-semibold outline-none focus:border-brand", petit ? "h-10 w-16" : "h-12 w-20")}
      />
      <button type="button" aria-label="Plus" className={bouton} onClick={() => onChange(borne(value + 1))}>
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}

export function Tablette({
  chaine,
  travaux,
  paquetsAChercher,
  paquetsSurChaine,
  tailles,
  jour,
  bilan,
  presentsSaisis,
  arret,
  peutLivrer,
}: {
  chaine: ChaineLite;
  travaux: Travail[];
  paquetsAChercher: Paquet[];
  paquetsSurChaine: Paquet[];
  tailles: Record<string, string>;
  jour: string;
  bilan: Bilan;
  presentsSaisis: number | null;
  arret: { id: string; cause: string; debut: string } | null;
  peutLivrer: boolean;
}) {
  const [onglet, setOnglet] = useState<Onglet>("a_faire");
  const [paquetInitial, setPaquetInitial] = useState<ApercuPaquet | null>(null);
  const [chargement, startChargement] = useTransition();
  const libelle = (cle: string) => tailles[cle] ?? cle.split("/").pop() ?? cle;
  const onglets: { key: Onglet; label: string; icon: React.ReactNode }[] = [
    { key: "a_faire", label: "À faire", icon: <ClipboardList className="h-5 w-5" /> },
    { key: "ravitailler", label: "Ravitailler", icon: <PackagePlus className="h-5 w-5" /> },
    { key: "sortie", label: "Sortie", icon: <PackageCheck className="h-5 w-5" /> },
    { key: "chaine", label: "Chaîne", icon: <Settings2 className="h-5 w-5" /> },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{chaine.nom}</h1>
          <p className="text-sm text-foreground-muted">
            {chaine.section} · aujourd&apos;hui : {bilan?.sorties ?? 0} sorties · {bilan?.enCours ?? 0} en cours
          </p>
        </div>
        {arret && <span className="rounded-full bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger">Chaîne à l&apos;arrêt</span>}
      </header>

      <nav aria-label="Écrans de la tablette" className="grid grid-cols-4 gap-2">
        {onglets.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setOnglet(o.key)}
            aria-current={onglet === o.key ? "page" : undefined}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 text-sm font-semibold",
              onglet === o.key ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface text-foreground"
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </nav>

      {onglet === "a_faire" && (
        <AFaire
          travaux={travaux}
          paquets={paquetsAChercher}
          enCours={chargement}
          onPrendre={(code) =>
            startChargement(async () => {
              const res = await apercuPaquet(code);
              if (res.error || !res.paquet) {
                toast.error("Paquet refusé", { description: res.error });
                return;
              }
              setPaquetInitial(res.paquet);
              setOnglet("ravitailler");
            })
          }
        />
      )}
      {onglet === "ravitailler" && (
        <Ravitailler key={paquetInitial?.code ?? "vide"} chaine={chaine} libelle={libelle} paquetInitial={paquetInitial} surChaine={paquetsSurChaine} peutLivrer={peutLivrer} />
      )}
      {onglet === "sortie" && <Sortie chaine={chaine} travaux={travaux.filter((t) => t.statut !== "termine")} peutLivrer={peutLivrer} />}
      {onglet === "chaine" && <EtatChaine chaine={chaine} jour={jour} bilan={bilan} presentsSaisis={presentsSaisis} arret={arret} />}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   À faire : ce que le chef a attribué, et les paquets à aller chercher
---------------------------------------------------------------------------- */
function AFaire({ travaux, paquets, onPrendre, enCours }: { travaux: Travail[]; paquets: Paquet[]; onPrendre: (code: string) => void; enCours: boolean }) {
  if (travaux.length === 0) {
    return (
      <div className={carte}>
        <p className="text-lg font-semibold">Rien à faire pour l&apos;instant.</p>
        <p className="mt-1 text-sm text-foreground-muted">Le chef de section n&apos;a pas encore attribué de travail à cette chaîne.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {travaux.map((t) => {
        const aChercher = paquets.filter((p) => p.lineId === t.lineId);
        const pct = t.demande > 0 ? Math.min(100, Math.round((t.sorti / t.demande) * 100)) : 0;
        return (
          <section key={t.id} className={cn(carte, t.priorite > 0 && "border-danger")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-foreground">{t.article}</p>
                <p className="text-sm text-foreground-muted">
                  {t.odf} · {t.tailles.map((x) => `${x.libelle} ${x.quantite}`).join(" · ")}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-sm font-semibold",
                  t.priorite > 0 ? "bg-danger-soft text-danger" : t.statut === "en_cours" ? "bg-success-soft text-success" : "bg-info-soft text-info"
                )}
              >
                {t.priorite > 0 ? "Urgent" : t.statut === "en_cours" ? "En cours" : "À démarrer"}
              </span>
            </div>
            {t.consigne && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning-soft p-2 text-sm font-medium text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t.consigne}
              </p>
            )}
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-sm text-foreground-muted">
              Sorti <strong className="text-foreground">{t.sorti}</strong> sur {t.demande} · ravitaillé {t.ravitaille}
            </p>
            {aChercher.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-semibold text-foreground">Paquets à aller chercher</p>
                {aChercher.map((p) => (
                  <button key={p.id} type="button" disabled={enCours} onClick={() => onPrendre(p.code)} className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-border bg-surface px-3 py-2.5 text-left active:bg-surface-muted">
                    <span>
                      <span className="block text-base font-semibold">{p.piece ?? "Vêtements"}</span>
                      <span className="block text-sm text-foreground-muted">{p.tailles.map((x) => `${x.libelle} ${x.quantite}`).join(" · ")}</span>
                    </span>
                    <span className="font-mono text-sm text-foreground-muted">{p.code}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Ravitailler : scanner, tout ou une partie, livrer
---------------------------------------------------------------------------- */
function Ravitailler({
  chaine,
  libelle,
  paquetInitial,
  surChaine,
  peutLivrer,
}: {
  chaine: ChaineLite;
  libelle: (cle: string) => string;
  paquetInitial: ApercuPaquet | null;
  surChaine: Paquet[];
  peutLivrer: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState(paquetInitial?.code ?? "");
  const [paquet, setPaquet] = useState<ApercuPaquet | null>(paquetInitial);
  const [partie, setPartie] = useState<Record<string, number> | null>(null);
  const [fait, setFait] = useState<Livraison | null>(null);
  const [retour, setRetour] = useState<{ code: string; motif: string } | null>(null);
  // La clé du geste survit à un échec réseau : renvoyer le même geste ne le compte qu'une fois.
  const cle = useRef<string | null>(null);

  function chercher(c: string) {
    const propre = c.trim().toUpperCase();
    if (!propre) return;
    setFait(null);
    start(async () => {
      const res = await apercuPaquet(propre);
      if (res.error || !res.paquet) {
        setPaquet(null);
        toast.error("Paquet refusé", { description: res.error });
        return;
      }
      setPaquet(res.paquet);
      setPartie(null);
      setCode(res.paquet.code);
      cle.current = null;
    });
  }

  function livrer() {
    if (!paquet) return;
    const composition = partie ? Object.fromEntries(Object.entries(partie).filter(([, n]) => n > 0)) : null;
    if (composition && Object.keys(composition).length === 0) return toast.error("Indiquez les quantités à livrer");
    start(async () => {
      cle.current ??= nouvelleCle();
      const res = await livrerPaquet(paquet.code, chaine.id, composition, cle.current);
      if (res.error || !res.livraison) {
        toast.error("Livraison refusée", { description: res.error });
        return;
      }
      cle.current = null;
      setFait(res.livraison);
      setPaquet(null);
      setCode("");
      router.refresh();
    });
  }

  const total = paquet ? Object.values(paquet.tailles).reduce((n, q) => n + Number(q), 0) : 0;
  const totalPartie = partie ? Object.values(partie).reduce((n, q) => n + q, 0) : 0;

  return (
    <div className="space-y-3">
      {fait && (
        <section className="rounded-2xl border-2 border-success bg-success-soft p-4">
          <p className="flex items-center gap-2 text-lg font-bold text-success">
            <CheckCircle2 className="h-6 w-6" /> {fait.total} pièces livrées à {fait.chaine}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {fait.nouveau_paquet
              ? `Nouveau paquet ${fait.code} : collez sa nouvelle étiquette. Le reste garde l'étiquette ${fait.origine}.`
              : `Paquet ${fait.code} livré en entier.`}
            {fait.deja_enregistre && " (déjà enregistré : compté une seule fois)"}
          </p>
          {fait.nouveau_paquet && (
            <button
              type="button"
              className={cn(principal, "mt-3 w-full")}
              onClick={() =>
                imprimerEtiquette(fait.code, [
                  Object.entries(fait.composition)
                    .map(([t, n]) => `${libelle(t)} · ${n} pcs`)
                    .join("  "),
                  `Chaîne ${chaine.code}`,
                  `Issu de ${fait.origine}`,
                ])
              }
            >
              <Printer className="h-5 w-5" /> Imprimer la nouvelle étiquette
            </button>
          )}
        </section>
      )}

      <section className={carte}>
        <button type="button" className={cn(principal, "w-full min-h-20 text-xl")} onClick={() => setScan(true)} disabled={pending}>
          <QrCode className="h-7 w-7" /> Scanner un paquet
        </button>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && chercher(code)}
            placeholder="ou saisir LOT-AAAA-NNNNN"
            aria-label="Code du paquet"
            className="h-12 min-w-0 flex-1 rounded-xl border-2 border-border bg-surface px-3 font-mono text-base outline-none focus:border-brand"
          />
          <button type="button" className={cn(secondaire, "min-h-12")} onClick={() => chercher(code)} disabled={pending || !code.trim()}>
            Chercher
          </button>
        </div>
      </section>

      {paquet && (
        <section className={carte}>
          <p className="font-mono text-sm text-foreground-muted">{paquet.code}</p>
          <p className="text-xl font-bold text-foreground">{paquet.piece ?? "Vêtements"}</p>
          <p className="text-sm text-foreground-muted">
            {paquet.odf} · {paquet.article}
          </p>
          <p className="mt-2 text-base">
            {Object.entries(paquet.tailles)
              .map(([t, n]) => `${libelle(t)} : ${n}`)
              .join(" · ")}{" "}
            — <strong>{total} pièces</strong>
          </p>

          {paquet.chaineActuelle ? (
            <p className="mt-3 rounded-lg bg-warning-soft p-3 text-sm font-medium text-warning">
              Ce paquet est déjà sur la chaîne {paquet.chaineActuelle}. Pour le déplacer, faites d&apos;abord un retour (liste ci-dessous).
            </p>
          ) : !peutLivrer ? (
            <p className="mt-3 text-sm text-foreground-muted">Votre compte ne peut pas livrer de paquet.</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={partie === null ? principal : secondaire}
                  onClick={() => {
                    cle.current = null;
                    setPartie(null);
                  }}
                >
                  Tout ({total})
                </button>
                <button
                  type="button"
                  className={partie !== null ? principal : secondaire}
                  onClick={() => {
                    cle.current = null;
                    setPartie(Object.fromEntries(Object.keys(paquet.tailles).map((t) => [t, 0])));
                  }}
                >
                  Une partie
                </button>
              </div>
              {partie && (
                <div className="mt-3 space-y-2">
                  {Object.entries(paquet.tailles).map(([t, max]) => (
                    <div key={t} className="flex items-center justify-between gap-3">
                      <span className="text-base font-semibold">
                        {libelle(t)} <span className="font-normal text-foreground-muted">sur {max}</span>
                      </span>
                      <Compteur value={partie[t] ?? 0} max={Number(max)} onChange={(n) => {
                          cle.current = null;
                          setPartie((p) => ({ ...(p ?? {}), [t]: n }));
                        }}
                      />
                    </div>
                  ))}
                  <p className="text-sm text-foreground-muted">La partie livrée reçoit une nouvelle étiquette ; le reste garde celle-ci.</p>
                </div>
              )}
              <button type="button" className={cn(gros, "mt-4 w-full min-h-16 bg-success text-lg text-white active:bg-success/80")} onClick={livrer} disabled={pending || (partie !== null && totalPartie === 0)}>
                {pending ? "Enregistrement…" : `Livrer ${partie ? totalPartie : total} pièces à ${chaine.nom}`}
              </button>
            </>
          )}
        </section>
      )}

      {surChaine.length > 0 && (
        <section className={carte}>
          <p className="text-base font-semibold">Paquets sur la chaîne ({surChaine.length})</p>
          <div className="mt-2 space-y-2">
            {surChaine.map((p) => (
              <div key={p.id} className="rounded-xl border border-border p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-semibold">{p.piece ?? "Vêtements"}</span>
                    <span className="block text-sm text-foreground-muted">
                      {p.code} · {p.tailles.map((x) => `${x.libelle} ${x.quantite}`).join(" · ")}
                    </span>
                  </span>
                  {peutLivrer && retour?.code !== p.code && (
                    <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-medium" onClick={() => setRetour({ code: p.code, motif: "" })}>
                      Retour
                    </button>
                  )}
                </div>
                {retour?.code === p.code && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={retour.motif}
                      onChange={(e) => setRetour({ code: p.code, motif: e.target.value })}
                      placeholder="Pourquoi retirer ce paquet ?"
                      className="h-11 min-w-0 flex-1 rounded-lg border-2 border-border bg-surface px-3 text-sm outline-none focus:border-brand"
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-danger px-3 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={pending || !retour.motif.trim()}
                      onClick={() =>
                        start(async () => {
                          const res = await retournerPaquet(p.code, chaine.id, retour.motif, nouvelleCle());
                          if (res.error) toast.error("Retour refusé", { description: res.error });
                          else {
                            toast.success(`Paquet ${p.code} retiré de la chaîne`);
                            setRetour(null);
                            router.refresh();
                          }
                        })
                      }
                    >
                      Retirer
                    </button>
                    <button type="button" className="rounded-lg border border-border px-3 text-sm" onClick={() => setRetour(null)}>
                      Annuler
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <QrScannerDialog
        open={scan}
        onOpenChange={setScan}
        title="Scanner le paquet"
        description="Visez le QR code de l'étiquette du paquet."
        pattern={LOT_CODE_PATTERN}
        invalidMessage="QR code reconnu, mais ce n'est pas une étiquette de paquet."
        onMatch={(c) => {
          setScan(false);
          chercher(c);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Sortie : compter ce qui sort de la chaîne
---------------------------------------------------------------------------- */
type Comptage = Record<string, { bonne: number; reprise: number; rebut: number }>;

function Sortie({ chaine, travaux, peutLivrer }: { chaine: ChaineLite; travaux: Travail[]; peutLivrer: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [travailId, setTravailId] = useState<string | null>(travaux.length === 1 ? travaux[0].id : null);
  const [comptage, setComptage] = useState<Comptage>({});
  const [details, setDetails] = useState(false);
  const [fait, setFait] = useState<(SortieEnregistree & { article: string; odf: string }) | null>(null);
  // Même geste renvoyé après une coupure réseau = même clé ; un comptage modifié = nouveau geste.
  const cle = useRef<string | null>(null);
  const travail = travaux.find((t) => t.id === travailId) ?? null;

  const set = (taille: string, type: "bonne" | "reprise" | "rebut", n: number) => {
    cle.current = null;
    setComptage((c) => ({ ...c, [taille]: { ...(c[taille] ?? { bonne: 0, reprise: 0, rebut: 0 }), [type]: n } }));
  };
  const total = Object.values(comptage).reduce((n, c) => n + c.bonne + c.reprise + c.rebut, 0);

  function enregistrer() {
    if (!travail) return;
    const lignes = Object.entries(comptage).flatMap(([taille, c]) =>
      (["bonne", "reprise", "rebut"] as const).filter((type) => c[type] > 0).map((type) => ({ taille, type, quantite: c[type] }))
    );
    start(async () => {
      cle.current ??= nouvelleCle();
      const res = await sortirChaine(chaine.id, travail.workOrderId, lignes, cle.current);
      if (res.error || !res.sortie) {
        toast.error("Sortie refusée", { description: res.error });
        return;
      }
      cle.current = null;
      setFait({ ...res.sortie, article: travail.article, odf: travail.odf });
      setComptage({});
      router.refresh();
    });
  }

  if (travaux.length === 0) {
    return (
      <div className={carte}>
        <p className="text-lg font-semibold">Aucun travail en cours sur cette chaîne.</p>
        <p className="mt-1 text-sm text-foreground-muted">Un travail apparaît ici dès qu&apos;un paquet est livré ou que le chef en attribue un.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fait && (
        <section className="rounded-2xl border-2 border-success bg-success-soft p-4">
          <p className="flex items-center gap-2 text-lg font-bold text-success">
            <CheckCircle2 className="h-6 w-6" /> {fait.total} pièces enregistrées
          </p>
          {fait.a_regulariser.length > 0 && (
            <p className="mt-1 text-sm text-foreground">
              Le comptage est gardé. Une partie reste à déclarer par le chef de section (plus de pièces que ce que la section a reçu) : il est prévenu sur sa fiche de chaîne.
            </p>
          )}
          {fait.lot_code && (
            <button
              type="button"
              className={cn(principal, "mt-3 w-full")}
              onClick={() =>
                imprimerEtiquette(fait.lot_code!, [
                  fait.odf,
                  fait.article.slice(0, 30),
                  Object.entries(fait.bonnes)
                    .map(([t, n]) => `${t.split("/").pop()} · ${n} pcs`)
                    .join("  "),
                  `Sortie ${chaine.code}`,
                ])
              }
            >
              <Printer className="h-5 w-5" /> Imprimer l&apos;étiquette du lot {fait.lot_code}
            </button>
          )}
        </section>
      )}

      {travaux.length > 1 && (
        <section className={carte}>
          <p className="mb-2 text-base font-semibold">Quel article sort ?</p>
          <div className="space-y-2">
            {travaux.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  cle.current = null;
                  setTravailId(t.id);
                  setComptage({});
                }}
                className={cn("w-full rounded-xl border-2 px-3 py-3 text-left", t.id === travailId ? "border-brand bg-brand-soft" : "border-border bg-surface")}
              >
                <span className="block text-base font-bold">{t.article}</span>
                <span className="block text-sm text-foreground-muted">
                  {t.odf} · sorti {t.sorti} sur {t.demande}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {travail && (
        <section className={carte}>
          <p className="text-lg font-bold">{travail.article}</p>
          <p className="text-sm text-foreground-muted">
            {travail.odf} · déjà sorti {travail.sorti} sur {travail.demande}
          </p>
          <div className="mt-3 space-y-3">
            {travail.tailles.map((t) => {
              const c = comptage[t.cle] ?? { bonne: 0, reprise: 0, rebut: 0 };
              return (
                <div key={t.cle} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xl font-bold">{t.libelle}</span>
                    <Compteur value={c.bonne} onChange={(n) => set(t.cle, "bonne", n)} />
                  </div>
                  {details && (
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2">
                      <label className="flex flex-col gap-1 text-sm font-medium text-warning">
                        À reprendre
                        <Compteur petit value={c.reprise} onChange={(n) => set(t.cle, "reprise", n)} />
                      </label>
                      <label className="flex flex-col gap-1 text-sm font-medium text-danger">
                        Rebut
                        <Compteur petit value={c.rebut} onChange={(n) => set(t.cle, "rebut", n)} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="mt-3 text-sm font-semibold text-brand" onClick={() => setDetails((d) => !d)}>
            {details ? "Masquer reprises et rebuts" : "+ Signaler des reprises ou des rebuts"}
          </button>
          <button type="button" className={cn(gros, "mt-3 w-full min-h-16 bg-success text-lg text-white active:bg-success/80")} onClick={enregistrer} disabled={pending || total === 0 || !peutLivrer}>
            {pending ? "Enregistrement…" : `Enregistrer ${total} pièces`}
          </button>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Chaîne : effectif du jour et arrêts
---------------------------------------------------------------------------- */
function EtatChaine({
  chaine,
  jour,
  bilan,
  presentsSaisis,
  arret,
}: {
  chaine: ChaineLite;
  jour: string;
  bilan: Bilan;
  presentsSaisis: number | null;
  arret: { id: string; cause: string; debut: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [presents, setPresents] = useState(presentsSaisis ?? 0);
  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok);
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      <section className={carte}>
        <p className="text-base font-semibold">Personnes présentes aujourd&apos;hui</p>
        {bilan?.source === "pointage" ? (
          <p className="mt-1 text-sm text-foreground-muted">Le pointage du jour donne {bilan.presents} présent(s) : c&apos;est ce chiffre qui est retenu.</p>
        ) : (
          <p className="mt-1 text-sm text-foreground-muted">Comptez les personnes au travail sur la chaîne ce matin.</p>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <Compteur value={presents} max={500} onChange={setPresents} />
          <button type="button" className={secondaire} disabled={pending} onClick={() => run(() => saisirEffectif(chaine.id, jour, presents), "Effectif enregistré")}>
            Enregistrer
          </button>
        </div>
      </section>

      <section className={carte}>
        {arret ? (
          <>
            <p className="text-lg font-bold text-danger">Chaîne à l&apos;arrêt</p>
            <p className="text-sm text-foreground-muted">
              {CAUSES.find(([k]) => k === arret.cause)?.[1] ?? arret.cause} depuis {arret.debut}
            </p>
            <button type="button" className={cn(gros, "mt-3 w-full min-h-16 bg-success text-lg text-white")} disabled={pending} onClick={() => run(() => fermerArret(arret.id, chaine.id), "Reprise enregistrée")}>
              La chaîne repart
            </button>
          </>
        ) : (
          <>
            <p className="text-base font-semibold">La chaîne s&apos;arrête ?</p>
            <p className="mt-1 text-sm text-foreground-muted">Touchez la cause : l&apos;heure est notée toute seule.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {CAUSES.map(([k, v]) => (
                <button key={k} type="button" className={secondaire} disabled={pending} onClick={() => run(() => ouvrirArret(chaine.id, k, ""), "Arrêt enregistré")}>
                  {v}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
