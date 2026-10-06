# CVMatch — app perso de candidatures

Suivi de candidatures + analyse CV/annonce par IA, accessible sur mobile.
Front React (Vite) · Base + Auth Supabase · IA via Edge Function (clé Anthropic côté serveur).

## Ce qui est DÉJÀ fait (par Claude)
- Projet Supabase `cvmatch` créé (région Paris)
- Table `candidatures` + sécurité par ligne (RLS)
- Edge Function `claude` déployée (proxy IA)
- Clés déjà remplies dans `.env`

## Ce qu'il TE reste à faire (≈ 20 min)

### 1. Ta clé API Anthropic (pour l'IA)
- Crée un compte sur https://console.anthropic.com → génère une clé API.
- Ajoute-la comme secret Supabase :
  Dashboard Supabase → projet cvmatch → Edge Functions → Secrets → nouveau secret
  Nom : `ANTHROPIC_API_KEY`   Valeur : ta clé
  (L'IA ne marchera pas tant que ce secret n'est pas ajouté.)

### 2. Autoriser l'URL de connexion
- Dashboard → Authentication → URL Configuration
- Mets ton futur domaine Vercel dans "Site URL" et "Redirect URLs"
  (ex : https://cvmatch.vercel.app). En local, ajoute http://localhost:5173.

### 3. Tester en local
```
npm install
npm run dev
```
Ouvre http://localhost:5173, connecte-toi avec ton email (tu reçois un lien magique).

### 4. Déployer sur Vercel (gratuit)
- Pousse ce dossier sur un repo GitHub.
- vercel.com → New Project → importe le repo.
- Dans Settings → Environment Variables, ajoute :
  VITE_SUPABASE_URL = https://yfmhblzanbmtirfgamco.supabase.co
  VITE_SUPABASE_KEY = sb_publishable_zXSCGD7-6ixfA_bJ65ssFw_BSytMk6W
- Deploy.

### 5. Sur ton téléphone
- Ouvre l'URL Vercel dans Safari/Chrome → menu → "Ajouter à l'écran d'accueil".
- Tu as maintenant CVMatch comme une appli, synchronisée avec ta base.

## Radar d'offres (onglet « Offres pour moi »)
Chaque matin, l'Edge Function `radar` collecte les offres IA / data, les trie selon le brief
(`search_profiles.brief`, copie dans `src/radarBrief.json`) puis Claude Haiku note les meilleures sur le CV.

- **Planification** (pg_cron, heure UTC) : 4h00 agrégateurs · 4h15 sites carrières · 4h40 notation
- **Sources** : France Travail, Adzuna (19 pays), JSearch / Google for Jobs (LinkedIn, Indeed…),
  et les sites carrières de la table `career_sites` (Workday, Greenhouse, Lever, Ashby, SmartRecruiters).
  Un site s'ajoute depuis l'app : colle l'URL de sa page offres → Tester → Ajouter.
- **Tri automatique** : stages/alternances, senior/lead/manager, 5+ ans, CDI IDF < 46 k€, France hors IDF → écartés.
  Les offres hors zones internationales ciblées sont pénalisées.

Secrets Supabase à ajouter (Edge Functions → Secrets) :
| Secret | Où l'obtenir |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com (notation IA) |
| `FT_CLIENT_ID`, `FT_CLIENT_SECRET` | francetravail.io → créer une application → API « Offres d'emploi v2 » |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | developer.adzuna.com |
| `JSEARCH_API_KEY` (ou `RAPIDAPI_KEY`) | app.openwebninja.com/api/jsearch (ou RapidAPI) |

Sans ces clés, les sites carrières fonctionnent déjà et le tri se fait par mots-clés (« pré-score »).

## Note sécurité
La clé `VITE_SUPABASE_KEY` (publishable) peut être publique : c'est la RLS qui protège tes données.
La clé Anthropic, elle, reste UNIQUEMENT dans les secrets Supabase — jamais dans le front.
