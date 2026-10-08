import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = createClient(URL, KEY);

// ---------- Auth (email + mot de passe) ----------
// Les liens des mails (confirmation, réinitialisation) reviennent sur l'adresse où l'app est ouverte,
// pas sur la « Site URL » par défaut du projet.
const retour = () => window.location.origin;
export const inscription = (email, password) =>
  supabase.auth.signUp({ email, password, options: { emailRedirectTo: retour() } });
export const connexion = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const deconnexion = () => supabase.auth.signOut();
export const motDePasseOublie = (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: retour() });
export const nouveauMotDePasse = (password) => supabase.auth.updateUser({ password });

// ---------- CRUD candidatures ----------
export async function chargerCandidatures() {
  const { data, error } = await supabase
    .from("candidatures")
    .select("*")
    .order("date_candidature", { ascending: false });
  if (error) throw error;
  return data;
}
export async function ajouterCandidature(c) {
  const { data, error } = await supabase.from("candidatures").insert(c).select().single();
  if (error) throw error;
  return data;
}
export async function majCandidature(id, patch) {
  const { error } = await supabase.from("candidatures").update(patch).eq("id", id);
  if (error) throw error;
}
export async function supprimerCandidature(id) {
  const { error } = await supabase.from("candidatures").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Radar d'offres ----------
// Sans la description (lourde) : elle est chargée à la demande (détails, « Adapter mon CV »).
// Pagination par 1 000 (plafond PostgREST) pour ne rater aucune offre à regarder.
const CHAMPS_OFFRE = "id, source, url, title, company, location, country, contract, remote, salary_min, salary_max, salary_currency, salary_text, posted_at";
export async function chargerOffres() {
  const out = [];
  for (let page = 0; page < 5; page++) {
    const { data, error } = await supabase
      .from("offer_matches")
      .select(`offer_id, piste, prescore, score, score_cv_adapte, verdict, reasons, scored_by, status, created_at, job_offers(${CHAMPS_OFFRE})`)
      .neq("status", "exclu")
      .order("created_at", { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
export async function chargerDescription(offerId) {
  const { data, error } = await supabase.from("job_offers").select("description").eq("id", offerId).maybeSingle();
  if (error) throw error;
  return data?.description ?? "";
}
export async function compterExclues() {
  const { count } = await supabase.from("offer_matches").select("offer_id", { count: "exact", head: true }).eq("status", "exclu");
  return count ?? 0;
}
export async function majMatch(offerId, patch) {
  const { error } = await supabase.from("offer_matches").update({ ...patch, updated_at: new Date().toISOString() }).eq("offer_id", offerId);
  if (error) throw error;
}
export async function chargerProfil() {
  const { data } = await supabase.from("search_profiles").select("cv_text, brief").maybeSingle();
  return data;
}
// ---------- Mon profil : CV + « ce que je cherche » → brief du radar (calé par Claude) ----------
const COLS_PROFIL = "cv_text, souhaits_text, cv_fichier, souhaits_fichier, profil_statut, profil_synthese, profil_erreur, profil_session_url, brief, updated_at";
export async function chargerProfilComplet() {
  const { data, error } = await supabase.from("search_profiles").select(COLS_PROFIL).maybeSingle();
  if (error) throw error;
  return data;
}
export async function enregistrerProfil(p) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.from("search_profiles")
    .upsert({
      user_id: session?.user?.id, cv_text: p.cv_text, souhaits_text: p.souhaits_text,
      cv_fichier: p.cv_fichier || null, souhaits_fichier: p.souhaits_fichier || null,
      profil_statut: "en_attente", profil_erreur: null, profil_session_url: null, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select(COLS_PROFIL).single();
  if (error) throw error;
  return data;
}
export async function declencherProfil() {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/adapter-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ profil: true }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { declenche: false, raison: out.error || `http_${res.status}` };
  return out;
}

export async function chargerJournal() {
  const { data } = await supabase.from("collect_runs").select("source, started_at, fetched, error").order("started_at", { ascending: false }).limit(150);
  return data ?? [];
}
export async function chargerSites() {
  const { data, error } = await supabase.from("career_sites").select("*").order("company");
  if (error) throw error;
  return data;
}
export async function ajouterSite(site) {
  const { data, error } = await supabase.from("career_sites").insert(site).select().single();
  if (error) throw error;
  return data;
}
export async function majSite(id, patch) {
  const { error } = await supabase.from("career_sites").update(patch).eq("id", id);
  if (error) throw error;
}
export async function supprimerSite(id) {
  const { error } = await supabase.from("career_sites").delete().eq("id", id);
  if (error) throw error;
}
export async function appelRadar(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/radar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Radar : erreur ${res.status}`);
  return out;
}

// ---------- Adapter mon CV (tâche planifiée Claude sur l'abonnement, pas de clé API) ----------
// 1) on dépose la demande dans cv_adaptations, 2) l'Edge Function « adapter-cv » déclenche la tâche,
// 3) la tâche écrit le CV réécrit dans `resultat` ; l'appli relit la ligne jusqu'au statut « pret ».
const COLS_ADAPT = "id, offer_id, entreprise, poste, statut, resultat, erreur, session_url, created_at, updated_at";
export async function creerAdaptation(d) {
  const { data, error } = await supabase.from("cv_adaptations")
    .insert({ ...d, annonce: (d.annonce || "").slice(0, 9000) }).select(COLS_ADAPT).single();
  if (error) throw error;
  return data;
}
export async function chargerAdaptations() {
  const { data, error } = await supabase.from("cv_adaptations").select(COLS_ADAPT)
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return data;
}
export async function chargerAdaptation(id) {
  const { data, error } = await supabase.from("cv_adaptations").select(COLS_ADAPT).eq("id", id).single();
  if (error) throw error;
  return data;
}
export async function relancerAdaptation(id) {
  const { error } = await supabase.from("cv_adaptations")
    .update({ statut: "en_attente", erreur: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
export async function supprimerAdaptation(id) {
  const { error } = await supabase.from("cv_adaptations").delete().eq("id", id);
  if (error) throw error;
}
export async function declencherAdaptation(id) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/adapter-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ id }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { declenche: false, raison: out.error || `http_${res.status}` };
  return out;
}

// ---------- IA (via Edge Function, clé secrète côté serveur) ----------
export async function callClaude(system, user) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/claude`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ system, user }),
  });
  if (!res.ok) throw new Error("Edge function error");
  const { text } = await res.json();
  return JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
}
