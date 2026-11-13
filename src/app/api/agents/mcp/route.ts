import { authentifierAgent } from "@/lib/agents/jetons";
import { appelerOutil, catalogueOutils } from "@/lib/agents/outils-imbrication";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serveur MCP (Model Context Protocol) des outils Seritex, transport HTTP
 * « streamable » en mode sans état : chaque requête POST porte un message
 * JSON-RPC et reçoit sa réponse en JSON. Claude Code, par exemple :
 *
 *   claude mcp add --transport http seritex https://app.seritex.ci/api/agents/mcp \
 *     --header "Authorization: Bearer stx_agent_…"
 *
 * Mêmes outils, mêmes droits et même journal que /api/agents/imbrication.
 */

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "Outils du module de coupe de Seritex. C'est le moteur de Seritex qui calcule : lisez les besoins (besoins_de_coupe), " +
  "demandez un plan de coupe (planifier_coupe, une fois par laize à comparer), lancez le calcul des tracés (lancer_calcul_trace) " +
  "et suivez-les (etat_calculs_trace). Ne dessinez ni n'estimez jamais un tracé vous-même. Un calcul est une proposition : " +
  "seule une personne peut en faire le fichier d'un tracé ou valider une coupe, dans Seritex. Répondez en français.";

type Requete = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const reponse = (id: Requete["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const erreur = (id: Requete["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function POST(req: Request) {
  const agent = await authentifierAgent(req);
  if (!agent) {
    return Response.json(erreur(null, -32001, "Jeton d'agent absent, inconnu ou révoqué."), { status: 401 });
  }
  let msg: Requete;
  try {
    msg = await req.json();
  } catch {
    return Response.json(erreur(null, -32700, "JSON illisible."), { status: 400 });
  }
  if (Array.isArray(msg)) return Response.json(erreur(null, -32600, "Les lots de messages ne sont pas pris en charge."), { status: 400 });
  // Notification (pas d'identifiant) : rien à répondre.
  if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202 });

  switch (msg.method) {
    case "initialize": {
      const demandee = String(msg.params?.protocolVersion ?? "");
      return Response.json(
        reponse(msg.id, {
          protocolVersion: VERSIONS.includes(demandee) ? demandee : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "seritex-coupe", title: "Seritex — coupe et tracés", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        })
      );
    }
    case "ping":
      return Response.json(reponse(msg.id, {}));
    case "tools/list":
      return Response.json(reponse(msg.id, { tools: catalogueOutils() }));
    case "tools/call": {
      const nom = String(msg.params?.name ?? "");
      const r = await appelerOutil(agent, nom, msg.params?.arguments ?? {});
      if (r.ok) {
        const objet = r.resultat && typeof r.resultat === "object" && !Array.isArray(r.resultat) ? (r.resultat as Record<string, unknown>) : { resultat: r.resultat };
        return Response.json(reponse(msg.id, { content: [{ type: "text", text: JSON.stringify(r.resultat, null, 1) }], structuredContent: objet, isError: false }));
      }
      return Response.json(reponse(msg.id, { content: [{ type: "text", text: r.message }], isError: true }));
    }
    default:
      return Response.json(erreur(msg.id, -32601, `Méthode non prise en charge : ${msg.method ?? "(aucune)"}.`));
  }
}

/** Pas de flux serveur → client (mode sans état). */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
