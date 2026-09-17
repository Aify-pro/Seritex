import "server-only";
import { Resend } from "resend";

/**
 * `null` si RESEND_API_KEY est absent (dev local / CI sans clé) —
 * sendNotification() bascule alors en mode simulation (journalisé,
 * status='simule') plutôt que d'échouer. C'est l'état par défaut hors
 * production tant que la clé n'est pas posée dans Vercel.
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}
