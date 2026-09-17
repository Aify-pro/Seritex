import "server-only";
import type { NotificationStyleSettings } from "@/lib/types/domain";

/**
 * Enveloppe HTML de marque — bandeau `sender_name`/`logo_url` sur fond
 * `brand_color`, corps (déjà rendu par renderTemplate), pied de page
 * `footer_text`. Mise en page par tableaux HTML plutôt que CSS externe,
 * pour la compatibilité des clients mail (Outlook en particulier).
 */
export function wrapHtml(bodyHtml: string, style: Pick<NotificationStyleSettings, "sender_name" | "brand_color" | "logo_url" | "footer_text">): string {
  const { sender_name: senderName, brand_color: brandColor, logo_url: logoUrl, footer_text: footerText } = style;

  return `<!DOCTYPE html>
<html lang="fr">
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:${brandColor};padding:20px 24px;">
                ${logoUrl ? `<img src="${logoUrl}" alt="${senderName}" height="32" style="display:block;" />` : `<span style="color:#ffffff;font-size:18px;font-weight:bold;">${senderName}</span>`}
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#111827;font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            ${
              footerText
                ? `<tr>
              <td style="padding:16px 24px;background-color:#f9fafb;color:#6b7280;font-size:12px;">
                ${footerText}
              </td>
            </tr>`
                : ""
            }
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
