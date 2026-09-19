import { z } from "zod";

/**
 * Règle unique de mot de passe, partagée par les formulaires (indicateur de
 * robustesse côté navigateur) ET par les actions serveur (vérification qui
 * fait foi). Aucun import serveur ici : ce module est aussi chargé côté client.
 */
export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Au moins ${PASSWORD_MIN_LENGTH} caractères`)
  .max(72, "72 caractères au maximum")
  .regex(/[a-zA-Z]/, "Au moins une lettre")
  .regex(/[0-9]/, "Au moins un chiffre");

export type PasswordCheck = { label: string; ok: boolean };

/** Critères affichés en direct sous le champ « nouveau mot de passe ». */
export function checkPassword(value: string): PasswordCheck[] {
  return [
    { label: `${PASSWORD_MIN_LENGTH} caractères minimum`, ok: value.length >= PASSWORD_MIN_LENGTH },
    { label: "Une lettre", ok: /[a-zA-Z]/.test(value) },
    { label: "Un chiffre", ok: /[0-9]/.test(value) },
  ];
}
