import { authentifierAgent } from "@/lib/agents/jetons";
import { appelerOutil, catalogueOutils } from "@/lib/agents/outils-imbrication";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Outils des agents IA, en JSON simple (n8n, scripts…). Pour Claude et les
 * clients MCP, voir /api/agents/mcp (mêmes outils).
 *
 *   GET  → catalogue des outils (nom, description, schéma des arguments)
 *   POST { "outil": "planifier_coupe", "arguments": { … } } → résultat
 *
 * Authentification : `Authorization: Bearer stx_agent_…` (Paramètres → Agents IA).
 */
const refus = () => Response.json({ ok: false, message: "Jeton d'agent absent, inconnu ou révoqué." }, { status: 401 });

export async function GET(req: Request) {
  const agent = await authentifierAgent(req);
  if (!agent) return refus();
  return Response.json({ agent: { nom: agent.nom, droits: agent.droits }, outils: catalogueOutils() });
}

export async function POST(req: Request) {
  const agent = await authentifierAgent(req);
  if (!agent) return refus();
  let corps: { outil?: unknown; arguments?: unknown };
  try {
    corps = await req.json();
  } catch {
    return Response.json({ ok: false, message: "Corps JSON attendu : { \"outil\": …, \"arguments\": { … } }." }, { status: 400 });
  }
  if (typeof corps.outil !== "string") return Response.json({ ok: false, message: "Champ « outil » manquant." }, { status: 400 });
  const r = await appelerOutil(agent, corps.outil, corps.arguments ?? {});
  if (r.ok) return Response.json({ ok: true, resultat: r.resultat });
  return Response.json({ ok: false, message: r.message }, { status: r.refuse ? 403 : 422 });
}
