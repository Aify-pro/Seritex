"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { migrerAncienPatron } from "@/app/(app)/atelier/patronnage/actions";

export interface AncienPatron {
  id: string;
  code: string;
  designation: string;
  /** Article (produit fini) auquel ce patron était rattaché. */
  article: string;
  tailles: string[];
  pieces: string[];
}

const IGNORER = "__ignorer__";

/** Un ancien patron : une liste déroulante par pièce (semi-fini qui la porte, ou ignorée). */
function Carte({ ancien, semiFinis }: { ancien: AncienPatron; semiFinis: { id: string; nom: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choix, setChoix] = useState<Record<string, string>>({});
  const complet = ancien.pieces.length > 0 && ancien.pieces.every((p) => choix[p]);

  function migrer() {
    startTransition(async () => {
      const res = await migrerAncienPatron(
        ancien.id,
        ancien.pieces.map((piece) => ({ piece, semiFiniId: choix[piece] === IGNORER ? null : choix[piece] }))
      );
      if (res.error) toast.error(res.error);
      else {
        toast.success(`${ancien.code} repris : ${res.crees ?? 0} patron${(res.crees ?? 0) > 1 ? "s" : ""} de semi-fini créé${(res.crees ?? 0) > 1 ? "s" : ""}`);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title={`${ancien.code} — ${ancien.designation}`}
        description={`Ancien patron du produit fini « ${ancien.article} » · tailles : ${ancien.tailles.join(", ") || "—"}`}
      />
      <CardBody className="space-y-3">
        {ancien.pieces.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucune pièce enregistrée dans ce patron.</p>
        ) : (
          <ul className="space-y-2">
            {ancien.pieces.map((piece) => (
              <li key={piece} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-medium">{piece}</span>
                <select
                  value={choix[piece] ?? ""}
                  onChange={(e) => setChoix((c) => ({ ...c, [piece]: e.target.value }))}
                  className="h-9 min-w-64 rounded-md border border-border bg-surface px-2 text-sm"
                  aria-label={`Semi-fini de la pièce ${piece}`}
                >
                  <option value="">— Choisir le semi-fini —</option>
                  {semiFinis.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom}
                    </option>
                  ))}
                  <option value={IGNORER}>Ignorer cette pièce</option>
                </select>
              </li>
            ))}
          </ul>
        )}
        {semiFinis.length === 0 && (
          <p className="text-xs text-warning">Aucun semi-fini sans patron : créez-les dans Articles (nature « Semi-fini »), un semi-fini n&apos;a qu&apos;un patron.</p>
        )}
        <div className="flex justify-end">
          <Button loading={pending} disabled={!complet} onClick={migrer}>
            Reprendre ce patron
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function MigrationAnciensPatrons({ anciens, semiFinis }: { anciens: AncienPatron[]; semiFinis: { id: string; nom: string }[] }) {
  if (anciens.length === 0) {
    return <p className="text-sm text-foreground-muted">Aucun ancien patron de produit fini à reprendre.</p>;
  }
  return (
    <div className="space-y-4">
      {anciens.map((a) => (
        <Carte key={a.id} ancien={a} semiFinis={semiFinis} />
      ))}
    </div>
  );
}
