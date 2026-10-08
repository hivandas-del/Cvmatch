// Radar d'offres : collecte quotidienne multi-sources + scoring selon le brief et le CV.
// Actions :
//   - cron (en-tête x-radar-secret) : {action:"collect", scope:"apis"|"web"|"sites"|"all"} | {action:"score_all"}
//                                     | {action:"test_web", source} (aperçu d'un job board, sans enregistrer)
//                                     scope "sites" sans part → relance un appel par lot de 10 sites ({part, parts, score_user?})
//   - utilisateur connecté (JWT)    : {action:"refresh"} (collecte API si > 3 h, job boards en arrière-plan, + scoring) | {action:"collect_sites"}
//                                     | {action:"score"} | {action:"rescore"} (re-tri complet après un nouveau profil)
//                                     | {action:"test_site", site:{company, ats, config}}
// Déployée avec verify_jwt = false : l'authentification est faite ici (secret Vault pour le cron, JWT sinon).
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-radar-secret, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const env = (k: string) => Deno.env.get(k) ?? "";
function serviceKey() {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch { return ""; }
}
const admin = () => createClient(env("SUPABASE_URL"), serviceKey(), { auth: { persistSession: false } });

// ---------------------------------------------------------------- utilitaires
type Offer = {
  source: string; source_id: string; url: string | null; title: string; company: string | null;
  location: string | null; country: string | null; contract: string | null; remote: string | null;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null; salary_text: string | null;
  description: string | null; posted_at: string | null;
};

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, "&");
// Décode d'abord (Greenhouse renvoie du HTML échappé), retire les balises, puis décode le reste.
const strip = (s: unknown) =>
  decode(decode(String(s ?? "")).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\(?[hfx]\s*\/\s*[hfx](\s*\/\s*[hfx])?\)?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const dedupKey = (o: Offer) =>
  [norm(o.title), norm(o.company), norm(o.location).split(" ")[0] ?? ""].join("|");

async function getJSON(url: string, init: RequestInit = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init.headers ?? {}) } });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) { const x = queue.shift()!; try { await fn(x); } catch (_) { /* erreur isolée */ } }
  }));
}

const RELEVANT = /\b(data|ia|ai|a\.i\.|intelligence artificielle|artificial intelligence|machine learning|ml|llm|genai|gen ai|analytics|analyst|analyste|bi|business intelligence|power bi|automati\w*|automation|scientist|product owner|product manager|consultant|rpa|mlops|prompt)\b/i;
const isRelevantTitle = (t: string) => RELEVANT.test(norm(t).replace(/\bi a\b/g, "ia"));

// « VIE » seulement en majuscules (sinon « assurance vie » serait pris pour un VIE).
const isVIEText = (s: unknown) => /\bV\.?I\.?E\b|volontariat international|\bV\.?I\.?E\.? /.test(String(s ?? "")) || /volontariat international/i.test(String(s ?? ""));
function contractFrom(s: unknown): string | null {
  const x = norm(s);
  if (!x) return null;
  if (isVIEText(s)) return "VIE";
  if (/stage|intern/.test(x)) return "Stage";
  if (/alternance|apprenti|apprentice/.test(x)) return "Alternance";
  if (/freelance|contractor|independant|mis\b|interim|temporary/.test(x)) return "Freelance";
  if (/cdd|fixed term|contract\b|temporaire/.test(x)) return "CDD";
  if (/cdi|permanent|fulltime|full time|regular/.test(x)) return "CDI";
  return null;
}

function annualSalaryFT(lib: string | undefined): [number | null, number | null] {
  if (!lib) return [null, null];
  const nums = [...lib.matchAll(/(\d+(?:[.,]\d+)?)\s*Euros/gi)].map((m) => parseFloat(m[1].replace(",", ".")));
  if (!nums.length) return [null, null];
  const k = /mensuel/i.test(lib) ? 12 : /horaire/i.test(lib) ? 1607 : 1;
  const v = nums.map((n) => Math.round(n * k));
  return [v[0] ?? null, v[1] ?? v[0] ?? null];
}

const CITY_COUNTRY: Record<string, string> = {
  paris: "FR", "la defense": "FR", lyon: "FR", brussels: "BE", bruxelles: "BE", luxembourg: "LU",
  geneva: "CH", geneve: "CH", zurich: "CH", amsterdam: "NL", berlin: "DE", munich: "DE", munchen: "DE",
  dublin: "IE", london: "GB", londres: "GB", stockholm: "SE", copenhagen: "DK", oslo: "NO", helsinki: "FI",
  montreal: "CA", toronto: "CA", "new york": "US", "san francisco": "US", boston: "US", dubai: "AE",
  "abu dhabi": "AE", singapore: "SG", singapour: "SG", "hong kong": "HK", istanbul: "TR",
};
const COUNTRY_NAMES: [RegExp, string][] = [
  [/\bfrance\b|ile de france|hauts de seine|toulouse|marseille|lille|nantes|bordeaux|rennes|strasbourg|grenoble|nice|montpellier|sophia antipolis/, "FR"],
  [/belgi(um|que)|\bbelgie\b/, "BE"], [/switzerland|suisse|schweiz/, "CH"], [/netherlands|pays bas|holland/, "NL"],
  [/germany|allemagne|deutschland|frankfurt|hamburg/, "DE"], [/united kingdom|\buk\b|england|royaume uni|scotland|manchester|edinburgh/, "GB"],
  [/ireland|irlande/, "IE"], [/sweden|suede/, "SE"], [/denmark|danemark/, "DK"], [/norway|norvege/, "NO"], [/finland|finlande/, "FI"],
  [/spain|espagne|madrid|barcelona/, "ES"], [/portugal|lisbon|lisbonne/, "PT"], [/ital(y|ie)|milan|rome/, "IT"],
  [/canada|vancouver|quebec/, "CA"], [/united states|\busa\b|\bus\b|chicago|seattle|austin|los angeles|atlanta/, "US"],
  [/united arab emirates|\buae\b|emirats/, "AE"], [/singapore|singapour/, "SG"], [/turk(ey|iye)|turquie/, "TR"],
  [/poland|pologne|warsaw|krakow/, "PL"], [/india|inde|bangalore|bengaluru|mumbai|pune|hyderabad/, "IN"],
  [/morocco|maroc|casablanca/, "MA"], [/japan|japon|tokyo/, "JP"], [/australia|sydney|melbourne/, "AU"],
  [/malaysia|malaisie|kuala lumpur/, "MY"], [/indonesia|indonesie|jakarta/, "ID"], [/lebanon|liban|beirut|beyrouth/, "LB"],
  [/vietnam|ho chi minh|hanoi/, "VN"], [/china|chine|shanghai|beijing|shenzhen/, "CN"], [/brazil|bresil|sao paulo/, "BR"],
  [/mexico|mexique/, "MX"], [/philippines|manila/, "PH"], [/thailand|thailande|bangkok/, "TH"], [/egypt|egypte|cairo/, "EG"],
  [/south africa|afrique du sud|johannesburg|cape town/, "ZA"], [/saudi|arabie saoudite|riyadh/, "SA"], [/qatar|doha/, "QA"],
  [/israel|tel aviv/, "IL"], [/romania|roumanie|bucharest/, "RO"], [/czech|prague/, "CZ"], [/hungary|budapest/, "HU"],
  [/greece|athens/, "GR"], [/austria|autriche|vienna|vienne/, "AT"], [/tunisia|tunisie|tunis/, "TN"], [/senegal|dakar/, "SN"],
];
function countryFromLocation(loc: string | null): string | null {
  const x = norm(loc);
  if (!x) return null;
  for (const [c, cc] of Object.entries(CITY_COUNTRY)) if (x.includes(c)) return cc;
  if (/\b9[1-5]\b|\b7[578]\b/.test(x)) return "FR";
  for (const [re, cc] of COUNTRY_NAMES) if (re.test(x)) return cc;
  return null;
}
// Titres manifestement hors cible : on évite d'aller chercher leur fiche détaillée.
const QUICK_EXCLUDE = /\b(senior|sr|lead|head|director|directeur|directrice|principal|staff|vp|vice president|intern|internship|stage|stagiaire|alternance|alternant|apprenti|apprentice|working student|werkstudent)\b/;

// ---------------------------------------------------------------- sources
const FT_QUERIES = ["data analyst", "data scientist", "intelligence artificielle", "data engineer", "analytics engineer",
  "consultant data", "product owner data", "power bi", "automatisation", "IA generative"];

// Requêtes tirées du profil (« ce que je cherche ») si présentes, sinon la liste par défaut.
const listeBrief = (v: unknown, max: number) =>
  Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, max) : [];

async function collectFranceTravail(push: (o: Offer) => void, requetes: string[] = []) {
  const id = env("FT_CLIENT_ID"), secret = env("FT_CLIENT_SECRET");
  if (!id || !secret) throw new Error("clés France Travail absentes (FT_CLIENT_ID / FT_CLIENT_SECRET)");
  const tok = await getJSON(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "api_offresdemploiv2 o2dsoffre" }),
    },
  );
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  for (const q of requetes.length ? requetes : FT_QUERIES) {
    const p = new URLSearchParams({ motsCles: q.split(" ").join(","), region: "11", typeContrat: "CDI", publieeDepuis: "7", range: "0-149" });
    const d = await getJSON(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${p}`, { headers: auth }).catch(() => null);
    for (const r of d?.resultats ?? []) {
      const [smin, smax] = annualSalaryFT(r.salaire?.libelle);
      push({
        source: "France Travail", source_id: String(r.id),
        url: r.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${r.id}`,
        title: strip(r.intitule), company: r.entreprise?.nom ?? null, location: r.lieuTravail?.libelle ?? null, country: "FR",
        contract: contractFrom(r.typeContrat) ?? r.typeContrat ?? null, remote: null,
        salary_min: smin, salary_max: smax, salary_currency: "EUR", salary_text: r.salaire?.libelle ?? null,
        description: strip(r.description), posted_at: r.dateCreation ?? null,
      });
    }
    await new Promise((r) => setTimeout(r, 120)); // quota : quelques appels / seconde
  }
}

// Palier gratuit Adzuna : 25 appels/min et 250/jour → peu de requêtes larges, espacées.
// Le tri fin (métier, niveau, exclusions) est fait ensuite par evaluate() et l'IA.
const ADZ_FR: Record<string, string>[] = [
  { title_only: "data" }, { what_or: "ia llm genai intelligence artificielle", title_only: "" },
  { what_phrase: "machine learning" }, { title_only: "analytics" },
];
const ADZ_INTL: Record<string, string>[] = [{ title_only: "data" }, { what_or: "ai llm genai machine learning", title_only: "" }];

async function collectAdzuna(push: (o: Offer) => void, countries: string[]) {
  const id = env("ADZUNA_APP_ID"), key = env("ADZUNA_APP_KEY");
  if (!id || !key) throw new Error("clés Adzuna absentes (ADZUNA_APP_ID / ADZUNA_APP_KEY)");
  const jobs: [string, Record<string, string>][] = [];
  for (const q of ADZ_FR) jobs.push(["fr", q]);
  for (const c of countries) for (const q of ADZ_INTL) jobs.push([c, q]);
  let failures = 0;
  for (const [c, q] of jobs) {
    const p = new URLSearchParams({
      app_id: id, app_key: key, results_per_page: "50", max_days_old: "7", sort_by: "date",
      what_exclude: "senior lead head intern internship stage alternance stagiaire apprenti",
    });
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    if (c === "fr") { p.set("where", "Paris"); p.set("distance", "45"); }
    const d = await getJSON(`https://api.adzuna.com/v1/api/jobs/${c}/search/1?${p}`).catch((e) => { failures++; if (failures > 3) throw e; return null; });
    await new Promise((r) => setTimeout(r, 2600));
    for (const r of d?.results ?? []) {
      push({
        source: "Adzuna", source_id: String(r.id), url: r.redirect_url ?? null, title: strip(r.title),
        company: r.company?.display_name ?? null, location: r.location?.display_name ?? null, country: c.toUpperCase(),
        contract: contractFrom(r.contract_type) ?? null, remote: null,
        salary_min: r.salary_is_predicted === "1" ? null : (r.salary_min ? Math.round(r.salary_min) : null),
        salary_max: r.salary_is_predicted === "1" ? null : (r.salary_max ? Math.round(r.salary_max) : null),
        salary_currency: null, salary_text: null, description: strip(r.description), posted_at: r.created ?? null,
      });
    }
  }
}

const JS_ROLES = '("data analyst" OR "data scientist" OR "AI consultant" OR "AI engineer" OR "analytics engineer" OR "AI product owner" OR "automation engineer")';

async function collectJSearch(push: (o: Offer) => void, villes: string[], perDay: number, roles: string[] = []) {
  const nKey = env("JSEARCH_API_KEY"), rKey = env("RAPIDAPI_KEY");
  if (!nKey && !rKey) throw new Error("clé JSearch absente (JSEARCH_API_KEY ou RAPIDAPI_KEY)");
  const r = roles.length ? `(${roles.map((x) => `"${x.replace(/"/g, "")}"`).join(" OR ")})` : JS_ROLES;
  const queries = [...villes.map((v) => `${r} junior in ${v}`), "VIE data OR IA OR \"intelligence artificielle\" Business France"];
  const day = Math.floor(Date.now() / 86400000);
  const todays = Array.from({ length: Math.min(perDay, queries.length) }, (_, i) => queries[(day * perDay + i) % queries.length]);
  for (const q of todays) {
    const p = new URLSearchParams({ query: q, page: "1", num_pages: "1", date_posted: "week" });
    const d = nKey
      ? await getJSON(`https://api.openwebninja.com/jsearch/search?${p}`, { headers: { "x-api-key": nKey } }, 25000)
      : await getJSON(`https://jsearch.p.rapidapi.com/search?${p}`, { headers: { "X-RapidAPI-Key": rKey, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } }, 25000);
    for (const r of d?.data ?? []) {
      const loc = [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", ");
      push({
        source: `JSearch · ${r.job_publisher ?? "web"}`, source_id: String(r.job_id), url: r.job_apply_link ?? null,
        title: strip(r.job_title), company: r.employer_name ?? null, location: loc || null, country: r.job_country ?? null,
        contract: contractFrom(r.job_employment_type) ?? null, remote: r.job_is_remote ? "remote" : null,
        salary_min: r.job_min_salary ?? null, salary_max: r.job_max_salary ?? null, salary_currency: r.job_salary_currency ?? null,
        salary_text: r.job_salary_period ?? null, description: strip(r.job_description), posted_at: r.job_posted_at_datetime_utc ?? null,
      });
    }
  }
}

// Business France (mon-vie-via.businessfrance.fr) : API publique du site, protégée par une clé exposée
// dans la page (config Nuxt). On la relit à chaque collecte, avec la dernière connue en secours.
const BF_CLE_SECOURS = "l+KwpoLPiXlsjxNT/NQ2iOFz8+iuygxAODs9FeAEWYM=";
const BF_REQUETES = ["data", "IA", "intelligence artificielle", "AI", "analyst", "analytics", "machine learning", "business intelligence", "automatisation", "digital"];
async function cleBusinessFrance() {
  try {
    const r = await fetch("https://mon-vie-via.businessfrance.fr/offres/recherche", { headers: { accept: "text/html" } });
    const m = (await r.text()).match(/API_KEY:"([^"]+)"/);
    if (m) return m[1].replace(/\\u002F/g, "/");
  } catch { /* clé de secours */ }
  return BF_CLE_SECOURS;
}
async function collectBusinessFrance(push: (o: Offer) => void, requetes: string[] = []) {
  const cle = await cleBusinessFrance();
  const vus = new Set<number>();
  for (const q of requetes.length ? requetes : BF_REQUETES) {
    const d = await getJSON("https://civiweb-api-prd.azurewebsites.net/api/Offers/search", {
      method: "POST", headers: { "content-type": "application/json", "X-API-KEY": cle },
      body: JSON.stringify({
        limit: 100, skip: 0, query: q, activitySectorId: [], missionsTypesIds: [], missionsDurations: [], geographicZones: [],
        countriesIds: [], studiesLevelId: [], companiesSizes: [], specializationsIds: [], entreprisesIds: [0], missionStartDate: null,
      }),
    }, 20000);
    for (const r of d?.result ?? []) {
      if (vus.has(r.id) || !isRelevantTitle(strip(r.missionTitle))) continue;
      vus.add(r.id);
      const ville = [r.cityName, r.countryName].filter(Boolean).map((x: string) => x.charAt(0) + x.slice(1).toLowerCase()).join(", ");
      push({
        source: "Business France VIE", source_id: String(r.id), url: `https://mon-vie-via.businessfrance.fr/offres/${r.id}`,
        title: strip(r.missionTitle), company: r.organizationName ?? null, location: ville || null, country: r.countryId ?? null,
        contract: r.missionType === "VIA" ? "VIA" : "VIE", remote: r.teleworkingAvailable ? "remote" : null,
        salary_min: null, salary_max: null, salary_currency: "EUR",
        salary_text: r.indemnite ? `${Math.round(r.indemnite)} €/mois (indemnité)` : null,
        description: strip(`${r.missionDuration ? `Mission de ${r.missionDuration} mois` : ""}${r.missionStartDate ? `, début ${String(r.missionStartDate).slice(0, 10)}` : ""}. ${r.candidateCounter != null ? `${r.candidateCounter} candidat(s) à date. ` : ""}${r.missionDescription ?? ""} ${r.missionProfile ?? ""}`),
        posted_at: r.startBroadcastDate ? new Date(r.startBroadcastDate).toISOString() : (r.creationDate ?? null),
      });
    }
  }
}

// ---------------------------------------------------------------- sites d'emploi (sans clé)
// ZipRecruiter, Indeed, Glassdoor, Jooble, Cadremploi et l'APEC renvoient une page anti-robot (Cloudflare / DataDome)
// aux serveurs : on ne les force pas. Leurs annonces arrivent en partie via JSearch (Google for Jobs).
// Ici, les job boards qui répondent normalement : Welcome to the Jungle, LinkedIn, HelloWork, Jobijoba.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
async function getHTML(url: string, timeoutMs = 20000) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9,en;q=0.7" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  return await r.text();
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Texte compris entre deux marqueurs (sans regex : les pages font plusieurs centaines de Ko).
function entre(s: string, a: string, b: string, from = 0) {
  const i = s.indexOf(a, from);
  if (i < 0) return null;
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? null : s.slice(i + a.length, j);
}
// Contenu d'une balise ouverte par `a` (on saute la fin de la balise ouvrante « …> »).
const contenu = (s: string, a: string, fin: string) => {
  const x = entre(s, a, fin);
  return x == null ? null : strip(x.slice(x.indexOf(">") + 1));
};

// « il y a 3 jours », « hier », « 3 octobre » → date ISO approximative.
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
function dateFr(s: unknown): string | null {
  const x = norm(s);
  if (!x) return null;
  const now = Date.now();
  if (/aujourd hui|a l instant|minute/.test(x)) return new Date(now).toISOString();
  if (/\bhier\b/.test(x)) return new Date(now - 86400000).toISOString();
  const r = x.match(/(\d+)\s*(heures?|h|jours?|semaines?|mois)\b/);
  if (r) {
    const u = r[2].startsWith("h") ? 3600000 : r[2].startsWith("j") ? 86400000 : r[2].startsWith("s") ? 7 * 86400000 : 30 * 86400000;
    return new Date(now - Number(r[1]) * u).toISOString();
  }
  const d = x.match(new RegExp(`(\\d{1,2})\\s+(${MOIS.join("|")})(?:\\s+(\\d{4}))?`));
  if (d) {
    const y = d[3] ? +d[3] : new Date().getUTCFullYear();
    let t = Date.UTC(y, MOIS.indexOf(d[2]), +d[1], 8);
    if (!d[3] && t > now + 86400000) t = Date.UTC(y - 1, MOIS.indexOf(d[2]), +d[1], 8);
    return new Date(t).toISOString();
  }
  return null;
}
// « 55 000 € / an », « De 2 500 € à 3 000 € par mois » → salaire annuel [min, max]
function salaireFr(s: string | null): [number | null, number | null] {
  if (!s || !/€|eur/i.test(s)) return [null, null];
  const nums = [...s.matchAll(/(\d[\d\s\u202f\u00a0.]*(?:[.,]\d+)?)\s*(k)?\s*(?:€|eur)/gi)]
    .map((m) => parseFloat(m[1].replace(/[\s\u202f\u00a0.]/g, "").replace(",", ".")) * (m[2] ? 1000 : 1)).filter((n) => n > 0);
  if (!nums.length) return [null, null];
  const k = /mois|mensuel/i.test(s) ? 12 : /heure|horaire/i.test(s) ? 1607 : 1;
  const v = nums.map((n) => Math.round(n * k));
  return [v[0] ?? null, v[1] ?? v[0] ?? null];
}

const WEB_SOURCES = ["Welcome to the Jungle", "LinkedIn", "HelloWork", "Jobijoba"];
const SOURCES_IDF = new Set(["France Travail", ...WEB_SOURCES]);
const WEB_QUERIES = ["data analyst", "data scientist", "consultant data", "consultant IA", "intelligence artificielle",
  "analytics engineer", "product owner data", "power bi", "automatisation"];
const webBase = (o: Partial<Offer>): Offer => ({
  source: "", source_id: "", url: null, title: "", company: null, location: null, country: "FR", contract: null, remote: null,
  salary_min: null, salary_max: null, salary_currency: null, salary_text: null, description: null, posted_at: null, ...o,
} as Offer);

// Welcome to the Jungle : index Algolia public du site (clé de recherche exposée dans la page).
const WTTJ = { app: "CSEKHVMS53", key: "4bd8f6215d0cc52b26430765769e65a0", index: "wttj_jobs_production_fr" };
const WTTJ_CONTRATS: Record<string, string> = {
  full_time: "CDI", temporary: "CDD", vie: "VIE", internship: "Stage", apprenticeship: "Alternance", freelance: "Freelance",
};
async function collectWTTJ(push: (o: Offer) => void, requetes: string[], paysB: string[]) {
  const depuis = Math.floor(Date.now() / 1000) - 8 * 86400;
  const base = `published_at_timestamp > ${depuis} AND NOT contract_type:internship AND NOT contract_type:apprenticeship AND NOT contract_type:freelance`;
  const zones = [`offices.state:"Île-de-France"`];
  if (paysB.length) zones.push(`(${paysB.map((c) => `offices.country_code:${c}`).join(" OR ")})`);
  const requests = requetes.flatMap((q) => zones.map((z) => ({
    indexName: WTTJ.index,
    params: new URLSearchParams({
      query: q, hitsPerPage: "60", filters: `${base} AND ${z}`,
      attributesToRetrieve: JSON.stringify(["reference", "name", "slug", "organization.name", "organization.slug", "offices", "contract_type",
        "remote", "published_at", "summary", "key_missions", "profile", "experience_level_minimum", "salary_minimum",
        "salary_maximum", "salary_period", "salary_currency", "language"]),
      attributesToHighlight: "[]",
    }).toString(),
  })));
  const d = await getJSON(`https://${WTTJ.app}-dsn.algolia.net/1/indexes/*/queries`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-algolia-application-id": WTTJ.app, "x-algolia-api-key": WTTJ.key,
      referer: "https://www.welcometothejungle.com/", origin: "https://www.welcometothejungle.com",
    },
    body: JSON.stringify({ requests }),
  }, 25000);
  const vus = new Set<string>();
  for (const res of d?.results ?? []) {
    for (const h of res.hits ?? []) {
      if (vus.has(h.reference)) continue;
      vus.add(h.reference);
      const bureau = (h.offices ?? []).find((o: any) => /ile de france/.test(norm(o.state))) ?? h.offices?.[0] ?? {};
      const k = h.salary_period === "monthly" ? 12 : h.salary_period === "daily" ? 218 : h.salary_period === "hourly" ? 1607 : 1;
      const smin = h.salary_minimum ? Math.round(h.salary_minimum * k) : null, smax = h.salary_maximum ? Math.round(h.salary_maximum * k) : null;
      const exp = Number(h.experience_level_minimum ?? 0);
      push(webBase({
        source: "Welcome to the Jungle", source_id: h.reference,
        url: h.organization?.slug && h.slug ? `https://www.welcometothejungle.com/fr/companies/${h.organization.slug}/jobs/${h.slug}` : null,
        title: strip(h.name), company: h.organization?.name ?? null,
        location: [bureau.city, bureau.country].filter(Boolean).join(", ") || null, country: bureau.country_code ?? null,
        contract: WTTJ_CONTRATS[h.contract_type] ?? null, remote: h.remote === "fulltime" ? "remote" : null,
        salary_min: smin, salary_max: smax ?? smin, salary_currency: h.salary_currency ?? (smin ? "EUR" : null),
        salary_text: smin ? `${smin}${smax && smax !== smin ? `-${smax}` : ""} ${h.salary_currency ?? "EUR"}/an` : null,
        description: strip([h.summary, ...(h.key_missions ?? []), h.profile, exp >= 1 ? `Expérience : ${Math.round(exp)} ans minimum` : ""].filter(Boolean).join(" ")),
        posted_at: h.published_at ?? null,
      }));
    }
  }
}

// LinkedIn : pages publiques « jobs-guest » (sans connexion), Île-de-France, niveaux « Premier emploi » et « Associé ».
// La fiche détaillée (description, type de contrat) n'est chargée que pour les intitulés pertinents.
async function collectLinkedIn(push: (o: Offer) => void, requetes: string[]) {
  const cartes = new Map<string, Offer>();
  let echecs = 0;
  for (const q of requetes) {
    for (const start of [0, 10]) {
      const p = new URLSearchParams({ keywords: q, geoId: "104246759", f_TPR: "r604800", f_E: "2,3", start: String(start) });
      let html = "";
      try { html = await getHTML(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${p}`); }
      catch (e) { if (++echecs > 3) throw e; }
      const bs = html.split('data-entity-urn="urn:li:jobPosting:').slice(1);
      for (const b of bs) {
        const id = b.slice(0, b.indexOf('"'));
        const title = contenu(b, 'base-search-card__title"', "</h3>") ?? "";
        if (!id || cartes.has(id) || !isRelevantTitle(title)) continue;
        cartes.set(id, webBase({
          source: "LinkedIn", source_id: id, url: `https://www.linkedin.com/jobs/view/${id}/`, title,
          company: contenu(b, 'base-search-card__subtitle"', "</h4>"), location: contenu(b, 'job-search-card__location"', "</span>"),
          posted_at: entre(b, 'datetime="', '"'),
        }));
      }
      await pause(900);
      if (bs.length < 10) break;
    }
  }
  const aDetailler = [...cartes.values()].filter((o) => !QUICK_EXCLUDE.test(norm(o.title))).slice(0, 40);
  await pool(aDetailler, 2, async (o) => {
    const h = await getHTML(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${o.source_id}`).catch(() => null);
    await pause(500);
    if (!h) return;
    o.description = contenu(h, "show-more-less-html__markup", "</div>");
    const criteres = h.split("description__job-criteria-text").slice(1).map((c) => strip(c.slice(c.indexOf(">") + 1, c.indexOf("</"))));
    o.contract = contractFrom(criteres.join(" "));
  });
  for (const o of cartes.values()) push(o);
}

// HelloWork : page de résultats (CDI, Paris + 20 km, publiées depuis 1 semaine).
async function collectHelloWork(push: (o: Offer) => void, requetes: string[]) {
  const vus = new Set<string>();
  let echecs = 0;
  for (const q of requetes) {
    let html = "";
    try { html = await getHTML(`https://www.hellowork.com/fr-fr/emploi/recherche.html?${new URLSearchParams({ k: q, l: "Paris", c: "CDI", d: "w" })}`); }
    catch (e) { if (++echecs > 3) throw e; }
    for (const b of html.split('data-id-storage-item-id="').slice(1)) {
      const id = b.slice(0, b.indexOf('"'));
      if (!/^\d+$/.test(id) || vus.has(id)) continue;
      vus.add(id);
      const title = contenu(b, '<p class="typo-l', "</p>") ?? "";
      if (!isRelevantTitle(title)) continue;
      const resume = strip(entre(entre(b, 'data-cy="offerTitle"', ">") ?? "", 'aria-label="', '"') ?? "");
      const salaire = /salaire de ([^,]+)/.exec(resume)?.[1] ?? null;
      const [smin, smax] = salaireFr(salaire);
      push(webBase({
        source: "HelloWork", source_id: id, url: `https://www.hellowork.com/fr-fr/emplois/${id}.html`, title,
        company: contenu(b, '<p class="typo-s inline"', "</p>"), location: contenu(b, 'data-cy="localisationCard"', "</div>"),
        contract: contractFrom(contenu(b, 'data-cy="contractCard"', "</div>")) ?? "CDI",
        salary_min: smin, salary_max: smax, salary_currency: smin ? "EUR" : null, salary_text: salaire,
        description: resume.replace(/^Voir offre de /, ""), posted_at: dateFr(contenu(b, 'text-grey-500 pl-1 pt-1"', "</div>")),
      }));
    }
    await pause(700);
  }
}

// Jobijoba : agrégateur français (Paris + 30 km, 7 derniers jours). Le lien passe par sa redirection vers l'annonce source.
async function collectJobijoba(push: (o: Offer) => void, requetes: string[]) {
  const vus = new Set<string>();
  let echecs = 0;
  for (const q of requetes) {
    let html = "";
    const p = new URLSearchParams({ what: q, where: "Paris", whereType: "city", perimeter: "30", period: "7_days" });
    try { html = await getHTML(`https://www.jobijoba.com/fr/query/?${p}`); }
    catch (e) { if (++echecs > 3) throw e; }
    for (const b of html.split('<div class="offer" data-id="ad_').slice(1)) {
      const id = b.slice(0, b.indexOf('"'));
      if (!id || vus.has(id)) continue;
      vus.add(id);
      const title = contenu(b, 'class="offer-header-title"', "</h3>") ?? "";
      if (!isRelevantTitle(title)) continue;
      const f: Record<string, string> = {};
      for (const s of b.split('<span class="feature">').slice(1)) {
        // <span class="iconwrap"><span class="icon-…"></span></span><span>Valeur</span>
        const icone = /icon-([a-z-]+)/.exec(s)?.[1] ?? "";
        const i1 = s.indexOf("</span>"), i2 = s.indexOf("</span>", i1 + 7), i3 = s.indexOf("</span>", i2 + 7);
        if (icone && i1 >= 0 && i2 >= 0 && i3 >= 0) f[icone] = strip(s.slice(i2 + 7, i3));
      }
      const desc = (contenu(b, 'class="description"', '<div class="sponsorised"') ?? contenu(b, 'class="description"', "</a>") ?? "")
        .replace(/Sponsorisé|Lire la suite/g, "").replace(/\s*…\s*$/, " …").trim();
      push(webBase({
        source: "Jobijoba", source_id: id, url: decode(entre(b, 'href="', '"') ?? "") || null, title,
        company: f["apartment"] || null, location: f["map-marker"] || null, contract: contractFrom(f["register"]),
        description: desc || null, posted_at: dateFr(contenu(b, "publication_date\"", "</span>")),
      }));
    }
    await pause(700);
  }
}

type Site = { id: string; company: string; ats: string; config: any };

async function collectCareerSite(site: Site, push: (o: Offer) => void) {
  const c = site.config ?? {};
  const base = (o: Partial<Offer>): Offer => ({
    source: `Carrières · ${site.company}`, source_id: "", url: null, title: "", company: site.company, location: null,
    country: null, contract: null, remote: null, salary_min: null, salary_max: null, salary_currency: null,
    salary_text: null, description: null, posted_at: null, ...o,
  } as Offer);
  const add = (o: Offer) => { if (isRelevantTitle(o.title)) { o.country ??= countryFromLocation(o.location); push(o); } };
  const worth = (t: string) => isRelevantTitle(t) && !QUICK_EXCLUDE.test(norm(t));

  if (site.ats === "greenhouse") {
    const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`);
    for (const j of (d?.jobs ?? []).filter((j: any) => worth(strip(j.title)))) add(base({ source_id: String(j.id), url: j.absolute_url, title: strip(j.title), location: j.location?.name ?? null, description: strip(j.content), posted_at: j.updated_at ?? null }));
  } else if (site.ats === "lever") {
    const host = c.eu ? "api.eu.lever.co" : "api.lever.co";
    const d = await getJSON(`https://${host}/v0/postings/${c.slug}?mode=json`);
    for (const j of (d ?? []).filter((j: any) => worth(strip(j.text)))) add(base({ source_id: j.id, url: j.hostedUrl, title: strip(j.text), location: j.categories?.location ?? null, contract: contractFrom(j.categories?.commitment), description: strip(j.descriptionPlain), posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null }));
  } else if (site.ats === "ashby") {
    const d = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}?includeCompensation=true`);
    for (const j of (d?.jobs ?? []).filter((j: any) => worth(strip(j.title)))) add(base({ source_id: j.id, url: j.jobUrl, title: strip(j.title), location: j.location ?? null, contract: contractFrom(j.employmentType), remote: j.isRemote ? "remote" : null, description: strip(j.descriptionPlain), posted_at: j.publishedAt ?? null }));
  } else if (site.ats === "smartrecruiters") {
    for (const q of c.search ?? ["data", "AI"]) {
      const d = await getJSON(`https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?q=${encodeURIComponent(q)}&limit=100`);
      const rel = (d?.content ?? []).filter((j: any) => worth(j.name)).slice(0, 25);
      await pool(rel, 4, async (j: any) => {
        const det = await getJSON(`https://api.smartrecruiters.com/v1/companies/${c.slug}/postings/${j.id}`).catch(() => null);
        const secs = det?.jobAd?.sections ?? {};
        add(base({
          source_id: j.id, url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`, title: strip(j.name),
          location: [j.location?.city, j.location?.country?.toUpperCase()].filter(Boolean).join(", "),
          country: j.location?.country?.toUpperCase() ?? null, contract: contractFrom(j.typeOfEmployment?.label),
          description: strip(`${secs.jobDescription?.text ?? ""} ${secs.qualifications?.text ?? ""}`), posted_at: j.releasedDate ?? null,
        }));
      });
    }
  } else if (site.ats === "workday") {
    const root = `https://${c.host}/wday/cxs/${c.tenant}/${c.site}`;
    // Les groupes mondiaux ont des milliers d'offres : on cible Paris + VIE (Workday classe par pertinence, lieu compris).
    const seen = new Set<string>();
    for (const q of c.search ?? ["data Paris", "IA Paris", "AI Paris", "VIE data"]) {
      const d = await getJSON(`${root}/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }),
      });
      const rel = (d?.jobPostings ?? []).filter((j: any) => worth(j.title) && !seen.has(j.externalPath)).slice(0, 15);
      rel.forEach((j: any) => seen.add(j.externalPath));
      await pool(rel, 4, async (j: any) => {
        const det = await getJSON(`${root}${j.externalPath}`).catch(() => null);
        const info = det?.jobPostingInfo ?? {};
        add(base({
          source_id: String(info.jobReqId ?? j.bulletFields?.[0] ?? j.externalPath), url: info.externalUrl ?? `https://${c.host}/${c.site}${j.externalPath}`,
          title: strip(j.title), location: info.location ?? j.locationsText ?? null,
          country: info.jobRequisitionLocation?.country?.alpha2Code ?? null,
          contract: contractFrom(`${j.title} ${info.timeType ?? ""}`),
          description: strip(info.jobDescription), posted_at: info.startDate ?? null,
        }));
      });
    }
  } else {
    throw new Error(`ATS inconnu : ${site.ats}`);
  }
}

// ---------------------------------------------------------------- collecte
// scope : "apis" (France Travail, Adzuna, JSearch, Business France) | "web" (job boards sans clé) | "sites" (sites carrières) | "all".
// Séparé en deux appels planifiés pour rester sous la limite de durée d'une Edge Function.
type Task = [string, (push: (o: Offer) => void) => Promise<void>, string | null];
// Les sites carrières sont répartis en lots (un lot = une exécution séparée de la fonction),
// sinon une seule exécution dépasse la mémoire / le CPU alloués quand il y a beaucoup de sites.
const SITES_PAR_LOT = 10;
async function nbLots(db: SupabaseClient) {
  const { count } = await db.from("career_sites").select("id", { count: "exact", head: true }).eq("enabled", true);
  return Math.max(1, Math.ceil((count ?? 0) / SITES_PAR_LOT));
}
// Lance chaque lot dans sa propre exécution (appel asynchrone via pg_net, secret relu dans Vault).
async function lancerLots(db: SupabaseClient, uid: string | null = null) {
  const lots = await nbLots(db);
  for (let i = 0; i < lots; i++) {
    await db.rpc("radar_call", { payload: { action: "collect", scope: "sites", part: i, parts: lots, ...(uid ? { score_user: uid } : {}) } });
  }
  return lots;
}

type Scope = "apis" | "web" | "sites" | "all";
async function collect(db: SupabaseClient, scope: Scope = "all", part = 0, parts = 1) {
  const { data: profiles } = await db.from("search_profiles").select("brief");
  const brief = profiles?.[0]?.brief ?? {};
  const pb = brief.piste_b ?? {};
  const countries: string[] = pb.actif === false ? [] : (pb.pays_adzuna ?? ["be", "ch", "nl", "de", "gb", "ca", "sg", "us"]);
  const villes: string[] = pb.actif === false ? [] : (pb.villes ?? []);
  const perDay = Number(brief.jsearch_requetes_par_jour ?? 6); // 6/jour ≈ 186/mois, sous le quota gratuit de 200

  const tasks: Task[] = [];
  if (scope === "apis" || scope === "all") {
    const reqFR = listeBrief(brief.requetes_fr, 14);
    const reqIntl = listeBrief(brief.requetes_intl, 8);
    tasks.push(["France Travail", (p) => collectFranceTravail(p, reqFR), null]);
    tasks.push(["Adzuna", (p) => collectAdzuna(p, countries), null]);
    if (pb.actif !== false) tasks.push(["Business France VIE", (p) => collectBusinessFrance(p), null]);
    // Palier gratuit JSearch = 200 requêtes / mois → une seule collecte par jour (celle du matin),
    // jamais relancée par le bouton « Actualiser ».
    const today = new Date().toISOString().slice(0, 10);
    const { data: jsDone } = await db.from("collect_runs").select("id").eq("source", "JSearch").is("error", null).gte("started_at", today).limit(1);
    if (!jsDone?.length) tasks.push(["JSearch", (p) => collectJSearch(p, villes, perDay, reqIntl), null]);
  }
  if (scope === "web" || scope === "all") {
    const reqWeb = listeBrief(brief.requetes_fr, 9);
    const q = reqWeb.length ? reqWeb : WEB_QUERIES;
    const zonesB: string[] = (pb.pays_cibles ?? ["BE", "LU", "CH", "NL", "DE", "IE", "GB", "SE", "DK", "NO", "FI", "CA", "US", "AE", "SG", "HK", "TR"])
      .map((c: string) => String(c).toUpperCase()).filter((c: string) => c !== "FR");
    tasks.push(["Welcome to the Jungle", (p) => collectWTTJ(p, q, pb.actif === false ? [] : zonesB), null]);
    tasks.push(["LinkedIn", (p) => collectLinkedIn(p, q), null]);
    tasks.push(["HelloWork", (p) => collectHelloWork(p, q), null]);
    tasks.push(["Jobijoba", (p) => collectJobijoba(p, q), null]);
  }
  if (scope === "sites" || scope === "all") {
    const { data: sites } = await db.from("career_sites").select("id, company, ats, config").eq("enabled", true).order("company");
    // Répartition en quinconce : les gros sites (Workday) se retrouvent dans des lots différents.
    const lot = ((sites ?? []) as Site[]).filter((_, i) => i % parts === part);
    for (const s of lot) tasks.push([`Carrières · ${s.company}`, (p) => collectCareerSite(s, p), s.id]);
  }

  const summary: Record<string, { fetched: number; error?: string }> = {};
  await pool(tasks, scope === "sites" ? 4 : 6, async ([name, fn, siteId]) => {
    const offers: Offer[] = [];
    const started = new Date().toISOString();
    let error: string | null = null;
    try { await fn((o) => { if (o.title) offers.push(o); }); } catch (e) { error = String((e as Error).message ?? e).slice(0, 300); }
    const rows = new Map<string, any>();
    for (const o of offers) { const k = dedupKey(o); if (!rows.has(k)) rows.set(k, { ...o, dedup_key: k, last_seen_at: new Date().toISOString() }); }
    const list = [...rows.values()];
    for (let i = 0; i < list.length; i += 300) {
      const { error: e } = await db.from("job_offers").upsert(list.slice(i, i + 300), { onConflict: "dedup_key", ignoreDuplicates: true });
      if (e && !error) error = e.message;
    }
    summary[name] = { fetched: offers.length, ...(error ? { error } : {}) };
    await db.from("collect_runs").insert({ source: name, started_at: started, finished_at: new Date().toISOString(), fetched: offers.length, error });
    if (siteId) await db.from("career_sites").update(error ? { last_error: error } : { last_ok_at: new Date().toISOString(), last_error: null }).eq("id", siteId);
  });
  return summary;
}

// ---------------------------------------------------------------- scoring
const IDF = /paris|ile de france|hauts de seine|seine saint denis|val de marne|essonne|yvelines|val d oise|seine et marne|la defense|puteaux|courbevoie|nanterre|boulogne|issy|levallois|neuilly|saint denis|montrouge|pantin|rueil|clichy|saint ouen|ivry|vincennes|montreuil|creteil|massy|velizy|guyancourt|saint quentin en yvelines|\b75\b|\b77\b|\b78\b|\b91\b|\b92\b|\b93\b|\b94\b|\b95\b/;
const AI_TERMS = ["llm", "genai", "gen ai", "ia generative", "generative ai", "intelligence artificielle", "artificial intelligence", "agent", "rag", "prompt", "machine learning", "automatisation", "automation", "copilot", "claude", "openai", "mistral"];
const SECTOR = ["banque", "bank", "assurance", "insurance", "mutuelle", "fintech", "insurtech", "bancaire"];
const JUNIOR = ["junior", "graduate", "entry level", "jeune diplome", "debutant", "0 3 ans", "1 3 ans", "0 2 ans", "associate", "early career"];

// Calibrage du pré-score (oct. 2026), réglé sur les notes IA déjà données :
// les postes de conseil junior IA/data étaient sous-notés, les postes de dev / recherche / infra sur-notés.
const CONSULT_FIT = /\bconsultant\b.*\b(ia|ai|data|bi|transformation|digital|digitale|automation|automatisation|analytics|power bi)\b|\b(ia|ai|data|bi|transformation|digital|digitale|automation|analytics)\b.*\bconsultant\b/;
const JUNIOR_TITLE = /\b(junior|graduate|new grad|associate|jeune diplome|early career|entry level)\b/;
const DEV_TITLE = /\b(research|researcher|phd|full ?stack|developer|developpeur|developpeuse|software engineer|architect|architecte|infrastructure|platform|mlops|devops|cloud engineer|forward deployed|back ?end|front ?end|securite|security|cyber|cybersecurite)\b/;
const AI_ENG_TITLE = /\b((ai|ml|llm|genai|ia|machine learning)\s+engineer|ingenieur\s+(ia|llm))\b/;
// Annonce rédigée dans une langue locale que le candidat ne parle pas (allemand, néerlandais, italien, nordique).
const LOCAL_WORDS = /\b(und|der|die|das|mit|fur|wir|ihre|het|een|wij|voor|naar|della|per|con|nostro|og|vi|med|som|ikke)\b/g;
const KNOWN_WORDS = /\b(the|and|with|you|our|les|des|vous|avec|nous)\b/g;
function localLanguage(rawTitle: string, desc: string) {
  if (/\b[mwfd]\s*\/\s*[mwfd]\s*\/\s*[mwfdx]\b/i.test(rawTitle)) return true; // « (m/w/d) » = annonce allemande
  const local = (desc.match(LOCAL_WORDS) ?? []).length, known = (desc.match(KNOWN_WORDS) ?? []).length;
  return local > 2 * known + 5;
}

function wordIn(text: string, terms: string[]) {
  return terms.filter((t) => new RegExp(`\\b${norm(t).replace(/\s+/g, "\\s+")}\\b`).test(text));
}
function minYearsRequired(desc: string): number | null {
  const d = norm(desc);
  const vals: number[] = [];
  for (const m of d.matchAll(/(\d{1,2})\s*(?:a\s*)?(?:ans|annees|years|yrs)\s+(?:minimum|min|d experience|of (?:professional |relevant |work |proven )?experience|experience)/g)) vals.push(+m[1]);
  for (const m of d.matchAll(/(?:minimum|au moins|at least|min)\s*(?:de\s*)?(\d{1,2})\s*(?:ans|annees|years)/g)) vals.push(+m[1]);
  const ok = vals.filter((v) => v > 0 && v < 25);
  return ok.length ? Math.min(...ok) : null;
}

function evaluate(o: any, brief: any) {
  const title = norm(o.title);
  const text = `${title} ${norm(o.description)}`;
  const loc = norm(o.location);
  const country = (o.country ?? countryFromLocation(o.location) ?? "").toUpperCase();
  const isVIE = o.contract === "VIE" || isVIEText(o.title);

  // piste
  let piste: string | null = null;
  if (isVIE) piste = "VIE";
  // Sources déjà filtrées sur l'Île-de-France à la collecte : la banlieue absente de la liste IDF reste en piste A.
  else if (country === "FR" || (!country && IDF.test(loc))) piste = IDF.test(loc) || SOURCES_IDF.has(o.source) ? "A" : null;
  else if (country) piste = "B";
  else piste = "B";
  if (!piste) return { excluded: "France hors Île-de-France" };
  if (piste === "A" && brief.piste_a?.actif === false) return { excluded: "Piste CDI IDF désactivée" };
  if (piste !== "A" && brief.piste_b?.actif === false) return { excluded: "Piste internationale désactivée" };

  // exclusions titre
  const exTitle = wordIn(title, brief.exclusions_titre ?? []);
  if (exTitle.length) return { excluded: `Titre exclu : ${exTitle[0]}` };
  const titresBrief = [...(brief.titres_p1 ?? []), ...(brief.titres_p2 ?? []), ...(brief.titres_p3 ?? [])];
  if (!isRelevantTitle(o.title) && !wordIn(title, titresBrief).length) return { excluded: "Hors des métiers visés" };
  // « Manager » = poste d'encadrement (sauf product / project / program manager, visés en junior).
  if (/\bmanager\b/.test(title) && !/\b(product|project|program|programme|projet|account|associate)\s+manager\b/.test(title)) return { excluded: "Poste de manager" };

  // contrat
  if (["Stage", "Alternance", "Freelance"].includes(o.contract)) return { excluded: `Contrat : ${o.contract}` };
  if (piste === "A" && o.contract && !["CDI", "VIE"].includes(o.contract)) return { excluded: `Contrat ${o.contract} (CDI attendu)` };

  // salaire (CDI IDF uniquement, si annoncé)
  const smin = brief.salaire_min_cdi_idf ?? 46000;
  if (piste === "A" && o.salary_max && o.salary_max > 10000 && o.salary_max < smin) return { excluded: `Salaire max ${o.salary_max} € < ${smin} €` };

  // expérience
  const yrs = minYearsRequired(o.description ?? "");
  const maxYrs = brief.experience_max ?? 3;
  if (yrs != null && yrs > maxYrs) return { excluded: `${yrs}+ ans d'expérience demandés` };

  // pré-score
  let s = 0;
  const reasons: string[] = [];
  const p1 = wordIn(title, brief.titres_p1 ?? []), p2 = wordIn(title, brief.titres_p2 ?? []), p3 = wordIn(title, brief.titres_p3 ?? []);
  if (!p1.length && CONSULT_FIT.test(title)) p1.push("conseil IA / data");
  if (p1.length) { s += 42; reasons.push(`Métier priorité 1 : ${p1[0]}`); }
  else if (p2.length) { s += 32; reasons.push(`Métier priorité 2 : ${p2[0]}`); }
  else if (p3.length) { s += 22; reasons.push(`Métier priorité 3 : ${p3[0]}`); }
  else s += 14;
  const ai = wordIn(text, AI_TERMS);
  s += Math.min(ai.length * 5, 20);
  if (ai.length) reasons.push(`IA : ${ai.slice(0, 3).join(", ")}`);
  const sk = wordIn(text, brief.competences ?? []);
  s += Math.min(sk.length * 3, 18);
  if (sk.length) reasons.push(`Stack : ${sk.slice(0, 4).join(", ")}`);
  if (wordIn(text, SECTOR).length) { s += 8; reasons.push("Secteur banque / assurance"); }
  if (wordIn(text, JUNIOR).length || (yrs != null && yrs <= 3)) { s += 8; reasons.push("Ouvert aux juniors"); }
  const juniorTitle = JUNIOR_TITLE.test(title), devTitle = DEV_TITLE.test(title);
  if (juniorTitle) { s += 8; reasons.push("Junior dans l'intitulé"); }
  if (devTitle) { s -= 18; reasons.push("Poste de dev / recherche / infra"); }
  else if (AI_ENG_TITLE.test(title) && !juniorTitle) { s -= 8; reasons.push("Ingénieur IA : profil plus dev"); }
  if (piste !== "A" && localLanguage(String(o.title ?? ""), norm(o.description))) { s -= 20; reasons.push("Annonce en langue locale"); }
  if (piste !== "A" && /english|anglais/.test(text)) s += 4;
  const zones: string[] = brief.piste_b?.pays_cibles ?? ["BE", "LU", "CH", "NL", "DE", "IE", "GB", "SE", "DK", "NO", "FI", "CA", "US", "AE", "SG", "HK", "TR"];
  if (piste === "B" && country && !zones.includes(country)) { s -= 22; reasons.push(`Pays hors zones ciblées (${country})`); }
  else if (piste === "B" && !country && loc) s -= 8; // lieu non identifié : un peu moins prioritaire
  return { piste, prescore: Math.max(0, Math.min(s, 95)), reasons };
}

async function aiScore(batch: any[], brief: any, cv: string) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY absente");
  const offres = batch.map((m, i) => ({
    id: `o${i}`, titre: m.o.title, entreprise: m.o.company, lieu: m.o.location, pays: m.o.country, contrat: m.o.contract,
    salaire: m.o.salary_text ?? (m.o.salary_max ? `${m.o.salary_min ?? "?"}-${m.o.salary_max} ${m.o.salary_currency ?? ""}` : null),
    piste: m.piste, description: (m.o.description ?? "").slice(0, 1600),
  }));
  const user = `BRIEF DU CANDIDAT
- Disponible : ${brief.disponibilite ?? "nov. 2026"} · junior 0-${brief.experience_max ?? 3} ans
- Piste A : CDI Île-de-France, hybride, min ${brief.salaire_min_cdi_idf ?? 46000} € brut/an
- Piste B : international (VIE ou contrat local), anglais ou français ; anglais B2, turc B2
- Bonus : ${(brief.bonus ?? []).join(" ; ")}
- À exclure : stages/alternances, postes senior (5+ ans), freelance, dev web pur, support IT, commercial pur

CV
${cv.slice(0, 6000)}

OFFRES
${JSON.stringify(offres)}

Note chaque offre de 0 à 100 selon l'adéquation réelle (métier IA/data visé, niveau junior, stack, secteur, langue, faisabilité pour le candidat : visa, langue locale exigée, etc.).
Barème : 85+ = presque tout coche ; 70-84 = très bon ; 50-69 = partiel ; <50 = hors cible.
Réponds UNIQUEMENT avec ce JSON : {"resultats":[{"id":"o0","score":0,"verdict":"<6 à 10 mots>","raisons":["<atout ou frein concret, 1 ligne>","<…>"]}]}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 1800, temperature: 0,
      system: "Tu es un recruteur expert des métiers IA et data. Tu évalues l'adéquation candidat / offres avec honnêteté. Réponds uniquement en JSON valide, sans texte autour.",
      messages: [{ role: "user", content: user }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  const text = (d.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return parsed.resultats as { id: string; score: number; verdict: string; raisons: string[] }[];
}

async function scoreUser(db: SupabaseClient, userId: string, aiLimit = 36) {
  const { data: prof } = await db.from("search_profiles").select("brief, cv_text").eq("user_id", userId).maybeSingle();
  if (!prof) return { error: "profil de recherche absent" };
  const brief = prof.brief ?? {};
  const since = new Date(Date.now() - 21 * 86400000).toISOString();

  // 1) nouvelles offres pas encore évaluées pour cet utilisateur
  const { data: done } = await db.from("offer_matches").select("offer_id").eq("user_id", userId).gte("created_at", new Date(Date.now() - 40 * 86400000).toISOString());
  const seen = new Set((done ?? []).map((d: any) => d.offer_id));
  let added = 0, excluded = 0;
  for (let page = 0; page < 20; page++) {
    const { data: offers } = await db.from("job_offers").select("*").gte("first_seen_at", since).order("first_seen_at", { ascending: false }).range(page * 500, page * 500 + 499);
    if (!offers?.length) break;
    const rows = offers.filter((o: any) => !seen.has(o.id)).map((o: any) => {
      const ev: any = evaluate(o, brief);
      if (ev.excluded) { excluded++; return { user_id: userId, offer_id: o.id, status: "exclu", verdict: ev.excluded, reasons: [] }; }
      added++;
      return { user_id: userId, offer_id: o.id, piste: ev.piste, prescore: ev.prescore, reasons: ev.reasons, scored_by: "mots-cles", status: "nouveau" };
    });
    if (rows.length) await db.from("offer_matches").upsert(rows, { onConflict: "user_id,offer_id", ignoreDuplicates: true });
    if (offers.length < 500) break;
  }

  // 2) notation IA des meilleures offres non encore notées
  if (aiLimit <= 0) return { added, excluded };
  const { data: todo } = await db.from("offer_matches")
    .select("offer_id, piste, prescore, job_offers(*)")
    .eq("user_id", userId).eq("scored_by", "mots-cles").in("status", ["nouveau", "vu"])
    .gte("prescore", 30).order("prescore", { ascending: false }).limit(aiLimit);
  let aiScored = 0, aiError: string | null = null;
  const items = (todo ?? []).map((t: any) => ({ id: t.offer_id, piste: t.piste, o: t.job_offers }));
  for (let i = 0; i < items.length && !aiError; i += 6) {
    const batch = items.slice(i, i + 6);
    try {
      const res = await aiScore(batch, brief, prof.cv_text ?? "");
      for (const r of res ?? []) {
        const m = batch[Number(String(r.id).replace("o", ""))];
        if (!m) continue;
        await db.from("offer_matches").update({
          score: Math.max(0, Math.min(100, Math.round(r.score))), verdict: r.verdict, reasons: r.raisons ?? [],
          scored_by: "ia", updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("offer_id", m.id);
        aiScored++;
      }
    } catch (e) { aiError = String((e as Error).message ?? e).slice(0, 200); }
  }
  return { added, excluded, aiScored, ...(aiError ? { aiError } : {}) };
}

// Re-tri complet après un changement de profil : on réévalue avec le nouveau brief toutes les offres
// récentes déjà triées (sauf celles ignorées ou ajoutées au suivi à la main). Les notes IA déjà données
// sont gardées ; une offre qui sort du périmètre passe en « exclu », une offre exclue qui y rentre revient.
async function rescoreUser(db: SupabaseClient, userId: string) {
  const { data: prof } = await db.from("search_profiles").select("brief").eq("user_id", userId).maybeSingle();
  if (!prof) return { error: "profil de recherche absent" };
  const brief = prof.brief ?? {};
  const since = new Date(Date.now() - 40 * 86400000).toISOString();
  let revues = 0, exclues = 0, reintegrees = 0;
  for (let page = 0; page < 20; page++) {
    const { data: rows } = await db.from("offer_matches")
      .select("offer_id, status, scored_by, job_offers(*)")
      .eq("user_id", userId).in("status", ["nouveau", "vu", "exclu"]).gte("created_at", since)
      .order("offer_id").range(page * 400, page * 400 + 399);
    if (!rows?.length) break;
    const maj: any[] = [];
    for (const m of rows as any[]) {
      if (!m.job_offers) continue;
      const ev: any = evaluate(m.job_offers, brief);
      revues++;
      if (ev.excluded) {
        if (m.status !== "exclu") exclues++;
        maj.push({ user_id: userId, offer_id: m.offer_id, status: "exclu", ...(m.scored_by === "ia" ? {} : { verdict: ev.excluded, reasons: [] }) });
      } else {
        const back = m.status === "exclu";
        if (back) reintegrees++;
        maj.push({
          user_id: userId, offer_id: m.offer_id, piste: ev.piste, prescore: ev.prescore,
          status: back ? "nouveau" : m.status,
          ...(m.scored_by === "ia" ? {} : { reasons: ev.reasons, verdict: null, scored_by: "mots-cles" }),
        });
      }
    }
    for (let i = 0; i < maj.length; i += 300) {
      // Upsert ligne à ligne regroupé par forme (PostgREST exige les mêmes colonnes dans un lot).
      const lot = maj.slice(i, i + 300);
      const groupes = new Map<string, any[]>();
      for (const r of lot) { const k = Object.keys(r).sort().join(","); groupes.set(k, [...(groupes.get(k) ?? []), r]); }
      for (const g of groupes.values()) await db.from("offer_matches").upsert(g.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "user_id,offer_id" });
    }
    if (rows.length < 400) break;
  }
  await db.from("search_profiles").update({ profil_a_retrier: false }).eq("user_id", userId);
  const nouvelles = await scoreUser(db, userId, 0);
  return { revues, exclues, reintegrees, nouvelles };
}

// Tri normal, précédé d'un re-tri complet si le profil a changé depuis (drapeau posé par la tâche Claude).
async function scoreOuRetri(db: SupabaseClient, userId: string, aiLimit = 36) {
  const { data: p } = await db.from("search_profiles").select("profil_a_retrier").eq("user_id", userId).maybeSingle();
  if (p?.profil_a_retrier) return { retri: await rescoreUser(db, userId) };
  return scoreUser(db, userId, aiLimit);
}

// ---------------------------------------------------------------- notifications
// Push ntfy (appli gratuite) pour les offres publiées récemment et bien notées : postuler tôt.
// Chaque offre n'est examinée qu'une fois (notified_at), qu'elle déclenche une notif ou non.
const APP_URL = "https://cvmatch-bice.vercel.app";
async function notifier(db: SupabaseClient, userId: string) {
  const { data: prof } = await db.from("search_profiles").select("brief, ntfy_topic").eq("user_id", userId).maybeSingle();
  if (!prof?.ntfy_topic) return { notif: "pas de canal" };
  const seuil = Number(prof.brief?.notif_seuil ?? 60);
  const fraicheurH = Number(prof.brief?.notif_fraicheur_h ?? 72);
  const { data: rows } = await db.from("offer_matches")
    .select("offer_id, score, prescore, score_cv_adapte, created_at, job_offers(title, company, location, url, posted_at, source)")
    .eq("user_id", userId).eq("status", "nouveau").is("notified_at", null).limit(500);
  if (!rows?.length) return { notif: 0 };
  const now = Date.now();
  const note = (r: any) => r.score_cv_adapte ?? r.score ?? r.prescore ?? 0;
  const age = (r: any) => (now - new Date(r.job_offers?.posted_at || r.created_at).getTime()) / 3600000;
  const fraiches = (rows as any[]).filter((r) => r.job_offers?.posted_at && age(r) <= fraicheurH && note(r) >= seuil)
    .sort((a, b) => note(b) - note(a));
  await db.from("offer_matches").update({ notified_at: new Date().toISOString() })
    .eq("user_id", userId).in("offer_id", (rows as any[]).map((r) => r.offer_id));
  if (!fraiches.length) return { notif: 0 };
  const quand = (r: any) => { const h = Math.max(1, Math.round(age(r))); return h < 24 ? `${h} h` : `${Math.round(h / 24)} j`; };
  const lignes = fraiches.slice(0, 6).map((r) => `${note(r)} · ${r.job_offers.title} — ${r.job_offers.company ?? "?"} (il y a ${quand(r)})`);
  if (fraiches.length > 6) lignes.push(`+ ${fraiches.length - 6} autre(s) dans CVMatch`);
  const une = fraiches.length === 1 ? fraiches[0].job_offers : null;
  await fetch("https://ntfy.sh/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: prof.ntfy_topic,
      title: une ? `Nouvelle offre : ${une.company ?? une.title}` : `${fraiches.length} offres toutes fraîches pour toi`,
      message: lignes.join("\n"), priority: note(fraiches[0]) >= 75 ? 4 : 3, tags: ["briefcase"],
      click: une?.url || APP_URL,
      actions: [{ action: "view", label: "Ouvrir CVMatch", url: APP_URL }],
    }),
  }).catch(() => null);
  return { notif: fraiches.length };
}

// ---------------------------------------------------------------- serveur
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  let body: any = {};
  try { body = await req.json(); } catch { /* vide */ }

  const secret = req.headers.get("x-radar-secret");
  if (secret) {
    const { data: ok } = await db.rpc("radar_check_secret", { s: secret });
    if (!ok) return json({ error: "secret invalide" }, 401);
    if (body.action === "collect") {
      const scope = body.scope ?? "all";
      if (scope === "sites" && body.part == null) return json({ lots: await lancerLots(db) });
      const out = await collect(db, scope, Number(body.part ?? 0), Number(body.parts ?? 1));
      const score = body.score_user ? await scoreUser(db, String(body.score_user), 0) : null;
      return json({ collect: out, ...(score ? { score } : {}) });
    }
    if (body.action === "test_web") {
      const fns: Record<string, (p: (o: Offer) => void, q: string[]) => Promise<void>> = {
        wttj: (p, q) => collectWTTJ(p, q, ["BE", "CH"]), linkedin: collectLinkedIn, hellowork: collectHelloWork, jobijoba: collectJobijoba,
      };
      const fn = fns[String(body.source)];
      if (!fn) return json({ error: "source inconnue" }, 400);
      const found: Offer[] = [];
      try { await fn((o) => found.push(o), body.q ?? ["data analyst"]); }
      catch (e) { return json({ ok: false, count: found.length, error: String((e as Error).message ?? e).slice(0, 300) }); }
      return json({ ok: true, count: found.length, sample: found.slice(0, body.n ?? 3).map((o) => ({ ...o, description: o.description?.slice(0, body.w ?? 200) })) });
    }
    if (body.action === "score_all") {
      const { data: profs } = await db.from("search_profiles").select("user_id");
      const out: Record<string, unknown> = {};
      for (const p of profs ?? []) out[p.user_id] = { ...(await scoreOuRetri(db, p.user_id)), ...(await notifier(db, p.user_id)) };
      return json({ score: out });
    }
    return json({ error: "action inconnue" }, 400);
  }

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return json({ error: "non connecté" }, 401);
  const uid = u.user.id;

  if (body.action === "refresh") {
    // Recollecte les API seulement si la dernière collecte date de plus de 3 h (quotas gratuits).
    const { data: last } = await db.from("collect_runs").select("started_at")
      .in("source", ["France Travail", "Adzuna", "JSearch"]).order("started_at", { ascending: false }).limit(1);
    const age = last?.[0] ? Date.now() - new Date(last[0].started_at).getTime() : Infinity;
    const collected = age > 3 * 3600000 ? await collect(db, "apis") : null;
    // Job boards (WTTJ, LinkedIn, HelloWork, Jobijoba) : collecte en arrière-plan, puis tri pour cet utilisateur.
    const { data: lastWeb } = await db.from("collect_runs").select("started_at").in("source", WEB_SOURCES).order("started_at", { ascending: false }).limit(1);
    const web = !lastWeb?.[0] || Date.now() - new Date(lastWeb[0].started_at).getTime() > 3 * 3600000;
    if (web) await db.rpc("radar_call", { payload: { action: "collect", scope: "web", score_user: uid } });
    return json({ collect: collected, web, score: await scoreOuRetri(db, uid, 18) });
  }
  if (body.action === "collect_sites") {
    // Scan en arrière-plan, lot par lot ; chaque lot trie ensuite les nouvelles offres pour cet utilisateur.
    return json({ lots: await lancerLots(db, uid), sites: (await db.from("career_sites").select("id", { count: "exact", head: true }).eq("enabled", true)).count ?? 0 });
  }
  if (body.action === "score") return json({ score: await scoreOuRetri(db, uid) });
  if (body.action === "rescore") return json({ rescore: await rescoreUser(db, uid) });
  if (body.action === "test_site") {
    // Teste un site carrières sans l'enregistrer : nombre d'offres pertinentes + exemples.
    const s = body.site ?? {};
    if (!s.ats || !s.config) return json({ error: "site incomplet" }, 400);
    const found: Offer[] = [];
    try {
      await collectCareerSite({ id: "test", company: s.company || "Test", ats: s.ats, config: s.config }, (o) => found.push(o));
      return json({ ok: true, count: found.length, sample: found.slice(0, 6).map((o) => `${o.title}${o.location ? ` · ${o.location}` : ""}`) });
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 200) });
    }
  }
  return json({ error: "action inconnue" }, 400);
});
