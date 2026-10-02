# sage-nas-sync

Synchronise les données Sage déjà miroirées sur le SQL Server du NAS vers
Supabase (`sage_customers_view`, `sage_articles_view`, `stock_item_view`).

```
Sage (VM) --> NAS (SQL Server, SAGE_SERITEX) --> [ce script] --> Supabase --> Seritex
```

Ne modifie jamais Sage ni le NAS — lecture seule côté NAS, écriture côté
Supabase uniquement (via la clé `service_role`, qui contourne le RLS —
jamais utilisée côté client).

**Préalable** : la migration `0071_sage_devis_miroir_et_recuperation.sql` (devis Sage en cours) doit aussi être appliquée avant de reconstruire l'image, comme les migrations `0058_stock_item_view_multi_depot.sql` et
`0059_clients_sage_source_de_verite.sql` et
`0060_clients_liste_recherche_filtres.sql` doivent être appliquées sur le projet
Supabase **avant** de reconstruire l'image et de relancer la synchro
(structure multi-dépôt de `stock_item_view`, colonnes structurées de
`sage_customers_view` et fonction `sync_companies_from_sage()`).

## Périmètre synchronisé
- **Devis Sage en cours** (`F_DOCENTETE` / `F_DOCLIGNE`, `DO_Domaine = 0` et
  `DO_Type = 0`) : tous les devis qui existent encore comme devis dans Sage,
  c'est-à-dire pas encore transformés en commande ou autre. Un devis refusé par
  le client reste listé tant que le service commercial ne l'a pas purgé ou
  changé d'état dans Sage. Écrits dans `sage_quotes_view` et
  `sage_quote_lines_view`, utilisés par « Récupérer un devis Sage » dans une
  demande. Les lignes de commentaire (quantité nulle ou désignation vide) sont
  ignorées. Cette partie est isolée : si elle échoue (colonne absente, tables de
  documents de vente non copiées sur le NAS), clients, articles et stock sont
  quand même synchronisés, mais le script se termine en erreur.
- **Clients** (`F_COMPTET`) : uniquement les comptes dont `CG_NumPrinc`
  commence par `411` (convention comptable = clients, pas fournisseurs).
  Écrits dans `sage_customers_view` (miroir), puis rattachés à `companies`
  par la fonction SQL `sync_companies_from_sage()` : création des nouveaux
  clients, mise à jour des champs Sage (lecture seule dans Seritex), archivage
  — jamais suppression — des clients disparus de Sage. Les contacts et les
  notes ne sont jamais touchés (gérés dans Seritex).
- **Commerciaux** (`F_COLLABORATEUR`) : copiés dans `sage_representants` pour
  afficher et filtrer le commercial de chaque client.
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
4. Rendre le script de lancement exécutable, puis tester :
   ```bash
   chmod +x run-sync.sh
   sudo ./run-sync.sh
   ```
   (`--network host`, dans le script, permet de joindre le conteneur `mssql`
   du NAS sur `localhost` — sinon utiliser l'IP du NAS et le port `1433`
   publié.)

## Lancer une synchronisation à la demande

À tout moment, en dehors de la planification (test, ou besoin ponctuel de
données à jour immédiatement) :
```bash
cd /volume1/docker/sage-nas-sync
sudo ./run-sync.sh
```
Le script vérifie que `.env` existe et affiche le résultat (nombre de
lignes synchronisées par table, éventuelles erreurs).

## Planification (DSM, toutes les 15 minutes)

Panneau de configuration DSM → **Planificateur de tâches** → Créer →
**Tâche planifiée** → **Script défini par l'utilisateur** :
- Utilisateur : `root` (nécessaire pour parler au socket Docker).
- Déclencheur : **Répéter**, toutes les **15 minutes**.
- Commande (onglet **Paramètres de la tâche**) :
  ```bash
  /volume1/docker/sage-nas-sync/run-sync.sh
  ```
- Optionnel mais recommandé : dans **Paramètres de la tâche → Envoyer les
  détails d'exécution par e-mail**, cocher "seulement en cas d'échec" pour
  être alerté si la synchro s'arrête sans avoir à consulter les journaux.

Pas de dépendance à une session Windows ni à une astuce anti-déconnexion —
le NAS tourne en continu par nature.

## Dépannage

**`Error: Node.js detected but native WebSocket not found`** (au lancement) :
`@supabase/supabase-js` initialise un client Realtime en interne (même s'il
n'est pas utilisé ici), qui nécessite l'API `WebSocket` native — disponible
à partir de **Node.js 22**. Le `Dockerfile` utilise `node:22-alpine` depuis
ce correctif ; si l'erreur persiste, l'image a probablement été construite
avant la mise à jour du `Dockerfile` — recopiez-le sur le NAS et
reconstruisez :
```bash
docker build -t sage-nas-sync .
```

## Déclenchement depuis l'application Seritex (pas encore fait)

Un vrai bouton "Synchroniser maintenant" dans Seritex nécessiterait un
mécanisme de demande, puisque Vercel n'a aucun accès réseau vers le NAS :
l'app écrirait une ligne dans une table Supabase (`sage_sync_requests` par
exemple), et une tâche DSM plus fréquente (ex. toutes les minutes) la
surveillerait pour lancer la synchro dès qu'une demande est en attente —
délai d'au plus une minute, pas un déclenchement instantané. Non implémenté
pour l'instant : la commande ci-dessus suffit en attendant un besoin réel.

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
