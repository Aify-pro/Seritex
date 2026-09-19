"use client";

import { useState } from "react";

export type RoleOption = { id: string; label: string; base_role: string };
export type UserFieldsDefaults = {
  full_name?: string;
  email?: string;
  phone?: string | null;
  job_title?: string | null;
  role_id?: string;
  company_id?: string | null;
  contact_id?: string | null;
  section_id?: string | null;
};

const inputClass = "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none ring-brand/30 focus:ring-2 disabled:opacity-50";

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-foreground-muted">{hint}</p>}
    </div>
  );
}

/**
 * Champs d'un compte, communs à la création et à la fiche : identité, rôle, et
 * rattachement (entreprise + contact CRM pour un client, section pour un chef
 * de section) — les champs de rattachement n'apparaissent que si le rôle de
 * base l'exige, comme les contraintes de la base.
 */
export function UserFields({
  roles,
  companies,
  sections,
  contacts,
  defaults = {},
  emailHint,
}: {
  roles: RoleOption[];
  companies: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  contacts: { id: string; company_id: string; first_name: string; last_name: string }[];
  defaults?: UserFieldsDefaults;
  emailHint?: React.ReactNode;
}) {
  const [roleId, setRoleId] = useState(defaults.role_id ?? roles.find((r) => r.base_role === "commercial")?.id ?? roles[0]?.id ?? "");
  const [companyId, setCompanyId] = useState(defaults.company_id ?? "");
  const baseRole = roles.find((r) => r.id === roleId)?.base_role;
  const contactsForCompany = contacts.filter((c) => c.company_id === companyId);

  return (
    <>
      <Field label="Nom complet" htmlFor="full_name">
        <input id="full_name" name="full_name" required defaultValue={defaults.full_name} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Adresse e-mail" htmlFor="email" hint={emailHint}>
        <input id="email" name="email" type="email" required defaultValue={defaults.email} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Téléphone" htmlFor="phone">
        <input id="phone" name="phone" type="tel" defaultValue={defaults.phone ?? ""} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Fonction" htmlFor="job_title">
        <input id="job_title" name="job_title" defaultValue={defaults.job_title ?? ""} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Rôle" htmlFor="role_id" className="sm:col-span-2">
        <select id="role_id" name="role_id" value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputClass}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {baseRole === "client" && (
        <>
          <Field label="Entreprise" htmlFor="company_id">
            <select
              id="company_id"
              name="company_id"
              required
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Contact (fiche CRM)"
            htmlFor="contact_id"
            hint={
              companyId && contactsForCompany.length === 0 ? (
                <span className="text-warning">Aucun contact pour cette entreprise — créez-le d&apos;abord depuis Clients.</span>
              ) : undefined
            }
          >
            <select
              key={companyId}
              id="contact_id"
              name="contact_id"
              required
              disabled={!companyId}
              defaultValue={companyId === (defaults.company_id ?? "") ? (defaults.contact_id ?? "") : ""}
              className={inputClass}
            >
              <option value="">—</option>
              {contactsForCompany.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {baseRole === "chef_section" && (
        <Field label="Section" htmlFor="section_id">
          <select id="section_id" name="section_id" required defaultValue={defaults.section_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
