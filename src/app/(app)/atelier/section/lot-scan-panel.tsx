"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { LotCodeInput } from "@/components/atelier/lot-code-input";
import { scanArticleLot, type DestinationLot } from "./actions";

/**
 * Lots QR (SF-5) : à l'arrivée d'un lot dans la section, puis à son départ,
 * on scanne son étiquette. Le parcours du lot (sections traversées) se lit
 * ensuite sur sa fiche et depuis le BL. Après le scan, la destination du lot
 * s'affiche (étape 4a, S17) : article, tailles, couleur de chaque composant,
 * verrou de personnalisation — jamais le client.
 */
export function LotScanPanel({ sectionId }: { sectionId: string }) {
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [destination, setDestination] = useState<DestinationLot | null>(null);
  const scan = (sens: "entree" | "sortie") =>
    startTransition(async () => {
      const res = await scanArticleLot(code, sens, sectionId);
      if (res.error) toast.error("Scan refusé", { description: res.error });
      else {
        toast.success(res.message ?? "Scan enregistré");
        setDestination(res.destination ?? null);
        setCode("");
      }
    });
  return (
    <>
    <Card>
      <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm font-medium text-foreground sm:w-40">Lot reçu / parti</p>
        <div className="flex-1">
          <LotCodeInput value={code} onChange={setCode} disabled={pending} />
        </div>
        <div className="flex gap-2">
          <Button size="md" variant="secondary" loading={pending} disabled={!code.trim()} onClick={() => scan("entree")}>
            Entrée
          </Button>
          <Button size="md" variant="secondary" loading={pending} disabled={!code.trim()} onClick={() => scan("sortie")}>
            Sortie
          </Button>
        </div>
      </CardBody>
    </Card>
    {destination && <DestinationCard d={destination} onClose={() => setDestination(null)} />}
    </>
  );
}

/** Ce que le lot devient : article, tailles, couleur de chaque composant — sans le client (S17). */
function DestinationCard({ d, onClose }: { d: DestinationLot; onClose: () => void }) {
  const tailles = Object.entries(d.tailles ?? {}).filter(([, n]) => Number(n) > 0);
  return (
    <Card className="border-brand/30 bg-brand-soft/30">
      <CardBody className="space-y-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium">
            {d.code} · {d.odf}
            {d.article ? ` · ${d.article}` : ""}
          </p>
          <button onClick={onClose} className="text-xs text-foreground-muted hover:text-foreground">
            Fermer
          </button>
        </div>
        {tailles.length > 0 && (
          <p>
            <span className="text-foreground-muted">Tailles : </span>
            {tailles.map(([t, n]) => `${n} ${t.split("/").pop()}`).join(", ")}
          </p>
        )}
        {(d.couleur_unique || d.couleurs_zones.length > 0) && (
          <p>
            <span className="text-foreground-muted">Couleur : </span>
            {d.couleurs_zones.length > 0 ? d.couleurs_zones.map((z) => `${z.zone} ${z.couleur}`).join(" · ") : d.couleur_unique}
          </p>
        )}
        {d.composants.length > 0 && (
          <p>
            <span className="text-foreground-muted">Composants : </span>
            {d.composants.map((c) => `${Number(c.quantite)} × ${c.composant}${c.couleur ? ` (${c.couleur})` : ""}`).join(", ")}
          </p>
        )}
        {d.verrouille && (
          <p className="text-xs text-warning">Verrouillé sur cette ligne d&apos;ODF depuis son entrée en {d.verrouille_section ?? "personnalisation"}.</p>
        )}
      </CardBody>
    </Card>
  );
}
