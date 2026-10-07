import { notFound } from "next/navigation";
import Link from "next/link";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyForm } from "./company-form";
import { ContactForm } from "./contact-form";
import { ContactActions } from "./contact-actions";
import type { Company, Contact } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { DeliveryPlaces, type PlaceWithPhoto } from "./delivery-places";
import { FolderOpen, Globe, Lock, Mail, MapPin, Phone, Star, User } from "lucide-react";

/**
 * Fiche client CRM (addendum v4 de l'analyse fonctionnelle) : l'entreprise
 * porte la relation commerciale, chacun de ses contacts est une personne
 * nommée — c'est CETTE fiche contact, pas seulement l'entreprise, qu'un
 * compte utilisateur de rôle client représente désormais (`app_users.contact_id`).
 */
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireModule("clients");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: company }, { data: sage }, { data: contacts }, { data: linkedAccounts }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).single(),
    // Vue de liste : libellés Sage normalisés, commercial, statut (migration 0060).
    supabase
      .from("companies_list")
      .select("famille,zone,typologie,categorie,representant_name,statut,is_prospect")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("contacts").select("*").eq("company_id", id).order("is_primary_contact", { ascending: false }),
    supabase.from("app_users").select("id,full_name,email,active,contact_id").eq("company_id", id).eq("role", "client"),
  ]);

  if (!company) notFound();

  // Lieux de livraison (LIV-0) : gérés dans Seritex, indépendants de Sage.
  const [{ data: placeRows }, { data: zones }] = await Promise.all([
    supabase.from("delivery_places").select("*").eq("company_id", id).order("par_defaut", { ascending: false }).order("libelle"),
    supabase.from("delivery_zones").select("id,nom").eq("actif", true).order("ordre"),
  ]);
  const photoPaths = (placeRows ?? []).map((p) => p.photo_path as string | null).filter((v): v is string => !!v);
  const signed =
    photoPaths.length > 0
      ? (await createAdminClient().storage.from("livraisons").createSignedUrls(photoPaths, 3600)).data ?? []
      : [];
  const places: PlaceWithPhoto[] = (placeRows ?? []).map((p) => ({
    ...(p as PlaceWithPhoto),
    photoUrl: signed.find((s) => s.path === p.photo_path)?.signedUrl ?? null,
  }));
  const canEditPlaces =
    ["commercial", "administrateur", "responsable_livraison"].includes(profile.role) && (await can("livraisons", "modify"));

  const fromSage = company.origin === "sage";
  const fullAddress = [company.address, [company.postal_code, company.city].filter(Boolean).join(" "), company.country]
    .filter(Boolean)
    .join(", ");
  const sageRows: [string, string | null | undefined][] = [
    ["Code Sage", company.sage_code],
    ["Famille", sage?.famille],
    ["Zone / commune", sage?.zone],
    ["Typologie", sage?.typologie],
    ["Catégorie", sage?.categorie],
    ["Commercial", sage?.representant_name],
    ["N° TVA", company.vat_number],
    ["Code APE", company.ape_code],
  ];

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
          {fromSage && (
            <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info sm:col-span-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Identité et coordonnées importées de Sage — lecture seule dans Seritex. Les contacts et les notes se gèrent ici.
            </p>
          )}
          {fromSage && (
            <div className="flex flex-wrap gap-1.5 sm:col-span-2">
              {sage?.is_prospect && <Badge tone="accent">Prospect</Badge>}
              {sage?.statut === "sommeil" && <Badge tone="warning">En sommeil dans Sage</Badge>}
              {sage?.statut === "archive" && <Badge tone="danger">Disparu de Sage</Badge>}
              {sage?.statut === "actif" && !sage.is_prospect && <Badge tone="success">Actif</Badge>}
            </div>
          )}
          <p className="flex items-center gap-2 text-foreground-muted">
            <Phone className="h-4 w-4" /> {company.phone ?? "—"}
          </p>
          <p className="flex items-center gap-2 text-foreground-muted">
            <Mail className="h-4 w-4" /> {company.email ?? "—"}
          </p>
          {company.website && (
            <p className="flex items-center gap-2 text-foreground-muted sm:col-span-2">
              <Globe className="h-4 w-4" /> {company.website}
            </p>
          )}
          <p className="flex items-start gap-2 text-foreground-muted sm:col-span-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {fullAddress || "Adresse non renseignée"}
          </p>
          {(company.ncc || company.rccm) && (
            <p className="text-xs text-foreground-muted sm:col-span-2">
              {[company.ncc && `NCC ${company.ncc}`, company.rccm && `RCCM ${company.rccm}`].filter(Boolean).join(" · ")}
            </p>
          )}
          {fromSage && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs sm:col-span-2 sm:grid-cols-4">
              {sageRows
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-foreground-muted">{label}</dt>
                    <dd className="font-medium text-foreground">{value}</dd>
                  </div>
                ))}
            </dl>
          )}
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

      <Card id="lieux">
        <CardHeader
          title="Lieux de livraison"
          description="Où livrer ce client : repères, contact sur place, horaires, position GPS. Un seul lieu par défaut."
        />
        <CardBody>
          <DeliveryPlaces companyId={id} places={places} zones={zones ?? []} editable={canEditPlaces} />
        </CardBody>
      </Card>

      <p className="text-xs text-foreground-muted">Client depuis le {formatDate(company.created_at)}</p>
    </div>
  );
}
