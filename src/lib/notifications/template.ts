import "server-only";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Substitution `{{cle}}` minimaliste — pas de moteur de gabarit, juste un
 * remplacement regex avec échappement HTML des valeurs (les variables
 * contiennent parfois du texte libre client, ex. description). Un jeton
 * inconnu du payload est remplacé par une chaîne vide plutôt que laissé
 * littéral dans l'email envoyé.
 */
export function renderTemplate(template: string, variables: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === null || value === undefined) return "";
    return escapeHtml(String(value));
  });
}
