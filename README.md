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

## Note sécurité
La clé `VITE_SUPABASE_KEY` (publishable) peut être publique : c'est la RLS qui protège tes données.
La clé Anthropic, elle, reste UNIQUEMENT dans les secrets Supabase — jamais dans le front.
