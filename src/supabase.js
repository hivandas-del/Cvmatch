import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = createClient(URL, KEY);

// ---------- Auth (magic link par email) ----------
export const envoyerLien = (email) =>
  supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
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
