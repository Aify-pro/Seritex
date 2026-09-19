import { Badge } from "@/components/ui/badge";

/** Un compte actif qui ne s'est jamais connecté attend encore que l'utilisateur choisisse son mot de passe. */
export function accountState(active: boolean, lastSignInAt: string | null): "actif" | "invitation" | "desactive" {
  if (!active) return "desactive";
  return lastSignInAt ? "actif" : "invitation";
}

export function AccountStatusBadge({ state }: { state: "actif" | "invitation" | "desactive" }) {
  if (state === "desactive") return <Badge tone="danger" dot>Désactivé</Badge>;
  if (state === "invitation") return <Badge tone="warning" dot>Invitation en attente</Badge>;
  return <Badge tone="success" dot>Actif</Badge>;
}
