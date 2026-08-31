"use client";

import { useMemo, useState } from "react";
import {
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileWarning,
  RotateCcw,
  Wand2,
  ClipboardCheck,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ============================================================
   NOTE DE PORTÉE — prototype fonctionnel, pas encore branché
   ============================================================
   Ce composant fait tourner un vrai moteur de comparaison
   géométrique (aire, périmètre, signature radiale), mais sur des
   silhouettes générées en démonstration : aucun parseur DXF réel
   n'est encore branché ici (aucun fichier DXF fourni à ce stade),
   et rien n'est persisté en base (tout vit en état React local).
   Voir le rapport « module Tracé » pour la portée exacte et les
   prochaines étapes (parseur DXF, entités PATTERN/PATTERN_PIECE,
   droits de validation des corrections manuelles).
============================================================ */

type Point = [number, number];
type PieceType = "devant" | "dos" | "manche" | "poche" | "col";
type SizeCode = "XS" | "S" | "M" | "L" | "XL" | "XXL";

interface ShapeGeometry {
  points: Point[];
  area: number;
  perimeter: number;
  radial: number[];
}

interface PatternPiece {
  id: string;
  name: string;
  type: PieceType;
  expectedCount: number;
  geom: ShapeGeometry;
}

interface Pattern {
  id: string;
  size: SizeCode;
  pieces: PatternPiece[];
}

interface Article {
  id: string;
  articleCode: string;
  designation: string;
  tolerancePct: number;
  patterns: Pattern[];
}

interface ReferencePieceRef {
  articleId: string;
  articleCode: string;
  size: SizeCode;
  piece: PatternPiece;
}

interface CandidatePiece {
  refPieceId: string;
  type: PieceType;
  expectedName: string;
  points: Point[];
  note?: string;
}

interface MatchResult {
  confidence: number;
  areaDiffPct: number;
  perimDiffPct: number;
  shapeDiffPct: number;
  ref: ReferencePieceRef;
}

interface ResultRowData {
  candidate: CandidatePiece;
  candGeom: ShapeGeometry;
  best: MatchResult;
  declaredRef?: ReferencePieceRef;
  accepted: boolean;
  flag: "ok" | "attention" | "rejete";
  manualValidated: boolean;
  manualReason?: string;
}

/* ============================================================
   1. GÉOMÉTRIE — extraction de forme, signature, comparaison
   ============================================================
   Isolé du rendu pour pouvoir être repris tel quel côté serveur
   (Python/ezdxf) une fois validé sur de vrais fichiers DXF.
============================================================ */

function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function polygonPerimeter(points: Point[]): number {
  let p = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

function centroid(points: Point[]): Point {
  let cx = 0,
    cy = 0,
    a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a = a / 2;
  if (Math.abs(a) < 1e-9) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

// Angle de l'axe principal (ACP simplifiée par matrice de covariance)
function principalAngle(points: Point[], c: Point): number {
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const [x, y] of points) {
    const dx = x - c[0],
      dy = y - c[1];
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

function rotatePoint([x, y]: Point, angle: number): Point {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [x * cos + y * sin, -x * sin + y * cos];
}

// Échantillonne le contour à pas constant le long du périmètre
function sampleBoundary(points: Point[], n = 240): Point[] {
  const perim = polygonPerimeter(points);
  if (perim === 0) return new Array(n).fill(points[0] ?? [0, 0]);
  const step = perim / n;
  const samples: Point[] = [];
  let segIndex = 0;
  let cum = 0; // distance cumulée du début du contour jusqu'au début du segment courant
  let [x1, y1] = points[0];
  let [x2, y2] = points[1 % points.length];
  let segLen = Math.hypot(x2 - x1, y2 - y1);

  for (let k = 0; k < n; k++) {
    const targetDist = k * step;
    while (cum + segLen < targetDist && segIndex < points.length - 1) {
      cum += segLen;
      segIndex++;
      [x1, y1] = points[segIndex % points.length];
      [x2, y2] = points[(segIndex + 1) % points.length];
      segLen = Math.hypot(x2 - x1, y2 - y1);
    }
    const remaining = targetDist - cum;
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, remaining / segLen));
    samples.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return samples;
}

// Signature radiale : distance centroïde -> contour par secteur angulaire (24 secteurs)
function radialSignature(points: Point[], c: Point, angle: number, bins = 24): number[] {
  const buckets = new Array(bins).fill(0);
  const boundary = sampleBoundary(points, 360);
  for (const p of boundary) {
    const rp = rotatePoint([p[0] - c[0], p[1] - c[1]], angle);
    const theta = Math.atan2(rp[1], rp[0]);
    const bin = Math.min(bins - 1, Math.floor(((theta + Math.PI) / (2 * Math.PI)) * bins));
    const r = Math.hypot(rp[0], rp[1]);
    if (r > buckets[bin]) buckets[bin] = r;
  }
  return buckets;
}

// Normalisation : centrage + alignement d'axe, SANS mise à l'échelle
// (l'échelle réelle est volontairement conservée : c'est elle qui distingue les tailles)
function normalizeShape(points: Point[]): ShapeGeometry {
  const c = centroid(points);
  const angle = principalAngle(points, c);
  const area = polygonArea(points);
  const perimeter = polygonPerimeter(points);
  const radial = radialSignature(points, c, angle);
  const rotated = points.map((p) => rotatePoint([p[0] - c[0], p[1] - c[1]], angle));
  return { points: rotated, area, perimeter, radial };
}

function compareShapes(
  candidate: ShapeGeometry,
  reference: ShapeGeometry
): { confidence: number; areaDiffPct: number; perimDiffPct: number; shapeDiffPct: number } {
  const areaDiffPct = (Math.abs(candidate.area - reference.area) / reference.area) * 100;
  const perimDiffPct = (Math.abs(candidate.perimeter - reference.perimeter) / reference.perimeter) * 100;
  const meanR = reference.radial.reduce((s, v) => s + v, 0) / reference.radial.length;
  let sq = 0;
  for (let i = 0; i < reference.radial.length; i++) {
    const d = candidate.radial[i] - reference.radial[i];
    sq += d * d;
  }
  const rmse = Math.sqrt(sq / reference.radial.length);
  const shapeDiffPct = meanR > 0 ? (rmse / meanR) * 100 : 100;

  const confidence = Math.max(0, 100 - (0.3 * areaDiffPct + 0.25 * perimDiffPct + 0.45 * shapeDiffPct));

  return {
    confidence: Math.round(confidence * 10) / 10,
    areaDiffPct: Math.round(areaDiffPct * 10) / 10,
    perimDiffPct: Math.round(perimDiffPct * 10) / 10,
    shapeDiffPct: Math.round(shapeDiffPct * 10) / 10,
  };
}

/* ============================================================
   2. GÉNÉRATEURS DE FORMES DE DÉMONSTRATION
   ============================================================
   En l'absence de vrais fichiers DXF à ce stade, ces fonctions
   génèrent des silhouettes plausibles de pièces de patron pour
   tester le moteur de comparaison de bout en bout. À remplacer
   par un vrai parseur DXF dès que des fichiers réels seront
   fournis.
============================================================ */

const SIZE_SCALE: Record<SizeCode, number> = { XS: 0.9, S: 0.95, M: 1.0, L: 1.06, XL: 1.13, XXL: 1.2 };

function basePiecePoints(type: PieceType): Point[] {
  switch (type) {
    case "devant":
      return [[-24, 0], [-24, 40], [-14, 58], [-6, 63], [0, 64], [6, 63], [14, 58], [24, 40], [24, 0]];
    case "dos":
      return [[-24, 0], [-24, 42], [-15, 60], [0, 64], [15, 60], [24, 42], [24, 0]];
    case "manche":
      return [[-11, 0], [-15, 10], [-16, 30], [-10, 48], [0, 52], [10, 48], [16, 30], [15, 10], [11, 0]];
    case "poche":
      return [[-8, 0], [-8, 12], [-6, 14], [6, 14], [8, 12], [8, 0]];
    case "col":
      return [[-18, 0], [-18, 4], [18, 4], [18, 0]];
  }
}

function jitter(points: Point[], amountPct: number): Point[] {
  return points.map(([x, y]) => {
    const jx = x * (1 + (Math.random() - 0.5) * 2 * amountPct);
    const jy = y * (1 + (Math.random() - 0.5) * 2 * amountPct);
    return [jx, jy];
  });
}

function generatePiece(type: PieceType, size: SizeCode, noisePct = 0): Point[] {
  const scale = SIZE_SCALE[size] ?? 1;
  let pts = basePiecePoints(type).map(([x, y]) => [x * scale, y * scale] as Point);
  if (noisePct > 0) pts = jitter(pts, noisePct);
  return pts;
}

/* ============================================================
   3. DONNÉES DE DÉPART — bibliothèque de patrons de référence
============================================================ */

function buildPieceRecord(name: string, type: PieceType, size: SizeCode, expectedCount: number): PatternPiece {
  const pts = generatePiece(type, size, 0);
  return {
    id: `${type}-${size}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type,
    expectedCount,
    geom: normalizeShape(pts),
  };
}

function seedLibrary(): Article[] {
  const sizes: SizeCode[] = ["S", "M", "L"];
  return [
    {
      id: "art-1",
      articleCode: "TS-COL-ROND-001",
      designation: "T-shirt col rond, manches courtes",
      tolerancePct: 92,
      patterns: sizes.map((size) => ({
        id: `pat-${size}`,
        size,
        pieces: [
          buildPieceRecord("Devant", "devant", size, 1),
          buildPieceRecord("Dos", "dos", size, 1),
          buildPieceRecord("Manche", "manche", size, 2),
        ],
      })),
    },
  ];
}

/* ============================================================
   4. RENDU SVG D'UNE PIÈCE (candidat vs référence superposés)
============================================================ */

function piecesBounds(pieces: Point[][]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pts of pieces) {
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function toSvgPath(points: Point[], bounds: ReturnType<typeof piecesBounds>, pad = 6): string {
  const w = bounds.maxX - bounds.minX || 1;
  const h = bounds.maxY - bounds.minY || 1;
  const scale = Math.min((100 - 2 * pad) / w, (100 - 2 * pad) / h);
  return (
    points
      .map(([x, y], i) => {
        const sx = pad + (x - bounds.minX) * scale;
        const sy = 100 - (pad + (y - bounds.minY) * scale);
        return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

function PieceOverlay({
  candidatePoints,
  referencePoints,
  ok,
}: {
  candidatePoints: Point[];
  referencePoints: Point[] | null;
  ok: boolean;
}) {
  const bounds = piecesBounds([candidatePoints, referencePoints ?? candidatePoints]);
  return (
    <svg viewBox="0 0 100 100" className="h-[72px] w-[72px] shrink-0">
      {referencePoints && (
        <path
          d={toSvgPath(referencePoints, bounds)}
          fill="none"
          className="stroke-foreground-muted/40"
          strokeWidth="1.5"
          strokeDasharray="3,2"
        />
      )}
      <path
        d={toSvgPath(candidatePoints, bounds)}
        className={cn(ok ? "fill-success-soft stroke-success" : "fill-danger-soft stroke-danger")}
        fillOpacity="0.6"
        strokeWidth="1.8"
      />
    </svg>
  );
}

/* ============================================================
   5. COMPOSANT PRINCIPAL
============================================================ */

const THRESHOLD_DEFAULT = 92;

const PIECE_TYPE_LABELS: Record<PieceType, string> = {
  devant: "Silhouette devant",
  dos: "Silhouette dos",
  manche: "Silhouette manche",
  poche: "Silhouette poche",
  col: "Silhouette col",
};

const SCENARIOS: { id: string; label: string; desc: string }[] = [
  { id: "conforme", label: "Tracé conforme", desc: "Pièces correctes, légère tolérance de numérisation" },
  { id: "taille_glissee", label: "Taille erronée glissée", desc: "Une pièce provient d'une autre taille" },
  { id: "modele_mixe", label: "Pièce d'un autre modèle", desc: "Une pièce étrangère mélangée au tracé" },
  { id: "non_reconnaissable", label: "Géométrie corrompue", desc: "Une pièce déformée / illisible" },
];

export function PatronnageWorkspace() {
  const [tab, setTab] = useState<"bibliotheque" | "comparaison">("bibliotheque");
  const [library, setLibrary] = useState<Article[]>(seedLibrary);

  const [showAddPattern, setShowAddPattern] = useState(false);
  const [newArticleCode, setNewArticleCode] = useState("");
  const [newDesignation, setNewDesignation] = useState("");
  const [newSize, setNewSize] = useState<SizeCode>("M");
  const [newExistingArticle, setNewExistingArticle] = useState("");
  const [newPieces, setNewPieces] = useState<{ name: string; type: PieceType; count: number }[]>([
    { name: "Devant", type: "devant", count: 1 },
  ]);

  const [declaredArticle, setDeclaredArticle] = useState<string>(library[0]?.id ?? "");
  const [declaredSize, setDeclaredSize] = useState<SizeCode>("M");
  const [scenario, setScenario] = useState<string | null>(null);
  const [candidatePieces, setCandidatePieces] = useState<CandidatePiece[] | null>(null);
  const [results, setResults] = useState<{ rows: ResultRowData[]; globalAccepted: boolean } | null>(null);
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [threshold, setThreshold] = useState(THRESHOLD_DEFAULT);

  const declaredArticleObj = library.find((a) => a.id === declaredArticle);

  const allReferencePieces: ReferencePieceRef[] = useMemo(() => {
    const list: ReferencePieceRef[] = [];
    for (const art of library) {
      for (const pat of art.patterns) {
        for (const piece of pat.pieces) {
          list.push({ articleId: art.id, articleCode: art.articleCode, size: pat.size, piece });
        }
      }
    }
    return list;
  }, [library]);

  function runScenario(kind: string) {
    setScenario(kind);
    setResults(null);
    setCorrectingIndex(null);
    const pattern = declaredArticleObj?.patterns.find((p) => p.size === declaredSize);
    if (!pattern) return;

    const pieces = pattern.pieces.flatMap((piece) =>
      Array.from({ length: piece.expectedCount }, () => ({
        refPieceId: piece.id,
        type: piece.type,
        expectedName: piece.name,
      }))
    );

    const generated: CandidatePiece[] = pieces.map((p) => ({
      ...p,
      points: generatePiece(p.type, declaredSize, 0.01),
    }));

    if (kind === "taille_glissee" && generated.length > 0) {
      const idx = Math.floor(generated.length / 2);
      const wrongSize: SizeCode = declaredSize === "L" ? "S" : "L";
      generated[idx] = {
        ...generated[idx],
        points: generatePiece(generated[idx].type, wrongSize, 0.01),
        note: `taille réelle ${wrongSize}`,
      };
    }
    if (kind === "modele_mixe" && generated.length > 0) {
      generated[0] = {
        ...generated[0],
        points: generatePiece("poche", declaredSize, 0.01),
        type: "poche",
        note: "pièce étrangère au modèle",
      };
    }
    if (kind === "non_reconnaissable" && generated.length > 0) {
      const idx = generated.length - 1;
      generated[idx] = {
        ...generated[idx],
        points: generated[idx].points.map(([x, y]) => [x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40]),
        note: "géométrie corrompue",
      };
    }
    setCandidatePieces(generated);
  }

  function runRecognition() {
    if (!candidatePieces) return;
    const computed: ResultRowData[] = candidatePieces.map((cand) => {
      const candGeom = normalizeShape(cand.points);
      let best: MatchResult | null = null;
      for (const ref of allReferencePieces) {
        const cmp = compareShapes(candGeom, ref.piece.geom);
        if (!best || cmp.confidence > best.confidence) {
          best = { ...cmp, ref };
        }
      }
      const declaredRef = allReferencePieces.find((r) => r.piece.id === cand.refPieceId);
      const matchesDeclared = Boolean(best && declaredRef && best.ref.piece.id === declaredRef.piece.id);
      const accepted = matchesDeclared && !!best && best.confidence >= threshold;
      return {
        candidate: cand,
        candGeom,
        best: best as MatchResult,
        declaredRef,
        accepted,
        flag: accepted ? "ok" : best && best.confidence >= threshold - 15 ? "attention" : "rejete",
        manualValidated: false,
      };
    });
    const globalAccepted = computed.every((r) => r.accepted || r.manualValidated);
    setResults({ rows: computed, globalAccepted });
  }

  function applyManualOverride(index: number, reason: string) {
    setResults((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((row, i) =>
        i !== index ? row : { ...row, manualValidated: true, manualReason: reason }
      );
      return { rows, globalAccepted: rows.every((r) => r.accepted || r.manualValidated) };
    });
    setCorrectingIndex(null);
    setCorrectionReason("");
  }

  function addPieceRow() {
    setNewPieces((p) => [...p, { name: "", type: "devant", count: 1 }]);
  }
  function removePieceRow(i: number) {
    setNewPieces((p) => p.filter((_, idx) => idx !== i));
  }
  function updatePieceRow(i: number, field: "name" | "type" | "count", value: string | number) {
    setNewPieces((p) => p.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  function submitNewPattern(e: React.FormEvent) {
    e.preventDefault();
    const pieces = newPieces
      .filter((p) => p.name.trim())
      .map((p) => buildPieceRecord(p.name.trim(), p.type, newSize, Number(p.count) || 1));

    if (newExistingArticle) {
      setLibrary((lib) =>
        lib.map((art) => {
          if (art.id !== newExistingArticle) return art;
          const existingIdx = art.patterns.findIndex((p) => p.size === newSize);
          const patterns =
            existingIdx >= 0
              ? art.patterns.map((p, i) => (i === existingIdx ? { ...p, pieces: [...p.pieces, ...pieces] } : p))
              : [...art.patterns, { id: `pat-${newSize}-${Date.now()}`, size: newSize, pieces }];
          return { ...art, patterns };
        })
      );
    } else {
      const id = `art-${Date.now()}`;
      setLibrary((lib) => [
        ...lib,
        {
          id,
          articleCode: newArticleCode || `ART-${Date.now()}`,
          designation: newDesignation || "Sans désignation",
          tolerancePct: THRESHOLD_DEFAULT,
          patterns: [{ id: `pat-${newSize}`, size: newSize, pieces }],
        },
      ]);
    }
    setShowAddPattern(false);
    setNewArticleCode("");
    setNewDesignation("");
    setNewExistingArticle("");
    setNewPieces([{ name: "Devant", type: "devant", count: 1 }]);
  }

  const availableSizes = declaredArticleObj?.patterns.map((p) => p.size) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-foreground">
        <FileWarning className="h-3.5 w-3.5 shrink-0" />
        <span>
          Prototype de validation — reconnaissance géométrique simulée sur des silhouettes de démonstration (pas
          encore de fichiers DXF réels). Voir le rapport joint pour la portée exacte.
        </span>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            { id: "bibliotheque" as const, label: "Bibliothèque de patrons" },
            { id: "comparaison" as const, label: "Comparaison de tracé" },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              tab === t.id
                ? "border-brand font-medium text-brand"
                : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bibliotheque" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-lg text-sm text-foreground-muted">
              Chaque article référence un ou plusieurs patrons (un par taille), composés de pièces géométriques
              individuelles. Cette bibliothèque sert de référence à toute reconnaissance automatique d&apos;un tracé
              importé.
            </p>
            <Button size="sm" onClick={() => setShowAddPattern((v) => !v)} className="shrink-0">
              <Plus className="h-3.5 w-3.5" /> Ajouter un patron de référence
            </Button>
          </div>

          {showAddPattern && (
            <Card>
              <CardHeader title="Fiche de référencement du patron" />
              <CardBody className="space-y-4">
                <form onSubmit={submitNewPattern} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Rattacher à un article existant">
                      <select
                        value={newExistingArticle}
                        onChange={(e) => setNewExistingArticle(e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      >
                        <option value="">— Nouvel article —</option>
                        {library.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.articleCode} — {a.designation}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Taille de ce patron">
                      <select
                        value={newSize}
                        onChange={(e) => setNewSize(e.target.value as SizeCode)}
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      >
                        {Object.keys(SIZE_SCALE).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  {!newExistingArticle && (
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Code article">
                        <input
                          value={newArticleCode}
                          onChange={(e) => setNewArticleCode(e.target.value)}
                          placeholder="ex. TS-COL-V-002"
                          className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                        />
                      </Field>
                      <Field label="Désignation">
                        <input
                          value={newDesignation}
                          onChange={(e) => setNewDesignation(e.target.value)}
                          placeholder="ex. T-shirt col V, manches courtes"
                          className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                        />
                      </Field>
                    </div>
                  )}

                  <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-surface-muted px-4 py-3 text-sm text-foreground-muted">
                    <Upload className="h-4 w-4 shrink-0" />
                    <span>
                      Import du DXF de référence — désactivé dans ce prototype. Les pièces ajoutées utilisent des
                      silhouettes de démonstration à la bonne échelle pour tester le moteur de comparaison.
                    </span>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-foreground-muted">Pièces du patron — nécessaires à la reconnaissance</p>
                    {newPieces.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={row.name}
                          onChange={(e) => updatePieceRow(i, "name", e.target.value)}
                          placeholder="Nom de la pièce (ex. Manche gauche)"
                          className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
                        />
                        <select
                          value={row.type}
                          onChange={(e) => updatePieceRow(i, "type", e.target.value as PieceType)}
                          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                        >
                          {Object.entries(PIECE_TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={row.count}
                          onChange={(e) => updatePieceRow(i, "count", Number(e.target.value))}
                          title="Nombre attendu par taille placée"
                          className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                        />
                        <button
                          type="button"
                          onClick={() => removePieceRow(i)}
                          className="p-1 text-foreground-muted hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addPieceRow}
                      className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" /> Ajouter une pièce
                    </button>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddPattern(false)}>
                      Annuler
                    </Button>
                    <Button type="submit" size="sm">
                      Enregistrer le patron
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          )}

          <div className="space-y-4">
            {library.map((art) => (
              <Card key={art.id}>
                <CardHeader
                  title={art.articleCode}
                  description={art.designation}
                  action={
                    <span className="text-xs text-foreground-muted">
                      seuil de reconnaissance : {art.tolerancePct}%
                    </span>
                  }
                />
                <div className="divide-y divide-border">
                  {art.patterns.map((pat) => (
                    <div key={pat.id} className="flex items-center gap-4 px-5 py-3">
                      <span className="w-10 shrink-0 text-xs font-medium text-foreground">{pat.size}</span>
                      <div className="flex gap-4 overflow-x-auto">
                        {pat.pieces.map((piece) => (
                          <div key={piece.id} className="flex shrink-0 items-center gap-2">
                            <PieceOverlay candidatePoints={piece.geom.points} referencePoints={null} ok />
                            <div className="text-xs">
                              <p className="text-foreground">{piece.name}</p>
                              <p className="text-foreground-muted">
                                ×{piece.expectedCount} · {Math.round(piece.geom.area)} cm²
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "comparaison" && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="1. Déclaration du tracé reçu" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Field label="Article déclaré">
                  <select
                    value={declaredArticle}
                    onChange={(e) => setDeclaredArticle(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                  >
                    {library.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.articleCode}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Taille déclarée">
                  <select
                    value={declaredSize}
                    onChange={(e) => setDeclaredSize(e.target.value as SizeCode)}
                    className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                  >
                    {availableSizes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Seuil de tolérance zéro (%)">
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                  />
                </Field>
              </div>

              <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-surface-muted px-4 py-3 text-sm text-foreground-muted">
                <Upload className="h-4 w-4 shrink-0" />
                <span>Import du tracé DXF réel — désactivé dans ce prototype. Utilisez un cas de démonstration.</span>
              </div>

              <div>
                <p className="mb-2 text-xs text-foreground-muted">Cas de démonstration</p>
                <div className="grid grid-cols-2 gap-2">
                  {SCENARIOS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => runScenario(s.id)}
                      className={cn(
                        "rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                        scenario === s.id ? "border-brand bg-brand-soft" : "border-border hover:border-foreground-muted"
                      )}
                    >
                      <p className="text-foreground">{s.label}</p>
                      <p className="text-xs text-foreground-muted">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {candidatePieces && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={runRecognition}>
                    <Wand2 className="h-3.5 w-3.5" /> Lancer la reconnaissance
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {results && (
            <div className="space-y-4">
              <div
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-5 py-4",
                  results.globalAccepted ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft"
                )}
              >
                {results.globalAccepted ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 text-danger" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {results.globalAccepted ? "Tracé accepté" : "Tracé refusé — tolérance zéro"}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {results.globalAccepted
                      ? "Toutes les pièces détectées correspondent au patron déclaré au-dessus du seuil."
                      : "Au moins une pièce ne correspond pas au patron déclaré avec une confiance suffisante. Aucune correction n'est appliquée automatiquement."}
                  </p>
                </div>
              </div>

              <Card>
                <div className="divide-y divide-border">
                  {results.rows.map((row, i) => (
                    <ResultRow
                      key={i}
                      row={row}
                      index={i}
                      allReferencePieces={allReferencePieces}
                      correctingIndex={correctingIndex}
                      setCorrectingIndex={setCorrectingIndex}
                      correctionReason={correctionReason}
                      setCorrectionReason={setCorrectionReason}
                      applyManualOverride={applyManualOverride}
                      threshold={threshold}
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-foreground-muted">{label}</label>
      {children}
    </div>
  );
}

function ResultRow({
  row,
  index,
  allReferencePieces,
  correctingIndex,
  setCorrectingIndex,
  correctionReason,
  setCorrectionReason,
  applyManualOverride,
  threshold,
}: {
  row: ResultRowData;
  index: number;
  allReferencePieces: ReferencePieceRef[];
  correctingIndex: number | null;
  setCorrectingIndex: (i: number | null) => void;
  correctionReason: string;
  setCorrectionReason: (v: string) => void;
  applyManualOverride: (index: number, reason: string) => void;
  threshold: number;
}) {
  const isCorrecting = correctingIndex === index;
  const flag = row.manualValidated ? "ok" : row.flag;
  const flagMeta = {
    ok: { icon: <CheckCircle2 className="h-4 w-4 text-success" />, label: "Reconnu", tone: "success" as const },
    attention: {
      icon: <AlertTriangle className="h-4 w-4 text-warning" />,
      label: "Incertain",
      tone: "warning" as const,
    },
    rejete: { icon: <XCircle className="h-4 w-4 text-danger" />, label: "Non reconnu", tone: "danger" as const },
  }[flag];

  return (
    <div className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <PieceOverlay
          candidatePoints={row.candGeom.points}
          referencePoints={row.declaredRef ? row.declaredRef.piece.geom.points : null}
          ok={row.accepted || row.manualValidated}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={flagMeta.tone} dot>
              {row.manualValidated ? "Corrigé manuellement" : flagMeta.label}
            </Badge>
            <span className="text-sm text-foreground">
              Meilleure correspondance :{" "}
              <span className="font-medium">
                {row.best.ref.articleCode} · {row.best.ref.size} · {row.best.ref.piece.name}
              </span>
            </span>
            <span className="text-xs text-foreground-muted">confiance {row.best.confidence}%</span>
          </div>

          {row.candidate.note && (
            <p className="mt-1 text-xs text-foreground-muted">Repère démo : {row.candidate.note}</p>
          )}

          <div className="mt-1.5 flex gap-4 text-xs text-foreground-muted">
            <span>Δ aire {row.best.areaDiffPct}%</span>
            <span>Δ périmètre {row.best.perimDiffPct}%</span>
            <span>Δ forme {row.best.shapeDiffPct}%</span>
            <span>seuil requis {threshold}%</span>
          </div>

          {!row.accepted && !row.manualValidated && !isCorrecting && (
            <button
              onClick={() => setCorrectingIndex(index)}
              className="mt-2 flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Corriger manuellement
            </button>
          )}

          {isCorrecting && (
            <ManualCorrectionForm
              allReferencePieces={allReferencePieces}
              reason={correctionReason}
              setReason={setCorrectionReason}
              onCancel={() => setCorrectingIndex(null)}
              onValidate={() => applyManualOverride(index, correctionReason)}
            />
          )}

          {row.manualValidated && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-foreground-muted">
              <ClipboardCheck className="h-3 w-3" /> Motif : {row.manualReason || "—"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualCorrectionForm({
  allReferencePieces,
  reason,
  setReason,
  onCancel,
  onValidate,
}: {
  allReferencePieces: ReferencePieceRef[];
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onValidate: (refPieceId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <p className="text-xs text-foreground-muted">
        Réassigner cette pièce à la correspondance réelle constatée visuellement, puis motiver la correction
        (obligatoire — reste soumis à validation du responsable production avant tout lancement de coupe).
      </p>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
      >
        <option value="">— Choisir la pièce réelle —</option>
        {allReferencePieces.map((r) => (
          <option key={r.piece.id} value={r.piece.id}>
            {r.articleCode} · {r.size} · {r.piece.name}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motif de la correction (obligatoire)"
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
        <Button size="sm" disabled={!selected || !reason.trim()} onClick={() => selected && reason.trim() && onValidate(selected)}>
          Valider la correction
        </Button>
      </div>
    </div>
  );
}
