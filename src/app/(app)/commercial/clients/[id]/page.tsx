import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyForm } from "./company-form";
import { ContactForm } from "./contact-form";
import { ContactActions } from "./contact-actions";
import type { Company, Contact } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { FolderOpen, Mail, Phone, Star, User } from "lucide-react";

/**
 * Fiche client CRM (addendum v4 de l'analyse fonctionnelle) : l'entreprise
 * porte la relation commerciale, chacun de ses contacts est une personne
 * nommée — c'est CETTE fiche contact, pas seulement l'entreprise, qu'un
 * compte utilisateur de rôle client représente désormais (`app_users.contact_id`).
 */
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["commercial", "administrateur", "responsable_production"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: company }, { data: contacts }, { data: linkedAccounts }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).single(),
    supabase.from("contacts").select("*").eq("company_id", id).order("is_primary_contact", { ascending: false }),
    supabase.from("app_users").select("id,full_name,email,active,contact_id").eq("company_id", id).eq("role", "client"),
  ]);

  if (!company) notFound();

  const accountByContact = new Map((linkedAccounts ?? []).map((a) => [a.contact_id, a]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description="Fiche client CRM — entreprise, contacts, comptes portail liés."
        action={
          <div className="flex gap-3 text-xs">
            <Link href={`/mediatheque/${id}`} className="flex items-center gap-1 font-medium text-brand hover:underline">
              <FolderOpen className="h-3.5 w-3.5" /> Médiathèque
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader
          title="Entreprise"
          description={company.siret ? `SIRET ${company.siret}` : undefined}
          action={<CompanyForm company={company as Company} />}
        />
        <CardBody className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <p className="flex items-center gap-2 text-foreground-muted">
            <Phone className="h-4 w-4" /> {company.phone ?? "—"}
          </p>
          <p className="flex items-center gap-2 text-foreground-muted">
            <Mail className="h-4 w-4" /> {company.email ?? "—"}
          </p>
          <p className="text-foreground-muted sm:col-span-2">{company.address ?? "Adresse non renseignée"}</p>
          {company.notes && (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-foreground-muted sm:col-span-2">
              {company.notes}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contacts"
          description="Chaque contact peut être lié à un compte utilisateur du portail client."
          action={<ContactForm companyId={id} />}
        />
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {(contacts ?? []).map((contact) => {
              const account = accountByContact.get(contact.id);
              return (
                <li key={contact.id} className="space-y-1 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-foreground-muted" />
                      <span className="text-sm font-medium text-foreground">
                        {contact.first_name} {contact.last_name}
                      </span>
                      {contact.is_primary_contact && (
                        <Badge tone="brand">
                          <Star className="h-3 w-3" /> Principal
                        </Badge>
                      )}
                      {contact.role_title && <span className="text-xs text-foreground-muted">· {contact.role_title}</span>}
                      <Badge tone={contact.status === "actif" ? "success" : "neutral"}>{contact.status}</Badge>
                    </div>
                    <ContactForm companyId={id} contact={contact as Contact} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-xs text-foreground-muted">
                    {contact.email && <span>{contact.email}</span>}
                    {contact.phone && <span>Fixe : {contact.phone}</span>}
                    {contact.mobile_phone && <span>Mobile : {contact.mobile_phone}</span>}
                    {contact.department && <span>Service : {contact.department}</span>}
                  </div>
                  {contact.notes && <p className="pl-6 text-xs text-foreground-muted">{contact.notes}</p>}
                  <div className="flex items-center justify-between pl-6">
                    <p className="text-xs text-foreground-muted">
                      {account
                        ? `Compte portail lié : ${account.email} (${account.active ? "actif" : "désactivé"})`
                        : "Aucun compte portail lié pour le moment."}
                    </p>
                    <ContactActions
                      contactId={contact.id}
                      companyId={id}
                      isPrimary={contact.is_primary_contact}
                      status={contact.status}
                    />
                  </div>
                </li>
              );
            })}
            {(!contacts || contacts.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucun contact pour ce client.</li>
            )}
          </ul>
        </CardBody>
      </Card>

      <p className="text-xs text-foreground-muted">Client depuis le {formatDate(company.created_at)}</p>
    </div>
  );
}
