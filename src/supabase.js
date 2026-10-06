import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = createClient(URL, KEY);

// ---------- Auth (email + mot de passe) ----------
export const inscription = (email, password) => supabase.auth.signUp({ email, password });
export const connexion = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const deconnexion = () => supabase.auth.signOut();

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
export async function chargerOffres() {
  const { data, error } = await supabase
    .from("offer_matches")
    .select("offer_id, piste, prescore, score, verdict, reasons, scored_by, status, created_at, job_offers(*)")
    .neq("status", "exclu")
    .order("created_at", { ascending: false })
    .limit(600);
  if (error) throw error;
  return data;
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
