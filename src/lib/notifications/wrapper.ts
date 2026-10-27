import "server-only";
import type { NotificationStyleSettings } from "@/lib/types/domain";

/**
 * Habillage des e-mails, au style du site www.seritex.ci (« Atelier Signal ») :
 * toile écrue, indigo/orange/rouge du logo, bordures franches, couture en
 * pointillés. Mise en page par tableaux et styles en ligne — seule base fiable
 * sur tous les clients mail (Outlook et Gmail ignorent les feuilles de style
 * et les polices web).
 *
 * Les modèles stockés en base (Paramètres > Notifications) restent du HTML
 * simple : `styliserCorps` leur applique le style de marque.
 *   <p>, <h2>, <ul>/<li>, <blockquote>     → typographie
 *   <a class="bouton" href="…">            → bouton d'action
 *   <table class="recap"><tr><th/><td/></tr> → récapitulatif (libellé / valeur)
 *   <p class="note">                       → mention discrète
 */

const INK = "#15163a";
const INDIGO = "#2a2d7c";
const ORANGE = "#f28c1b";
const ECRU = "#f6f1e6";
const PAPER = "#fffdf8";
const MUTED = "#4c4d6b";

const POLICE_TITRE = "'Trebuchet MS','Segoe UI',Arial,Helvetica,sans-serif";
const POLICE_TEXTE = "'Segoe UI',Arial,Helvetica,sans-serif";
const POLICE_MONO = "'Courier New',Courier,monospace";

/** Logo officiel du site (fond transparent, d'où l'en-tête clair). */
const LOGO_PAR_DEFAUT = "https://www.seritex.ci/images/brand/logo-seritex.png";

const COORDONNEES = {
  adresse: "Zone industrielle de Koumassi, 18 BP 43, Abidjan — Côte d'Ivoire",
  email: "info@seritex.ci",
  site: "www.seritex.ci",
};

const STYLES_BALISES: Record<string, string> = {
  p: `margin:0 0 16px;`,
  h1: `margin:0 0 16px;font-family:${POLICE_TITRE};font-size:26px;line-height:1.25;font-weight:800;color:${INDIGO};`,
  h2: `margin:28px 0 10px;font-family:${POLICE_TITRE};font-size:18px;line-height:1.3;font-weight:800;color:${INDIGO};`,
  ul: `margin:0 0 16px;padding:0 0 0 22px;`,
  ol: `margin:0 0 16px;padding:0 0 0 22px;`,
  li: `margin:0 0 8px;`,
  blockquote: `margin:0 0 16px;padding:10px 16px;border-left:4px solid ${ORANGE};background-color:${ECRU};color:${INK};white-space:pre-line;`,
  hr: `border:0;border-top:2px dotted ${INK};margin:24px 0;`,
  table: `width:100%;border-collapse:collapse;margin:0 0 20px;`,
  th: `width:38%;padding:10px 14px;border:1px solid ${INK};background-color:${ECRU};font-family:${POLICE_MONO};font-size:12px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;text-align:left;vertical-align:top;color:${MUTED};`,
  td: `padding:10px 14px;border:1px solid ${INK};background-color:${PAPER};vertical-align:top;`,
};

const STYLES_CLASSES: Record<string, string> = {
  "a.bouton": `display:inline-block;padding:14px 26px;background-color:${INDIGO};border:2px solid ${INK};color:#ffffff;font-family:${POLICE_TITRE};font-size:15px;font-weight:bold;text-decoration:none;`,
  "p.note": `margin:0 0 16px;font-size:13px;line-height:1.5;color:${MUTED};`,
  "p.bouton": `margin:24px 0;`,
};

const BALISES = Object.keys(STYLES_BALISES).join("|");
const RE_OUVRANTE = new RegExp(`<(${BALISES}|a|p)(\\s[^>]*)?>`, "gi");

/** Ajoute le style de marque aux balises du corps, sans toucher à celles qui portent déjà un `style`. */
export function styliserCorps(html: string): string {
  return html.replace(RE_OUVRANTE, (match, nom: string, attrs: string | undefined) => {
    const balise = nom.toLowerCase();
    const a = attrs ?? "";
    if (/\sstyle\s*=/i.test(a)) return match;
    const classe = /\sclass\s*=\s*["']([^"']*)["']/i.exec(a)?.[1]?.split(/\s+/) ?? [];
    let style = classe.map((c) => STYLES_CLASSES[`${balise}.${c}`]).find(Boolean) ?? (balise === "a" ? "" : STYLES_BALISES[balise] ?? "");
    if (balise === "a" && !style) style = `color:${INDIGO};font-weight:bold;`;
    if (!style) return match;
    return `<${balise}${a} style="${style}">`;
  });
}

type StyleMarque = Pick<NotificationStyleSettings, "sender_name" | "brand_color" | "logo_url" | "footer_text">;

export function wrapHtml(bodyHtml: string, style: StyleMarque, opts: { preheader?: string } = {}): string {
  const { sender_name: senderName, logo_url: logoUrl, footer_text: footerText } = style;
  const logo = logoUrl || LOGO_PAR_DEFAUT;

  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${senderName}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${ECRU};font-family:${POLICE_TEXTE};color:${INK};">
    ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${ECRU};">${opts.preheader}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${ECRU};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:${PAPER};border:2px solid ${INK};">
            <tr>
              <td style="padding:22px 28px 18px;background-color:${PAPER};">
                <img src="${logo}" alt="${senderName}" height="44" style="display:block;height:44px;width:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="height:6px;line-height:6px;font-size:0;background-color:${INDIGO};border-bottom:3px solid ${ORANGE};">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 28px 8px;font-size:15px;line-height:1.65;color:${INK};">
                ${styliserCorps(bodyHtml)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px;"><div style="border-top:2px dotted ${INK};font-size:0;line-height:0;">&nbsp;</div></td>
            </tr>
            <tr>
              <td style="padding:20px 28px 26px;font-size:13px;line-height:1.6;color:${MUTED};">
                <strong style="color:${INDIGO};font-family:${POLICE_TITRE};">${senderName}</strong> — ${COORDONNEES.adresse}<br />
                <a href="mailto:${COORDONNEES.email}" style="color:${INDIGO};">${COORDONNEES.email}</a> · <a href="https://${COORDONNEES.site}" style="color:${INDIGO};">${COORDONNEES.site}</a>
                ${footerText ? `<br /><br />${footerText}` : ""}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:${MUTED};">Ce message a été envoyé automatiquement par la plateforme ${senderName}. Merci de ne pas y répondre directement ; pour toute question, écrivez à ${COORDONNEES.email}.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
