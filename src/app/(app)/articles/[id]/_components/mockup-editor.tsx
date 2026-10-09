"use client";

import { useId, useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crosshair, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scoperSvg } from "@/lib/articles/mockup-scope";
import { analyserMockup, enregistrerMockup, supprimerMockup } from "../technique/mockup-actions";

type Point = { x: number; y: number };
export type MockupData = {
  svg: string;
  zones: Record<string, string>;
  largeur_cm: number | null;
  cadre: { x: number; y: number; w: number; h: number } | null;
  reperes: Record<string, Point>;
};

const CONTOUR = "__contour";
const IGNORER = "";
/** Couleurs de test de l'aperçu, une par zone. */
const PALETTE = ["#2a2d7c", "#f28c1b", "#e2162d", "#00723f", "#139cc2", "#c80048", "#f8c800", "#565a5c", "#7a2a14", "#8acee1"];

/** Nom de calque comparable à une zone (Illustrator encode « _ » en « _x5F_ », duplique en « col_2_ »). */
const norm = (s: string) =>
  s
    .replace(/_x([0-9a-f]{2})_/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/\d+$/, "");

const elementsDe = (svg: string) => [...new Set([...svg.matchAll(/<(?:g|path|rect|circle|ellipse|polygon|polyline)\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]))];

/**
 * Mockup SVG d'une vue (Fiche article > Technique > Zones, migration 0121) :
 * dépôt, correspondance des calques avec les zones de couleur, calibrage
 * (largeur réelle) et repères des zones d'impression.
 */
export function MockupEditor({
  modelId,
  vue,
  initial,
  zonesCouleur,
  zonesImpression,
  canModify,
}: {
  modelId: string;
  vue: "avant" | "dos";
  initial: MockupData | null;
  zonesCouleur: { zone_key: string; zone_label: string }[];
  zonesImpression: { id: string; zone_label: string }[];
  canModify: boolean;
}) {
  const router = useRouter();
  const pfx = `mk${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const conteneur = useRef<HTMLDivElement>(null);
  const calque = useRef<SVGSVGElement>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [svg, setSvg] = useState<string | null>(initial?.svg ?? null);
  const [zones, setZones] = useState<Record<string, string>>(initial?.zones ?? {});
  const [largeur, setLargeur] = useState(initial?.largeur_cm ? String(initial.largeur_cm) : "52");
  const [reperes, setReperes] = useState<Record<string, Point>>(initial?.reperes ?? {});
  const [repereActif, setRepereActif] = useState<string | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [modifie, setModifie] = useState(false);

  const elements = svg ? elementsDe(svg) : [];
  const vb = svg?.slice(0, svg.indexOf(">")).match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 400 440";

  function autoCorrespondance(ids: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of ids) {
      const n = norm(id);
      const z = zonesCouleur.find((zc) => norm(zc.zone_key) === n || norm(zc.zone_label) === n);
      if (z) out[id] = z.zone_key;
      else if (/contour|silhouette|vetement|tshirt|outline/.test(n)) out[id] = CONTOUR;
    }
    return out;
  }

  async function deposer(f: File | undefined) {
    if (!f) return;
    const res = await analyserMockup(await f.text());
    if ("error" in res && res.error) {
      toast.error(res.error);
      return;
    }
    if (!("svg" in res) || !res.svg) return;
    setSvg(res.svg);
    setZones(autoCorrespondance(res.elements));
    setReperes({});
    setModifie(true);
    toast.success(`${res.elements.length} élément(s) nommé(s) trouvé(s) dans le SVG`);
  }

  /** Clic sur l'aperçu : pose le repère de la zone d'impression choisie, en coordonnées du SVG. */
  function poserRepere(e: MouseEvent<SVGSVGElement>) {
    if (!repereActif || !calque.current) return;
    const pt = calque.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(calque.current.getScreenCTM()!.inverse());
    setReperes({ ...reperes, [repereActif]: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } });
    setRepereActif(null);
    setModifie(true);
  }

  /** Cadre du vêtement : union des éléments reliés à une zone ou au contour, en coordonnées du SVG. */
  function mesurerCadre() {
    const racine = conteneur.current?.querySelector("svg");
    if (!racine) return null;
    const inv = racine.getScreenCTM()!.inverse();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of Object.keys(zones)) {
      const el = racine.querySelector(`[id="${pfx}-${id.replace(/"/g, "")}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      for (const [cx, cy] of [[r.left, r.top], [r.right, r.bottom]]) {
        const pt = racine.createSVGPoint();
        pt.x = cx;
        pt.y = cy;
        const p = pt.matrixTransform(inv);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    }
    if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
    const r = (v: number) => Math.round(v * 10) / 10;
    return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
  }

  function enregistrer() {
    const cadre = mesurerCadre();
    if (!svg || !cadre) {
      toast.error("Associez au moins un élément du SVG à une zone pour mesurer le vêtement.");
      return;
    }
    startTransition(async () => {
      const res = await enregistrerMockup({
        modelId,
        vue,
        svg,
        zones: Object.fromEntries(Object.entries(zones).filter(([, v]) => v !== IGNORER)),
        largeurCm: Number(largeur.replace(",", ".")),
        cadre,
        reperes,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(`Mockup « ${vue} » enregistré : il apparaît sur l'e-shop sous une minute.`);
        setModifie(false);
        router.refresh();
      }
    });
  }

  function supprimer() {
    startTransition(async () => {
      const res = await supprimerMockup(modelId, vue);
      if (res?.error) toast.error(res.error);
      else {
        setSvg(null);
        setZones({});
        setReperes({});
        setModifie(false);
        router.refresh();
      }
    });
  }

  // Aperçu : chaque zone dans sa couleur de test, l'élément survolé surligné.
  const couleurZone = (zk: string) => PALETTE[Math.max(0, zonesCouleur.findIndex((z) => z.zone_key === zk)) % PALETTE.length];
  // Sélecteurs d'attribut (CSS.escape n'existe pas au rendu serveur).
  const sel = (id: string) => `[id="${pfx}-${id.replace(/["\\]/g, "\\$&")}"]`;
  const css = Object.entries(zones)
    .filter(([, zk]) => zk && zk !== CONTOUR)
    .map(([id, zk]) => `${sel(id)}, ${sel(id)} * { fill: ${couleurZone(zk)} !important; }`)
    .concat(survol ? [`${sel(survol)}, ${sel(survol)} * { stroke: #e2162d !important; stroke-width: 3px !important; }`] : [])
    .join("\n");

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">Vue {vue === "avant" ? "avant" : "dos"}</p>
        {canModify && (
          <div className="flex gap-2">
            <input ref={fichier} type="file" accept=".svg,image/svg+xml" className="sr-only" onChange={(e) => void deposer(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" onClick={() => fichier.current?.click()} disabled={pending}>
              <Upload className="h-3.5 w-3.5" /> {svg ? "Remplacer le SVG" : "Déposer le SVG"}
            </Button>
            {initial && (
              <Button size="sm" variant="ghost" onClick={supprimer} disabled={pending}>
                <Trash2 className="h-3.5 w-3.5" /> Retirer
              </Button>
            )}
          </div>
        )}
      </div>

      {!svg ? (
        <p className="text-sm text-foreground-muted">
          Aucun mockup : l&apos;e-shop utilise la silhouette standard. Exportez un SVG par vue, avec un calque nommé par zone de couleur
          ({zonesCouleur.map((z) => z.zone_key).join(", ") || "créez d'abord les zones de couleur ci-dessus"}).
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="relative rounded-md border border-border bg-surface-muted/40">
            <style>{css}</style>
            <div ref={conteneur} className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: scoperSvg(svg, pfx) }} />
            {/* Calque des repères, mêmes coordonnées que le mockup. */}
            <svg
              ref={calque}
              viewBox={vb}
              className={`absolute inset-0 h-full w-full ${repereActif ? "cursor-crosshair" : "pointer-events-none"}`}
              onClick={poserRepere}
            >
              {zonesImpression.map((z) => {
                const p = reperes[z.id];
                if (!p) return null;
                return (
                  <g key={z.id}>
                    <circle cx={p.x} cy={p.y} r="1.6%" fill="#e2162d" stroke="#fff" strokeWidth="0.4%" />
                    <text x={p.x} y={p.y} dy="-2.4%" textAnchor="middle" fontSize="3.2%" fill="#15163a" stroke="#fff" strokeWidth="0.5%" paintOrder="stroke">
                      {z.zone_label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {repereActif && (
              <p className="absolute top-2 left-2 rounded bg-brand px-2 py-1 text-xs text-white">
                Cliquez sur le mockup pour placer « {zonesImpression.find((z) => z.id === repereActif)?.zone_label} »
              </p>
            )}
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium text-foreground-muted">Calques du SVG → zones de couleur</p>
              {elements.length === 0 ? (
                <p className="mt-1 text-warning">Aucun élément nommé : nommez les calques comme les zones (corps_avant, col…) avant l&apos;export.</p>
              ) : (
                <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {elements.map((id) => (
                    <li key={id} className="flex items-center gap-2" onMouseEnter={() => setSurvol(id)} onMouseLeave={() => setSurvol(null)}>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                        {id}
                      </span>
                      <select
                        value={zones[id] ?? IGNORER}
                        disabled={!canModify || pending}
                        onChange={(e) => {
                          setZones({ ...zones, [id]: e.target.value });
                          setModifie(true);
                        }}
                        className="w-48 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                      >
                        <option value={IGNORER}>— Ignorer (détail, ombre…)</option>
                        <option value={CONTOUR}>Contour du vêtement (sans couleur)</option>
                        {zonesCouleur.map((z) => (
                          <option key={z.zone_key} value={z.zone_key}>
                            {z.zone_label}
                          </option>
                        ))}
                      </select>
                      {zones[id] && zones[id] !== CONTOUR ? (
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: couleurZone(zones[id]) }} />
                      ) : (
                        <span className="h-3 w-3 shrink-0" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="block">
              <span className="text-xs font-medium text-foreground-muted">Largeur réelle du vêtement en taille M (cm)</span>
              <input
                inputMode="decimal"
                value={largeur}
                disabled={!canModify || pending}
                onChange={(e) => {
                  setLargeur(e.target.value);
                  setModifie(true);
                }}
                className="mt-1 block w-28 rounded-md border border-border bg-surface px-2 py-1"
              />
              <span className="mt-0.5 block text-xs text-foreground-muted">D&apos;une manche à l&apos;autre du dessin : sert d&apos;échelle pour les tailles de marquage.</span>
            </label>

            <div>
              <p className="text-xs font-medium text-foreground-muted">Repères des zones d&apos;impression (cliquez puis placez sur le mockup)</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {zonesImpression.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    disabled={!canModify || pending}
                    onClick={() => setRepereActif(repereActif === z.id ? null : z.id)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                      repereActif === z.id ? "border-brand bg-brand text-white" : reperes[z.id] ? "border-success text-success" : "border-border"
                    }`}
                  >
                    <Crosshair className="h-3 w-3" /> {z.zone_label}
                    {reperes[z.id] ? " ✓" : ""}
                  </button>
                ))}
                {zonesImpression.length === 0 && <span className="text-xs text-foreground-muted">Aucune zone d&apos;impression déclarée.</span>}
              </div>
              <p className="mt-1 text-xs text-foreground-muted">Ne placez que les zones visibles sur cette vue (poitrine sur l&apos;avant, dos sur le dos…).</p>
            </div>

            {canModify && (
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={enregistrer} loading={pending} disabled={!modifie}>
                  Enregistrer le mockup
                </Button>
                {modifie && <span className="text-xs text-foreground-muted">Modifications non enregistrées</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
