import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { getBaseUrl } from "@/lib/url";
import { AgentsIa, type AgentLigne } from "./agents-ia";

/**
 * Paramètres > Agents IA (migration 0187). Un agent (Claude, n8n…) pilote le
 * calcul des tracés par des outils ; il agit au nom de son propriétaire et
 * ne décide jamais : ses calculs sont des propositions.
 */
export default async function AgentsIaPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: agents }, { data: users }, { data: journal }] = await Promise.all([
    supabase
      .from("agents_ia")
      .select("id,nom,description,prefixe_jeton,droits,actif,created_at,derniere_utilisation_le,revoque_le,proprietaire:app_users!agents_ia_proprietaire_fkey(full_name)")
      .order("created_at", { ascending: false }),
    supabase.from("app_users").select("id,full_name,email").eq("active", true).neq("role", "client").order("full_name"),
    supabase.from("agents_ia_journal").select("id,outil,statut,erreur,duree_ms,created_at,agents_ia(nom)").order("created_at", { ascending: false }).limit(100),
  ]);
  const base = await getBaseUrl();

  const lignes: AgentLigne[] = ((agents ?? []) as unknown as (Omit<AgentLigne, "proprietaire"> & { proprietaire: { full_name: string } | null })[]).map((a) => ({
    ...a,
    proprietaire: a.proprietaire?.full_name ?? "—",
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents IA"
        description="Jetons des agents IA (Claude, n8n…) qui pilotent le calcul des tracés. Un agent agit au nom de son propriétaire, jamais au-delà de ses droits ; ses calculs sont des propositions, une personne décide."
      />
      <AgentsIa agents={lignes} utilisateurs={(users ?? []).map((u) => ({ id: u.id as string, nom: (u.full_name as string) || (u.email as string) }))} />

      <Card>
        <CardHeader title="Brancher un agent" />
        <CardBody className="space-y-3 text-sm text-foreground">
          <p>
            <strong>Claude (MCP)</strong> — par exemple dans Claude Code :
          </p>
          <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 text-xs">{`claude mcp add --transport http seritex ${base}/api/agents/mcp \\
  --header "Authorization: Bearer stx_agent_…"`}</pre>
          <p>
            <strong>n8n, scripts (JSON)</strong> — <code>GET {base}/api/agents/imbrication</code> donne la liste des outils ;{" "}
            <code>POST</code> avec <code>{`{ "outil": "planifier_coupe", "arguments": { … } }`}</code> les appelle. Même en-tête{" "}
            <code>Authorization</code>.
          </p>
          <p className="text-xs text-foreground-muted">
            Outils : besoins de coupe, laizes en stock, plan de coupe, tracés en préparation, contexte d&apos;un tracé (droit « lecture ») ; lancer et
            arrêter un calcul (droit « calcul »). Aucun outil ne fait d&apos;un calcul le fichier d&apos;un tracé ni ne valide une coupe.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Journal des appels (100 derniers)" />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Date</Th>
                <Th>Agent</Th>
                <Th>Outil</Th>
                <Th>Résultat</Th>
                <Th align="right">Durée</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(journal ?? []).length === 0 && <EmptyRow colSpan={5}>Aucun appel pour l&apos;instant.</EmptyRow>}
              {(journal ?? []).map((j) => {
                const agent = (Array.isArray(j.agents_ia) ? j.agents_ia[0] : j.agents_ia) as { nom: string } | null;
                return (
                  <Tr key={j.id as number}>
                    <Td>{formatDateTime(j.created_at as string)}</Td>
                    <Td>{agent?.nom ?? "—"}</Td>
                    <Td>
                      <code className="text-xs">{j.outil as string}</code>
                    </Td>
                    <Td>
                      <Badge tone={j.statut === "ok" ? "success" : j.statut === "refuse" ? "warning" : "danger"}>
                        {j.statut === "ok" ? "OK" : j.statut === "refuse" ? "Refusé" : "Erreur"}
                      </Badge>
                      {j.erreur && <span className="ml-2 text-xs text-foreground-muted">{j.erreur as string}</span>}
                    </Td>
                    <Td align="right">{j.duree_ms as number} ms</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
