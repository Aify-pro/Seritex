"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { besoinsCoupe, type BesoinCoupeGroupe } from "@/app/(app)/atelier/patronnage/fiches-actions";

interface LignePiece {
  cle: string;
  semiFini: string;
  taille: string;
  couleur: string | null;
  demandees: number;
  coupees: number;
  prevues: number;
  reste: number;
}

/**
 * Pièces (semi-finis) qui composent les articles d'une fiche : pour chaque
 * semi-fini et chaque taille, ce que les nomenclatures demandent, ce qui est
 * déjà coupé, ce qui est prévu sur des tracés validés et ce qu'il reste à
 * couper. Même source que « Besoins de coupe » (besoins_coupe_agreges),
 * restreinte aux articles d'ODF de la fiche : la PAO voit les pièces à côté du
 * nombre de vêtements, quel que soit l'article.
 */
export function PiecesArticlesCard({ lineIds, refreshKey }: { lineIds: string[]; refreshKey: number }) {
  const [groupes, setGroupes] = useState<BesoinCoupeGroupe[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const cleLignes = lineIds.join(",");

  useEffect(() => {
    if (lineIds.length === 0) return;
    let annule = false;
    besoinsCoupe().then((res) => {
      if (annule) return;
      if ("error" in res) setErreur(res.error);
      else {
        setErreur(null);
        setGroupes(res);
      }
    });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleLignes, refreshKey]);

  const lignes = useMemo(() => {
    const ids = new Set(lineIds);
    const parCle = new Map<string, LignePiece>();
    for (const g of groupes ?? []) {
      for (const l of g.lignes) {
        if (!ids.has(l.lineId)) continue;
        const cle = [g.semiFiniId, g.taille, g.couleurId ?? "", g.couleur ?? ""].join("|");
        const e = parCle.get(cle) ?? { cle, semiFini: g.semiFiniNom, taille: g.taille, couleur: g.couleur, demandees: 0, coupees: 0, prevues: 0, reste: 0 };
        e.demandees += l.demandees;
        e.coupees += l.coupees;
        e.prevues += l.prevues;
        e.reste += Math.max(l.reste, 0);
        parCle.set(cle, e);
      }
    }
    return [...parCle.values()].sort((a, b) => a.semiFini.localeCompare(b.semiFini) || a.taille.localeCompare(b.taille));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupes, cleLignes]);

  if (lineIds.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Pièces à couper (semi-finis)"
        description="Les pièces qui composent les vêtements de l'ODF, par taille. Reste = demandé − coupé − prévu (tracés validés). Elles viennent de la nomenclature de l'article."
      />
      <CardBody>
        {erreur ? (
          <p className="text-sm text-danger">{erreur}</p>
        ) : groupes === null ? (
          <p className="text-sm text-foreground-muted">Chargement…</p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Pièce (semi-fini)</Th>
                <Th>Taille</Th>
                <Th>Couleur</Th>
                <Th align="right">Demandées</Th>
                <Th align="right">Coupées</Th>
                <Th align="right">Prévues</Th>
                <Th align="right">Reste</Th>
              </Tr>
            </Thead>
            <Tbody>
              {lignes.length === 0 ? (
                <EmptyRow colSpan={7}>Aucune pièce : l&apos;article n&apos;a pas de nomenclature à semi-finis, ou son ODF n&apos;est plus ouvert.</EmptyRow>
              ) : (
                lignes.map((l) => (
                  <Tr key={l.cle}>
                    <Td>{l.semiFini}</Td>
                    <Td>{l.taille}</Td>
                    <Td>{l.couleur ?? "—"}</Td>
                    <Td align="right">{l.demandees}</Td>
                    <Td align="right">{l.coupees}</Td>
                    <Td align="right">{l.prevues}</Td>
                    <Td align="right" className="font-medium">{l.reste}</Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
