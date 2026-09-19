"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateUserAccount } from "../actions";
import { UserFields, type RoleOption, type UserFieldsDefaults } from "../user-fields";

export function EditUserForm({
  userId,
  defaults,
  roles,
  companies,
  sections,
  contacts,
}: {
  userId: string;
  defaults: UserFieldsDefaults;
  roles: RoleOption[];
  companies: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  contacts: { id: string; company_id: string; first_name: string; last_name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateUserAccount(userId, formData);
          if (res.error) toast.error("Modification refusée", { description: res.error });
          else {
            toast.success("Fiche enregistrée", { description: "L'utilisateur est prévenu par e-mail des changements sensibles." });
            router.refresh();
          }
        })
      }
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <UserFields
        roles={roles}
        companies={companies}
        sections={sections}
        contacts={contacts}
        defaults={defaults}
        emailHint="Modifier l'adresse change aussi l'identifiant de connexion ; l'ancienne adresse en est informée."
      />
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending}>
          Enregistrer la fiche
        </Button>
      </div>
    </form>
  );
}
