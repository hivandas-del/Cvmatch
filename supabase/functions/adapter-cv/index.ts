// Déclenche la routine Claude « CV MATCH » (IA à la demande) (abonnement Claude, pas de clé API).
// Deux usages :
//   {id}        → « Adapter mon CV » : la demande est déjà dans cv_adaptations
//   {profil:true} → « Mon profil » : CV + « ce que je cherche » déjà enregistrés dans search_profiles
// On vérifie que la ligne appartient bien à l'utilisateur connecté, puis on appelle l'endpoint /fire.
// Secrets requis : CVMATCH_ROUTINE_TOKEN (généré sur claude.ai/code/routines) et, au besoin,
// CVMATCH_ROUTINE_URL (sinon l'URL par défaut ci-dessous).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const URL_DEFAUT = "https://api.anthropic.com/v1/claude_code/routines/trig_01FwsZPEJhP6VSbFqHcE82FH/fire";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { id, profil } = await req.json();
    if (!profil && !/^[0-9a-f-]{36}$/i.test(id ?? "")) return json({ error: "id invalide" }, 400);

    const base = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("authorization") ?? "";
    const rest = (path: string, init: RequestInit = {}) =>
      fetch(`${base}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: anon, authorization: auth, "content-type": "application/json", ...(init.headers ?? {}) },
      });

    // RLS : ne renvoie la ligne que si elle appartient à l'utilisateur du JWT.
    const cible = profil ? "search_profiles?select=user_id" : `cv_adaptations?id=eq.${id}&select=id,statut`;
    const r = await rest(cible);
    const lignes = await r.json();
    if (!r.ok || !Array.isArray(lignes) || !lignes.length) return json({ error: "demande introuvable" }, 404);

    const token = Deno.env.get("CVMATCH_ROUTINE_TOKEN");
    if (!token) return json({ declenche: false, raison: "token_manquant" });

    const fire = await fetch(Deno.env.get("CVMATCH_ROUTINE_URL") || URL_DEFAUT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: profil ? "profil" : id }),
    });
    const out = await fire.json().catch(() => ({}));
    if (!fire.ok) {
      const raison = fire.status === 429 ? "limite_horaire" : fire.status === 401 ? "token_invalide" : `http_${fire.status}`;
      return json({ declenche: false, raison, detail: out?.error?.message ?? null });
    }
    const session_url = out?.claude_code_session_url ?? null;
    if (session_url) {
      if (profil) await rest(`search_profiles?user_id=eq.${lignes[0].user_id}`, { method: "PATCH", body: JSON.stringify({ profil_session_url: session_url }) });
      else await rest(`cv_adaptations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ session_url }) });
    }
    return json({ declenche: true, session_url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
