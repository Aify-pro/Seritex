"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isEmailDeliveryConfigured,
  sendAccountUpdatedEmail,
  sendPasswordLinkEmail,
} from "@/lib/notifications/account";

/**
 * Gestion des comptes — réservée à l'administrateur de plateforme
 * (l'informatique), pas à un rôle qui hérite seulement de son cloisonnement
 * de données. `requirePlatformAdmin` s'exécute AVANT tout usage du client
 * admin (service_role) : on ne construit jamais ce client privilégié pour un
 * appelant non vérifié.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Result = { error?: string };

const uuidOrEmpty = z.string().uuid().or(z.literal("")).nullish();

const accountFields = {
  full_name: z.string().trim().min(1, "Le nom est requis").max(100),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  role_id: z.string().uuid("Rôle requis"),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\-\s]*$/, "Numéro de téléphone invalide")
    .nullish(),
  job_title: z.string().trim().max(100).nullish(),
  // `nullish()` et non `optional()` : un champ non affiché n'est pas dans le
  // FormData et `formData.get()` renvoie alors `null`, que `optional()` refuse.
  company_id: uuidOrEmpty,
  section_id: uuidOrEmpty,
  contact_id: uuidOrEmpty,
};

const newUserSchema = z.object({ ...accountFields, send_invitation: z.boolean() });
const editUserSchema = z.object(accountFields);

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "Saisie"} : ${issue.message}` : "Saisie invalide";
}

type RoleRow = { id: string; key: string; label: string; base_role: string; active: boolean };

async function loadRole(admin: Admin, roleId: string): Promise<RoleRow | null> {
  const { data } = await admin.from("roles").select("id,key,label,base_role,active").eq("id", roleId).maybeSingle();
  return data;
}

/**
 * Règles de rattachement selon le rôle de base (mêmes contraintes que la base,
 * dites ici en clair) — et le contact CRM doit appartenir à l'entreprise choisie.
 */
async function checkAttachment(
  admin: Admin,
  role: RoleRow,
  a: { company_id?: string | null; section_id?: string | null; contact_id?: string | null }
): Promise<string | null> {
  if (role.base_role === "client") {
    if (!a.company_id) return "Une entreprise est requise pour un compte client.";
    // Un compte client représente une vraie fiche contact CRM (addendum v4).
    if (!a.contact_id) return "Un contact (fiche CRM) est requis pour un compte client — créez-le d'abord depuis Clients.";
    const { data: contact } = await admin.from("contacts").select("company_id").eq("id", a.contact_id).maybeSingle();
    if (!contact || contact.company_id !== a.company_id) return "Ce contact n'appartient pas à l'entreprise choisie.";
  }
  if (role.base_role === "chef_section" && !a.section_id) return "Une section est requise pour un chef de section.";
  return null;
}

/** Colonnes de rattachement à écrire : seulement celles qui concernent le rôle de base. */
function attachmentColumns(
  role: RoleRow,
  a: { company_id?: string | null; section_id?: string | null; contact_id?: string | null }
) {
  return {
    ...(role.base_role === "client" ? { company_id: a.company_id || null, contact_id: a.contact_id || null } : {}),
    ...(role.base_role === "chef_section" ? { section_id: a.section_id || null } : {}),
  };
}

/** Vrai si retirer les droits / l'accès de ce compte laisserait la plateforme sans administrateur actif. */
async function isLastActivePlatformAdmin(admin: Admin, user: { role_id: string; active: boolean }): Promise<boolean> {
  if (!user.active) return false;
  const role = await loadRole(admin, user.role_id);
  if (role?.key !== "administrateur") return false;
  const { count } = await admin
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("role_id", user.role_id)
    .eq("active", true);
  return (count ?? 0) <= 1;
}

const LAST_ADMIN_ERROR =
  "C'est le dernier administrateur actif : attribuez d'abord ce rôle à un autre compte, sinon plus personne ne pourra accéder aux réglages.";

// ============================================================================
// Création
// ============================================================================

export type CreateUserResult = Result & {
  email?: string;
  /** L'invitation a réellement été remise à Resend. */
  invited?: boolean;
  /** Fourni seulement si aucune invitation n'a pu partir : à transmettre par un canal sûr. */
  tempPassword?: string;
};

/**
 * Crée le compte avec un mot de passe aléatoire que personne ne connaît, puis
 * envoie une invitation : l'utilisateur choisit LUI-MÊME son mot de passe via
 * un lien à usage unique. Si l'e-mail ne peut pas partir (Resend non branché,
 * invitation décochée, échec d'envoi), on renvoie le mot de passe provisoire
 * pour transmission manuelle — le compte reste alors marqué « doit changer son
 * mot de passe », ce qui l'y contraint dès la première connexion.
 */
export async function createUserAccount(formData: FormData): Promise<CreateUserResult> {
  await requirePlatformAdmin();

  const parsed = newUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role_id: formData.get("role_id"),
    phone: formData.get("phone"),
    job_title: formData.get("job_title"),
    company_id: formData.get("company_id"),
    section_id: formData.get("section_id"),
    contact_id: formData.get("contact_id"),
    send_invitation: formData.get("send_invitation") === "on",
  });
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  const input = parsed.data;

  const admin = createAdminClient();
  const role = await loadRole(admin, input.role_id);
  if (!role) return { error: "Rôle introuvable." };
  if (!role.active) return { error: `Le rôle « ${role.label} » est désactivé.` };
  const attachmentError = await checkAttachment(admin, role, input);
  if (attachmentError) return { error: attachmentError };

  const tempPassword = `${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}Aa1!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (createError) {
    return { error: createError.code === "email_exists" ? "Un compte existe déjà avec cette adresse e-mail." : createError.message };
  }

  const { error: profileError } = await admin.from("app_users").insert({
    id: created.user.id,
    email: input.email,
    full_name: input.full_name,
    role: role.base_role,
    role_id: role.id,
    phone: input.phone || null,
    job_title: input.job_title || null,
    must_change_password: true,
    ...attachmentColumns(role, input),
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  let invited = false;
  if (input.send_invitation && isEmailDeliveryConfigured()) {
    invited = (await sendPasswordLinkEmail("invitation", { email: input.email, full_name: input.full_name }, { roleLabel: role.label })).sent;
  }

  revalidatePath("/parametres/utilisateurs");
  return { email: input.email, invited, ...(invited ? {} : { tempPassword }) };
}

// ============================================================================
// Modification de la fiche
// ============================================================================

/**
 * Enregistre la fiche entière (identité, rôle, rattachement) en UNE écriture :
 * le trigger de synchronisation du rôle s'exécute avant la vérification des
 * contraintes de la base, donc « devient client + entreprise » passe d'un coup.
 * Change l'adresse e-mail des deux côtés (Auth et profil) et prévient
 * l'utilisateur de ce qui a changé.
 */
export async function updateUserAccount(userId: string, formData: FormData): Promise<Result> {
  const { authId } = await requirePlatformAdmin();

  const parsed = editUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role_id: formData.get("role_id"),
    phone: formData.get("phone"),
    job_title: formData.get("job_title"),
    company_id: formData.get("company_id"),
    section_id: formData.get("section_id"),
    contact_id: formData.get("contact_id"),
  });
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: before } = await admin.from("app_users").select("*").eq("id", userId).maybeSingle();
  if (!before) return { error: "Compte introuvable." };

  const [role, previousRole] = await Promise.all([loadRole(admin, input.role_id), loadRole(admin, before.role_id)]);
  if (!role) return { error: "Rôle introuvable." };
  const roleChanged = role.id !== before.role_id;
  if (roleChanged && !role.active) return { error: `Le rôle « ${role.label} » est désactivé.` };

  // Champ absent du formulaire (null) = inchangé ; champ vidé ("") = à effacer.
  const next = {
    company_id: input.company_id ?? before.company_id,
    section_id: input.section_id ?? before.section_id,
    contact_id: input.contact_id ?? before.contact_id,
  };
  const attachmentError = await checkAttachment(admin, role, next);
  if (attachmentError) return { error: attachmentError };

  if (roleChanged && previousRole?.key === "administrateur" && role.key !== "administrateur") {
    if (userId === authId) return { error: "Vous ne pouvez pas vous retirer vous-même le rôle d'administrateur." };
    if (await isLastActivePlatformAdmin(admin, before)) return { error: LAST_ADMIN_ERROR };
  }

  const emailChanged = input.email !== before.email;
  if (emailChanged || input.full_name !== before.full_name) {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      ...(emailChanged ? { email: input.email, email_confirm: true } : {}),
      user_metadata: { full_name: input.full_name },
    });
    if (authError) {
      return { error: authError.code === "email_exists" ? "Un compte existe déjà avec cette adresse e-mail." : authError.message };
    }
  }

  const { error } = await admin
    .from("app_users")
    .update({
      full_name: input.full_name,
      email: input.email,
      phone: input.phone || null,
      job_title: input.job_title || null,
      ...(roleChanged ? { role_id: role.id } : {}),
      ...attachmentColumns(role, next),
    })
    .eq("id", userId);
  if (error) {
    // Auth a déjà bougé : on le remet en phase pour ne pas laisser deux adresses divergentes.
    if (emailChanged) await admin.auth.admin.updateUserById(userId, { email: before.email, email_confirm: true });
    return { error: error.message };
  }

  const changes: string[] = [];
  if (input.full_name !== before.full_name) changes.push(`Nom : ${before.full_name} → ${input.full_name}`);
  if (emailChanged) changes.push(`Adresse e-mail : ${before.email} → ${input.email}`);
  if (roleChanged) changes.push(`Rôle : ${previousRole?.label ?? "?"} → ${role.label}`);
  const attachmentChanged =
    (role.base_role === "client" &&
      ((next.company_id || null) !== before.company_id || (next.contact_id || null) !== before.contact_id)) ||
    (role.base_role === "chef_section" && (next.section_id || null) !== before.section_id);
  if (attachmentChanged) changes.push("Rattachement modifié");

  if (changes.length > 0) {
    const person = { email: input.email, full_name: input.full_name };
    await sendAccountUpdatedEmail(person, changes);
    // Un changement d'adresse est aussi signalé à l'ANCIENNE, seule à pouvoir alerter le titulaire légitime.
    if (emailChanged) await sendAccountUpdatedEmail({ email: before.email, full_name: before.full_name }, changes);
  }

  revalidatePath("/parametres/utilisateurs");
  revalidatePath(`/parametres/utilisateurs/${userId}`);
  revalidatePath("/parametres/roles");
  return {};
}

// ============================================================================
// Accès : activation, mot de passe
// ============================================================================

/**
 * Active/désactive un compte. `active` seul ne coupait rien : la session déjà
 * ouverte et la connexion restaient possibles. La désactivation bannit donc
 * aussi le compte côté Auth (connexion et rafraîchissement de session refusés),
 * la réactivation lève le bannissement.
 */
export async function setUserActive(userId: string, active: boolean): Promise<Result> {
  const { authId } = await requirePlatformAdmin();
  const admin = createAdminClient();

  const { data: user } = await admin.from("app_users").select("*").eq("id", userId).maybeSingle();
  if (!user) return { error: "Compte introuvable." };
  if (user.active === active) return {};

  if (!active) {
    if (userId === authId) return { error: "Vous ne pouvez pas désactiver votre propre compte." };
    if (await isLastActivePlatformAdmin(admin, user)) return { error: LAST_ADMIN_ERROR };
  }

  const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  if (banError) return { error: banError.message };

  const { error } = await admin.from("app_users").update({ active }).eq("id", userId);
  if (error) {
    await admin.auth.admin.updateUserById(userId, { ban_duration: user.active ? "none" : "876000h" });
    return { error: error.message };
  }

  await sendAccountUpdatedEmail(
    { email: user.email, full_name: user.full_name },
    [active ? "Votre compte a été réactivé : vous pouvez de nouveau vous connecter." : "Votre compte a été désactivé : vous ne pouvez plus vous connecter."]
  );

  revalidatePath("/parametres/utilisateurs");
  revalidatePath(`/parametres/utilisateurs/${userId}`);
  return {};
}

export type LinkResult = Result & { sent?: boolean };

async function sendLinkTo(userId: string, kind: "invitation" | "reinitialisation"): Promise<LinkResult> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data: user } = await admin.from("app_users").select("email,full_name,active,role_id").eq("id", userId).maybeSingle();
  if (!user) return { error: "Compte introuvable." };
  if (!user.active) return { error: "Ce compte est désactivé : réactivez-le d'abord." };
  if (!isEmailDeliveryConfigured()) {
    return { error: "L'envoi d'e-mails n'est pas branché (RESEND_API_KEY absent) : aucun message ne peut partir." };
  }

  const role = await loadRole(admin, user.role_id);
  const { sent } = await sendPasswordLinkEmail(kind, user, { roleLabel: role?.label });
  if (!sent) return { error: "L'e-mail n'a pas pu être envoyé — voir le détail dans Paramètres > Notifications (journal)." };
  revalidatePath(`/parametres/utilisateurs/${userId}`);
  return { sent: true };
}

/** Envoie à l'utilisateur un lien pour choisir un nouveau mot de passe (à sa demande orale, par ex.). */
export async function sendUserPasswordReset(userId: string): Promise<LinkResult> {
  return sendLinkTo(userId, "reinitialisation");
}

/** Renvoie l'e-mail d'invitation (lien expiré ou jamais reçu). */
export async function resendUserInvitation(userId: string): Promise<LinkResult> {
  return sendLinkTo(userId, "invitation");
}

/** Exige un nouveau mot de passe à la prochaine connexion (ou lève cette exigence). */
export async function setMustChangePassword(userId: string, value: boolean): Promise<Result> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("app_users").update({ must_change_password: value }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath(`/parametres/utilisateurs/${userId}`);
  return {};
}
