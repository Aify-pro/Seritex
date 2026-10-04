"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Th, Td, EmptyRow } from "@/components/ui/table";
import { createConsumable, updateConsumable } from "./actions";

export interface ConsumableRow {
  id: string;
  code: string;
  designation: string;
  famille: string;
  unite: string;
  sageReference: string | null;
  nature: "consommable" | "mp";
  etape: "production" | "finition";
  actif: boolean;
  modeles: number;
}

export const UNITE_LABELS: Record<string, string> = { piece: "pièce", kg: "kg", g: "g", m: "m", l: "l" };
const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

/** Consommables (COM-G) : création, référence Sage, nature et étape, activation. */
export function ConsumablesTable({
  rows,
  familles,
  canModify,
}: {
  rows: ConsumableRow[];
  familles: { id: string; nom: string; code: string }[];
  canModify: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    designation: "",
    famille_id: familles[0]?.id ?? "",
    unite: "piece" as "piece" | "kg" | "g" | "m" | "l",
    sage_reference: "",
    nature: "consommable" as "consommable" | "mp",
    etape: "production" as "production" | "finition",
  });

  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Enregistrement refusé", { description: res.error });
      else {
        toast.success(ok);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      {canModify && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Désignation</span>
            <input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} placeholder="Bouton nacre 12 mm" className={`${input} w-52`} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Famille</span>
            <select value={draft.famille_id} onChange={(e) => setDraft({ ...draft, famille_id: e.target.value })} className={input}>
              {familles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom} ({f.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Unité</span>
            <select value={draft.unite} onChange={(e) => setDraft({ ...draft, unite: e.target.value as typeof draft.unite })} className={input}>
              {Object.entries(UNITE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Réf. Sage</span>
            <input value={draft.sage_reference} onChange={(e) => setDraft({ ...draft, sage_reference: e.target.value })} maxLength={18} className={`${input} w-32 font-mono`} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Nature</span>
            <select value={draft.nature} onChange={(e) => setDraft({ ...draft, nature: e.target.value as typeof draft.nature })} className={input}>
              <option value="consommable">Consommable</option>
              <option value="mp">Matière première</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Consommé en</span>
            <select value={draft.etape} onChange={(e) => setDraft({ ...draft, etape: e.target.value as typeof draft.etape })} className={input}>
              <option value="production">Production</option>
              <option value="finition">Finition</option>
            </select>
          </label>
          <Button
            size="sm"
            loading={pending}
            disabled={!draft.designation.trim() || !draft.famille_id}
            onClick={() =>
              run(async () => {
                const res = await createConsumable(draft);
                if (!res.error) setDraft({ ...draft, designation: "", sage_reference: "" });
                return res;
              }, "Consommable créé")
            }
          >
            Créer
          </Button>
        </div>
      )}

      <Table>
        <Thead>
          <tr>
            <Th>Code</Th>
            <Th>Désignation</Th>
            <Th>Famille</Th>
            <Th>Unité</Th>
            <Th>Réf. Sage</Th>
            <Th>Nature</Th>
            <Th>Consommé en</Th>
            <Th align="right">Modèles</Th>
            <Th>État</Th>
          </tr>
        </Thead>
        <Tbody>
          {rows.length === 0 && <EmptyRow colSpan={9}>Aucun consommable ne correspond.</EmptyRow>}
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <Td className="font-mono text-xs">{r.code}</Td>
              <Td className="font-medium">{r.designation}</Td>
              <Td>{r.famille}</Td>
              <Td>{UNITE_LABELS[r.unite] ?? r.unite}</Td>
              <Td>
                {canModify ? (
                  <input
                    defaultValue={r.sageReference ?? ""}
                    maxLength={18}
                    onBlur={(e) => e.target.value.trim() !== (r.sageReference ?? "") && run(() => updateConsumable(r.id, { sage_reference: e.target.value }), "Référence Sage enregistrée")}
                    className={`${input} h-8 w-32 font-mono text-xs`}
                  />
                ) : (
                  <span className="font-mono text-xs">{r.sageReference ?? "—"}</span>
                )}
              </Td>
              <Td>{r.nature === "mp" ? "Matière première" : "Consommable"}</Td>
              <Td>{r.etape === "finition" ? "Finition" : "Production"}</Td>
              <Td align="right">{r.modeles}</Td>
              <Td>
                {canModify ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => updateConsumable(r.id, { actif: !r.actif }), r.actif ? "Consommable désactivé" : "Consommable réactivé")}
                  >
                    <Badge tone={r.actif ? "success" : "neutral"}>{r.actif ? "Actif" : "Inactif"}</Badge>
                  </button>
                ) : (
                  <Badge tone={r.actif ? "success" : "neutral"}>{r.actif ? "Actif" : "Inactif"}</Badge>
                )}
              </Td>
            </tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
