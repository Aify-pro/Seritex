# Seritex — Esquisse de plateforme (commercial + atelier)

Première esquisse complète de l'application web décrite dans
`architecture/analyse-fonctionnelle-technique.md` : CRM, portail client,
échantillonnage, ordres de fabrication et ordres de travail par section.

## Stack technique

- **Next.js 16** (App Router, React 19, TypeScript) — un seul langage
  (TypeScript) de bout en bout, front et logique serveur (Server Actions),
  pour une base de code homogène et rapide à faire évoluer.
- **Supabase** : Postgres + Auth + Realtime.
  - **Row Level Security (RLS)** sur toutes les tables : les permissions du
    RBAC (client / commercial / infographiste / responsable production / chef
    de section / administrateur) sont vérifiées **en base de données**, pas
    seulement dans l'interface. C'est le choix le plus sûr pour une
    application ouverte aux clients externes.
  - Les mutations sensibles (transition d'un ordre de travail, acceptation
    d'un devis, décision sur un échantillon) passent par des fonctions
    Postgres dédiées (`SECURITY DEFINER`) plutôt que par des écritures
    directes, pour centraliser la règle métier et la journalisation
    (défense en profondeur, cf. section 9 de l'analyse fonctionnelle).
  - **Realtime** pour les écrans d'atelier : la file d'un chef de section et
    la vue transverse se mettent à jour sans rechargement de page.
- **Tailwind CSS v4**, **Framer Motion** (transitions), **sonner**
  (notifications), **lucide-react** (icônes).

## Structure du projet

```
src/
  app/
    login/                    Authentification
    (app)/                    Zone connectée (sidebar + garde de rôle)
      dashboard/               Tableau de bord adapté au rôle
      client/                  Portail client
      commercial/              CRM (demandes, devis, échantillons)
      infographie/             Demandes graphiques
      atelier/production/      Ordres de fabrication (responsable production)
      atelier/section/         File d'OT d'une section (chef de section)
      atelier/transverse/      Vue transverse toutes sections
      admin/                   Utilisateurs, sections, gammes, stock, audit
  components/                 Composants UI réutilisables
  lib/
    supabase/                  Clients Supabase (navigateur / serveur / admin)
    auth/                      Résolution du profil courant, garde de rôle, nav
    actions/                   Server Actions partagées (demandes, échantillons)
    types/domain.ts            Types + libellés partagés avec le schéma SQL
supabase/
  migrations/0001_schema.sql   Schéma complet (tables, enums)
  migrations/0002_rls.sql      RLS + fonctions métier protégées
scripts/seed.ts                Données de démonstration
```

## Mise en route

### 1. Créer le projet Supabase

Créez un projet Supabase (organisation **Seritex**), puis récupérez dans
*Project Settings → API* : l'URL du projet, la clé `anon` et la clé
`service_role`.

### 2. Configurer l'environnement

```bash
cp .env.local.example .env.local
# renseigner NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY
```

### 3. Appliquer le schéma

Dans le SQL Editor du dashboard Supabase (ou via la CLI `supabase db push`),
exécuter dans l'ordre :

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_rls.sql`

### 4. Installer les dépendances et lancer le seed de démonstration

```bash
npm install
npm run seed
```

Le seed crée des entreprises, une gamme opératoire, des demandes/devis, un
ordre de fabrication en cours, une demande d'échantillon, et un compte par
rôle (mot de passe `Seritex2026!`) :

| Rôle | E-mail |
|---|---|
| Administrateur | admin@seritex.local |
| Commercial | commercial@seritex.local |
| Infographiste | infographiste@seritex.local |
| Responsable production | production@seritex.local |
| Chef de section (Coupe) | coupe@seritex.local |
| Chef de section (Sérigraphie) | serigraphie@seritex.local |
| Chef de section (Confection) | confection@seritex.local |
| Client | client@ivoiresport.example |
| Client | client@cotonivoire.example |

### 5. Lancer l'application

```bash
npm run dev
```

## Sécurité — points clés

- Chaque table porte des policies RLS ; un chef de section ne peut **jamais**
  lire ou modifier un ordre de travail d'une autre section, même en
  contournant l'interface (vérifié à la fois par la RLS et par la fonction
  `transition_work_order`).
- Un client ne voit que les données de sa propre entreprise (devis, demandes,
  échantillons, avancement de production) — jamais les tarifs internes, les
  marges, ou les détails d'atelier (opérateur, durées réelles).
- La vue de stock Sage (`stock_item_view`) est strictement lecture seule pour
  tous les rôles applicatifs ; seul un job technique via la clé
  `service_role` peut l'alimenter (cf. section 7.1b de l'analyse).
- Toutes les actions sensibles sont journalisées dans `audit_log`.
- Les mots de passe et sessions sont entièrement gérés par Supabase Auth
  (hachage, rotation de jetons, cookies httpOnly).

## Ce qui reste à faire avant une mise en production

- Brancher la vraie synchronisation du stock Sage (actuellement une table
  miroir avec un bouton de simulation admin) — dépend du schéma Sage réel
  (section 7.1b/11 de l'analyse).
- Génération des bons de travail PDF avec QR code (mentionnée en section 5.2,
  non incluse dans cette esquisse).
- Configurateur produit 2D détaillé (zones/couleurs) — le modèle de données
  existe (`configurations`, `config_zone_colors`, `config_visuals`) mais
  l'écran n'est qu'esquissé.
- Emails transactionnels (confirmation de compte, relances).
- Tests automatisés.
