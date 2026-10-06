"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { receiveRolls } from "./actions";

export interface TissuOption {
  id: string;
  nom: string;
  coloris: { sageReference: string; couleur: string | null }[];
}

type Draft = { numero_fournisseur: string; laize_cm: string; poids_kg: string; bain: string; emplacement: string };
const empty: Draft = { numero_fournisseur: "", laize_cm: "", poids_kg: "", bain: "", emplacement: "" };
const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

/** Lignes collées depuis la liste de colisage : n° fournisseur ; laize ; poids ; bain (séparateur ; ou tabulation). */
function parsePackingList(text: string): Draft[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/[;\t]/).map((c) => c.trim()))
    .filter((c) => c.length >= 3 && /\d/.test(c[2] ?? ""))
    .map((c) => ({ numero_fournisseur: c[0] ?? "", laize_cm: c[1] ?? "", poids_kg: c[2] ?? "", bain: c[3] ?? "", emplacement: "" }));
}

/**
 * Réception de rouleaux (migration 0095) : saisie rouleau par rouleau, ou
 * liste de colisage du fournisseur collée. Chaque rouleau reçoit un code et
 * une étiquette QR à coller dessus.
 */
export function RollReception({ tissus }: { tissus: TissuOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tissuId, setTissuId] = useState(tissus[0]?.id ?? "");
  const [coloris, setColoris] = useState("");
  const [mode, setMode] = useState<"saisie" | "import">("saisie");
  const [rows, setRows] = useState<Draft[]>([{ ...empty }]);
  const [paste, setPaste] = useState("");
  const [created, setCreated] = useState<string[]>([]);
  const tissu = tissus.find((t) => t.id === tissuId);
  const imported = useMemo(() => parsePackingList(paste), [paste]);
  const lignes = mode === "saisie" ? rows.filter((r) => r.poids_kg.trim()) : imported;

  function submit() {
    startTransition(async () => {
      const res = await receiveRolls(
        tissuId,
        lignes.map((r) => ({ ...r, sage_reference: coloris })),
        mode
      );
      if (res.error) toast.error("Réception refusée", { description: res.error });
      else {
        toast.success(`${res.codes?.length ?? 0} rouleau(x) réceptionné(s)`);
        setCreated(res.codes ?? []);
        setRows([{ ...empty }]);
        setPaste("");
        router.refresh();
      }
    });
  }

  if (tissus.length === 0) {
    return <p className="text-sm text-foreground-muted">Aucun tissu actif : créez d&apos;abord l&apos;article (matière première) dans Articles.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Tissu</span>
          <select value={tissuId} onChange={(e) => { setTissuId(e.target.value); setColoris(""); }} className={input}>
            {tissus.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Coloris (article Sage)</span>
          <select value={coloris} onChange={(e) => setColoris(e.target.value)} className={input}>
            <option value="">—</option>
            {(tissu?.coloris ?? []).map((c) => (
              <option key={c.sageReference} value={c.sageReference}>
                {c.sageReference}
                {c.couleur ? ` · ${c.couleur}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-1">
          {(["saisie", "import"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`h-9 flex-1 rounded-md border px-2 text-sm font-medium ${mode === m ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface"}`}
            >
              {m === "saisie" ? "Saisie" : "Liste fournisseur"}
            </button>
          ))}
        </div>
      </div>

      {mode === "saisie" ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_6rem_1fr_1fr_auto]">
              <input value={r.numero_fournisseur} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, numero_fournisseur: e.target.value } : x)))} placeholder="N° fournisseur" className={input} />
              <input value={r.laize_cm} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, laize_cm: e.target.value } : x)))} placeholder="Laize cm" className={input} />
              <input value={r.poids_kg} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, poids_kg: e.target.value } : x)))} placeholder="Poids kg" className={input} />
              <input value={r.bain} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, bain: e.target.value } : x)))} placeholder="Bain" className={input} />
              <input value={r.emplacement} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, emplacement: e.target.value } : x)))} placeholder="Emplacement" className={input} />
              <button type="button" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ ...empty }])} className="text-foreground-muted hover:text-danger" aria-label="Retirer la ligne">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { ...empty, bain: rows[rows.length - 1]?.bain ?? "" }])}>
            <Plus className="h-3.5 w-3.5" /> Rouleau
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder={"Collez la liste de colisage, une ligne par rouleau :\nN° fournisseur ; laize (cm) ; poids (kg) ; bain\nR1024;180;22,4;B12"}
            className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs"
          />
          <p className="text-xs text-foreground-muted">{imported.length} rouleau(x) reconnu(s).</p>
        </div>
      )}

      <Button loading={pending} disabled={!tissuId || lignes.length === 0} onClick={submit}>
        Réceptionner {lignes.length > 0 ? `${lignes.length} rouleau(x)` : ""}
      </Button>

      {created.length > 0 && (
        <p className="text-sm">
          Codes attribués : <span className="font-mono text-xs">{created.join(", ")}</span>{" "}
          <a href={`/api/stock/rouleaux/etiquettes?codes=${created.join(",")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
            <Printer className="h-3.5 w-3.5" /> Imprimer les étiquettes
          </a>
        </p>
      )}
    </div>
  );
}
