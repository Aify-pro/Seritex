import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight } from "lucide-react";

/**
 * Index CRM des clients (section 2 de l'analyse) : chaque entreprise est une
 * vraie fiche client, avec ses contacts nommés — un compte utilisateur de
 * rôle client représente désormais l'un de ces contacts, pas seulement une
 * entreprise (voir 0005_rbac_crm_parametres_sage.sql, `app_users.contact_id`).
 */
export default async function ClientsPage() {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const supabase = await createClient();

  const [{ data: companies }, { data: contacts }] = await Promise.all([
    supabase.from("companies").select("id,name,siret,phone,email").order("name"),
    supabase.from("contacts").select("id,company_id,first_name,last_name,is_primary_contact,status"),
  ]);

  const contactsByCompany = new Map<string, typeof contacts>();
  for (const c of contacts ?? []) {
    const list = contactsByCompany.get(c.company_id) ?? [];
    list.push(c);
    contactsByCompany.set(c.company_id, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" description="Fiches client CRM — entreprise, contacts nommés, historique." />
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {companies?.map((company) => {
              const companyContacts = contactsByCompany.get(company.id) ?? [];
              const primary = companyContacts.find((c) => c?.is_primary_contact);
              const activeCount = companyContacts.filter((c) => c?.status === "actif").length;
              return (
                <li key={company.id}>
                  <Link
                    href={`/commercial/clients/${company.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Building2 className="h-4 w-4 text-foreground-muted" /> {company.name}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-foreground-muted">
                      {primary && <Badge tone="brand">{primary.first_name} {primary.last_name}</Badge>}
                      <span>
                        {activeCount} contact{activeCount > 1 ? "s" : ""} actif{activeCount > 1 ? "s" : ""}
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </Link>
                </li>
              );
            })}
            {(!companies || companies.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucun client pour le moment.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
