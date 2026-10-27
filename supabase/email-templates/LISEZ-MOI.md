# Modèles d'e-mail de Supabase Auth (comptes du site)

Les e-mails de confirmation d'inscription et de mot de passe oublié du **site** sont envoyés par Supabase, pas par la plateforme : ils se règlent à la main dans Supabase > Authentication > Email Templates.

| Fichier | Modèle Supabase | Objet suggéré |
|---|---|---|
| `confirmation-inscription.html` | Confirm signup | Confirmez votre adresse e-mail — Seritex |
| `mot-de-passe-oublie.html` | Reset Password | Réinitialisation de votre mot de passe Seritex |

Coller le contenu du fichier dans le champ « Message body ». Les variables `{{ .ConfirmationURL }}`, `{{ .RedirectTo }}` et `{{ .TokenHash }}` sont celles de Supabase : ne pas les modifier. Le lien de réinitialisation est celui déjà documenté pour le site (`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`).
