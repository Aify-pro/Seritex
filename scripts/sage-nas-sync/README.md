# sage-nas-sync

Synchronise les données Sage déjà miroirées sur le SQL Server du NAS vers
Supabase (`sage_customers_view`, `sage_articles_view`, `stock_item_view`).

```
Sage (VM) --> NAS (SQL Server, SAGE_SERITEX) --> [ce script] --> Supabase --> Seritex
```

Ne modifie jamais Sage ni le NAS — lecture seule côté NAS, écriture côté
Supabase uniquement (via la clé `service_role`, qui contourne le RLS —
jamais utilisée côté client).

**Préalable** : la migration `0058_stock_item_view_multi_depot.sql` doit
être fusionnée et appliquée sur le projet Supabase avant la première
exécution (structure multi-dépôt de `stock_item_view`).

## Périmètre synchronisé
- **Clients** (`F_COMPTET`) : uniquement les comptes dont `CG_NumPrinc`
  commence par `411` (convention comptable = clients, pas fournisseurs).
- **Articles** (`F_ARTICLE`) et **stock** (`F_ARTSTOCK`) : uniquement les
  familles `MP` (matière première), `SF` (semi-fini), `PF` (produit fini) —
  modifiable en tête de `sync.js` (`FAMILLES_SUIVIES`).
- Toute autre famille (fourniture atelier, bureau, guide, SAV,
  marchandise...) est ignorée.
- La catégorie matière première Sage n'étant pas fiable (tissu/fil/encre
  mélangés), tout part en `en_attente_classement` — à reclasser
  manuellement dans Seritex (Paramètres > Stock) en attendant une
  codification définitive.

## Installation (sur le NAS)

1. Copier ce dossier sur le NAS (`/volume1/docker/sage-nas-sync/` par
   exemple).
2. Copier `.env.example` en `.env` et compléter :
   - `NAS_SQL_PASSWORD` : mot de passe du login `nas_ecriture`.
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` : Dashboard Supabase >
     Project Settings > API.
3. Construire l'image :
   ```bash
   docker build -t sage-nas-sync .
   ```
4. Test manuel :
   ```bash
   docker run --rm --env-file .env --network host sage-nas-sync
   ```
   (`--network host` pour joindre le conteneur `mssql` du NAS sur
   `localhost` — sinon utiliser l'IP du NAS et le port `1433` publié.)

## Planification (DSM, toutes les 15 minutes)

Panneau de configuration DSM → **Planificateur de tâches** → Créer →
**Tâche planifiée** → **Script défini par l'utilisateur** :
- Déclencheur : toutes les 15 minutes.
- Commande :
  ```bash
  docker run --rm --env-file /volume1/docker/sage-nas-sync/.env --network host sage-nas-sync
  ```

Pas de dépendance à une session Windows ni à une astuce anti-déconnexion —
le NAS tourne en continu par nature.

## Recommandation (sécurité)
Le login `nas_ecriture` a des droits `db_owner` sur `SAGE_SERITEX` (hérités
de sa création initiale), plus larges que nécessaire pour ce script qui ne
fait que lire. Envisager un login dédié en lecture seule :

```sql
CREATE LOGIN nas_lecture_supabase WITH PASSWORD = '<mot-de-passe-fort>', CHECK_POLICY = ON;
USE SAGE_SERITEX;
CREATE USER nas_lecture_supabase FOR LOGIN nas_lecture_supabase;
ALTER ROLE db_datareader ADD MEMBER nas_lecture_supabase;
```

Puis mettre à jour `NAS_SQL_USER`/`NAS_SQL_PASSWORD` dans `.env` en
conséquence.
