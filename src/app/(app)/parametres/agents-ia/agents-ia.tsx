"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, Copy, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { creerAgent, revoquerAgent } from "./actions";

export interface AgentLigne {
  id: string;
  nom: string;
  description: string | null;
  prefixe_jeton: string;
  droits: ("lecture" | "calcul")[];
  actif: boolean;
  created_at: string;
  derniere_utilisation_le: string | null;
  revoque_le: string | null;
  proprietaire: string;
}

const champ = "h-9 w-full rounded-md border border-border bg-surface px-2 text-base sm:text-sm";
const DROITS = { lecture: "Lecture (besoins, plans, tracés)", calcul: "Calcul (lancer et arrêter des calculs)" } as const;

export function AgentsIa({ agents, utilisateurs }: { agents: AgentLigne[]; utilisateurs: { id: string; nom: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [nom, setNom] = useState("");
  const [description, setDescription] = useState("");
  const [droits, setDroits] = useState<("lecture" | "calcul")[]>(["lecture"]);
  const [proprietaire, setProprietaire] = useState("");
  const [jeton, setJeton] = useState<string | null>(null);

  function creer(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await creerAgent({ nom, description, droits, proprietaire });
      if ("error" in r) toast.error("Agent non créé", { description: r.error });
      else {
        setJeton(r.jeton);
        setNom("");
        setDescription("");
      }
    });
  }

  function revoquer(a: AgentLigne) {
    if (!confirm(`Révoquer l'agent « ${a.nom} » ? Son jeton cessera immédiatement de fonctionner, définitivement.`)) return;
    startTransition(async () => {
      const r = await revoquerAgent(a.id);
      if (r.error) toast.error("Révocation impossible", { description: r.error });
      else toast.success("Agent révoqué");
    });
  }

  return (
    <div className="space-y-6">
      {jeton && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-4 text-sm text-foreground">
          <p className="flex items-center gap-2 font-medium">
            <KeyRound className="h-4 w-4" /> Jeton de l&apos;agent — copiez-le maintenant, il ne sera plus jamais affiché.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface px-2 py-1 text-xs">{jeton}</code>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(jeton);
                toast.success("Jeton copié");
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copier
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setJeton(null)}>
              J&apos;ai copié le jeton
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Nouvel agent" />
        <CardBody>
          <form onSubmit={creer} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Nom</span>
              <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="ex. Claude — plans de coupe" className={champ} required />
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Agit au nom de (ses droits limitent ceux de l&apos;agent)</span>
              <select value={proprietaire} onChange={(e) => setProprietaire(e.target.value)} className={champ} required>
                <option value="">Choisir un utilisateur…</option>
                {utilisateurs.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-foreground-muted sm:col-span-2">
              <span className="block">Description (facultatif)</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={champ} />
            </label>
            <fieldset className="space-y-1 text-xs text-foreground-muted sm:col-span-2">
              <legend className="mb-1">Droits</legend>
              {(Object.keys(DROITS) as (keyof typeof DROITS)[]).map((d) => (
                <label key={d} className="mr-4 inline-flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={droits.includes(d)}
                    onChange={(e) => setDroits((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)))}
                  />
                  {DROITS[d]}
                </label>
              ))}
            </fieldset>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" loading={pending}>
                <Bot className="h-3.5 w-3.5" /> Créer l&apos;agent et son jeton
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Agents" />
        <CardBody className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Agent</Th>
                <Th>Au nom de</Th>
                <Th>Droits</Th>
                <Th>Jeton</Th>
                <Th>Dernière utilisation</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {agents.length === 0 && <EmptyRow colSpan={6}>Aucun agent.</EmptyRow>}
              {agents.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <span className="font-medium text-foreground">{a.nom}</span>
                    {a.description && <span className="block text-xs text-foreground-muted">{a.description}</span>}
                  </Td>
                  <Td>{a.proprietaire}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {a.droits.map((d) => (
                        <Badge key={d} tone={d === "calcul" ? "brand" : "neutral"}>
                          {d}
                        </Badge>
                      ))}
                    </span>
                  </Td>
                  <Td>
                    <code className="text-xs">{a.prefixe_jeton}…</code>
                    {!a.actif && (
                      <Badge tone="danger" className="ml-2">
                        Révoqué {a.revoque_le ? `le ${formatDateTime(a.revoque_le)}` : ""}
                      </Badge>
                    )}
                  </Td>
                  <Td>{a.derniere_utilisation_le ? formatDateTime(a.derniere_utilisation_le) : "jamais"}</Td>
                  <Td align="right">
                    {a.actif && (
                      <Button size="sm" variant="ghost" type="button" onClick={() => revoquer(a)} disabled={pending}>
                        Révoquer
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
