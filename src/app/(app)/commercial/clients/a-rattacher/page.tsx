import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { RattacherForm } from "./rattacher-form";

interface CompteSite {
  id: string;
  email: string;
  full_name: string;
  telephone: string | null;
  entreprise_declaree: string | null;
  created_at: string;
}

/**
 * Comptes créés par des visiteurs sur www.seritex.ci (migration 0125) : tant
 * qu'ils ne sont pas rattachés à un client, ils ne voient rien du portail.
 */
export default async function ComptesARattacherPage() {
  await requireModule("clients");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("site_accounts_a_rattacher");
  const comptes = (data ?? []) as CompteSite[];

  return (
    <div className="space-y-6">
      <Link href="/commercial/clients" className="inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Clients
      </Link>
      <PageHeader
        title="Comptes à rattacher"
        description="Comptes créés depuis le site. Une société vient de Sage (le compte devient un contact de cette société) ; un particulier reçoit une fiche créée ici."
      />

      {error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les comptes ({error.message}). Si la migration <code>0125</code> n&apos;est pas encore appliquée, appliquez-la puis rechargez.
        </div>
      )}

      {!error && comptes.length === 0 && (
        <Card>
          <CardBody className="text-sm text-foreground-muted">Aucun compte en attente de rattachement.</CardBody>
        </Card>
      )}

      {comptes.map((c) => (
        <Card key={c.id}>
          <CardBody className="space-y-4">
            <div>
              <p className="font-medium text-foreground">{c.full_name}</p>
              <p className="text-sm text-foreground-muted">
                {[c.email, c.telephone, c.entreprise_declaree ? `Société indiquée : ${c.entreprise_declaree}` : null].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs text-foreground-muted">Inscrit le {formatDateTime(c.created_at)}</p>
            </div>
            <RattacherForm userId={c.id} nom={c.full_name} suggestion={c.entreprise_declaree ?? c.full_name} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
