import Link from "next/link";
import { requireModule, can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Tbody, Tr, Td, EmptyRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { loadBilan, piecesParPersonne, today, type BilanChaine } from "@/lib/confection/data";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const decale = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Production > Confection : le jour d'une section de couture, chaîne par
 * chaîne — présents, pièces entrées et sorties, en-cours, rendement. Sans
 * temps par article (lot 3), le rendement se lit en pièces par personne.
 */
export default async function ConfectionPage({ searchParams }: { searchParams: Promise<{ jour?: string }> }) {
  await requireModule("confection");
  const sp = await searchParams;
  const aujourdhui = today();
  const jour = sp.jour && JOUR.test(sp.jour) && sp.jour <= aujourdhui ? sp.jour : aujourdhui;
  const [bilan, peutRegler] = await Promise.all([loadBilan(jour), can("parametres_confection", "view")]);

  const total = (k: "sorties" | "entrees" | "en_cours" | "rebuts" | "reprises") => bilan.reduce((n, b) => n + b[k], 0);
  const presents = bilan.reduce((n, b) => n + (b.presents ?? 0), 0);
  const sections = [...new Set(bilan.map((b) => b.section))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Confection"
        description={jour === aujourdhui ? "Aujourd'hui, chaîne par chaîne." : `Journée du ${formatDate(jour)}.`}
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/confection?jour=${decale(jour, -1)}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-muted">
              ← Veille
            </Link>
            {jour !== aujourdhui && (
              <>
                <Link href={`/confection?jour=${decale(jour, 1)}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-muted">
                  Lendemain →
                </Link>
                <Link href="/confection" className="rounded-md bg-brand px-3 py-1.5 font-medium text-brand-foreground">
                  Aujourd&apos;hui
                </Link>
              </>
            )}
          </div>
        }
      />

      {bilan.length === 0 ? (
        <Card>
          <CardBody className="space-y-2">
            <p className="text-sm text-foreground">Aucune chaîne de couture n&apos;est encore créée.</p>
            <p className="text-sm text-foreground-muted">
              {peutRegler ? (
                <>
                  Créez vos chaînes (Bonneterie 1, Polo…) dans{" "}
                  <Link href="/parametres/confection" className="font-medium text-brand hover:underline">
                    Paramètres &gt; Atelier &gt; Confection
                  </Link>
                  .
                </>
              ) : (
                "Elles se créent dans Paramètres > Atelier > Confection (responsable de production ou administrateur)."
              )}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Pièces sorties" value={total("sorties").toLocaleString("fr-FR")} tone="brand" />
            <StatCard label="Présents" value={presents} hint={presents > 0 ? `${(Math.round((total("sorties") / presents) * 10) / 10).toLocaleString("fr-FR")} pièces par personne` : "Effectif non renseigné"} />
            <StatCard label="En-cours dans les chaînes" value={total("en_cours").toLocaleString("fr-FR")} hint="Pièces ravitaillées pas encore sorties" />
            <StatCard label="Reprises et rebuts" value={`${total("reprises")} / ${total("rebuts")}`} tone={total("rebuts") > 0 ? "warning" : "neutral"} />
          </div>

          {sections.map((section) => (
            <Card key={section}>
              <CardHeader title={section} />
              <Table>
                <Thead>
                  <tr>
                  <Th>Chaîne</Th>
                  <Th>Présents</Th>
                  <Th>Entrées</Th>
                  <Th>Sorties</Th>
                  <Th>En-cours</Th>
                  <Th>Reprises / rebuts</Th>
                  <Th>Arrêts</Th>
                  <Th>Rendement</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {bilan.filter((b) => b.section === section).length === 0 && <EmptyRow colSpan={8}>Aucune chaîne.</EmptyRow>}
                  {bilan
                    .filter((b) => b.section === section)
                    .map((b) => (
                      <LigneChaine key={b.chaine_id} b={b} jour={jour} aujourdhui={jour === aujourdhui} />
                    ))}
                </Tbody>
              </Table>
            </Card>
          ))}
          <p className="text-xs text-foreground-muted">
            Entrées : pièces livrées dans la journée (manches, corps, cols… comptés tels quels). En-cours : vêtements complets ravitaillés et pas encore sortis.
            Rendement en pièces par personne présente ; il passera en pourcentage quand les opérations et leurs temps seront décrits par article.
          </p>
        </>
      )}
    </div>
  );
}

function LigneChaine({ b, jour, aujourdhui }: { b: BilanChaine; jour: string; aujourdhui: boolean }) {
  const ppp = piecesParPersonne(b);
  return (
    <Tr>
      <Td>
        <Link href={`/confection/chaines/${b.chaine_id}${aujourdhui ? "" : `?jour=${jour}`}`} className="font-medium text-brand hover:underline">
          {b.nom}
        </Link>
        <span className="ml-2 font-mono text-xs text-foreground-muted">{b.code}</span>
        {b.type === "support" && (
          <Badge tone="info" className="ml-2">
            Support
          </Badge>
        )}
      </Td>
      <Td>
        {b.presents === null ? (
          <Badge tone="warning">À renseigner</Badge>
        ) : (
          <>
            {b.presents}
            {b.affectes > 0 && <span className="text-foreground-muted"> / {b.affectes}</span>}
            <span className="ml-1 text-xs text-foreground-muted">{b.source_presence === "pointage" ? "pointage" : "saisi"}</span>
          </>
        )}
      </Td>
      <Td>{b.entrees.toLocaleString("fr-FR")}</Td>
      <Td className="font-semibold">{b.sorties.toLocaleString("fr-FR")}</Td>
      <Td>
        {b.en_cours.toLocaleString("fr-FR")}
        {aujourdhui && b.en_cours === 0 && b.sorties > 0 && (
          <Badge tone="warning" className="ml-2">
            À ravitailler
          </Badge>
        )}
      </Td>
      <Td>
        {b.reprises} / {b.rebuts}
      </Td>
      <Td>{b.minutes_arret > 0 ? `${b.minutes_arret} min` : "—"}</Td>
      <Td>
        {ppp === null ? "—" : `${ppp.toLocaleString("fr-FR")} p./pers.`}
        {b.a_regulariser > 0 && (
          <Badge tone="danger" className="ml-2">
            {b.a_regulariser} à régulariser
          </Badge>
        )}
      </Td>
    </Tr>
  );
}
