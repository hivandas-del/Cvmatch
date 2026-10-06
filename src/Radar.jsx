import { useEffect, useMemo, useState } from "react";
import {
  chargerOffres, compterExclues, majMatch, chargerJournal, chargerSites, ajouterSite, majSite, supprimerSite, appelRadar,
} from "./supabase";

// ---------- utilitaires ----------
const PISTES = [["all", "Tout"], ["A", "CDI Île-de-France"], ["B", "International"], ["VIE", "VIE"]];
const SEUILS = [[0, "Tous scores"], [50, "50+"], [70, "70+"], [85, "85+"]];
const VUES = [["a_voir", "À regarder"], ["nouveau", "Nouvelles"], ["ajoute", "Ajoutées au suivi"], ["ignore", "Ignorées"]];
const pisteLabel = { A: "CDI IDF", B: "International", VIE: "VIE" };
const pisteCls = {
  A: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  B: "bg-sky-50 text-sky-700 ring-sky-200",
  VIE: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
};
const API_SOURCES = ["France Travail", "Adzuna", "JSearch"];
const scoreOf = (r) => r.score ?? r.prescore ?? 0;
const tone = (s) => (s >= 75 ? "#059669" : s >= 55 ? "#d97706" : "#94a3b8");
function ilYa(d) {
  if (!d) return "";
  const h = Math.max(0, (Date.now() - new Date(d)) / 3600000);
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${Math.round(h)} h`;
  const j = Math.round(h / 24);
  return j < 31 ? `il y a ${j} j` : `il y a ${Math.round(j / 30)} mois`;
}
function salaire(o) {
  if (!o.salary_min && !o.salary_max) return null;
  const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : n);
  const cur = o.salary_currency && o.salary_currency !== "EUR" ? ` ${o.salary_currency}` : " €";
  return o.salary_min && o.salary_max && o.salary_min !== o.salary_max ? `${k(o.salary_min)}–${k(o.salary_max)}${cur}` : `${k(o.salary_max || o.salary_min)}${cur}`;
}

// Colle l'URL d'une page carrières → ATS + identifiants.
export function parseSiteUrl(raw) {
  let u;
  try { const t = raw.trim(); u = new URL(t.startsWith("http") ? t : `https://${t}`); } catch { return null; }
  const h = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (h.endsWith("greenhouse.io")) {
    const slug = parts[0] === "embed" ? u.searchParams.get("for") : parts[0];
    return slug ? { ats: "greenhouse", config: { slug } } : null;
  }
  if (h.endsWith("lever.co")) return parts[0] ? { ats: "lever", config: { slug: parts[0], ...(h.includes(".eu.") ? { eu: true } : {}) } } : null;
  if (h.endsWith("ashbyhq.com")) return parts[0] ? { ats: "ashby", config: { slug: parts[0] } } : null;
  if (h.endsWith("smartrecruiters.com")) return parts[0] ? { ats: "smartrecruiters", config: { slug: parts[0] } } : null;
  const wd = h.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const p = parts.filter((x) => !/^[a-z]{2}-[a-z]{2}$/i.test(x));
    return p[0] ? { ats: "workday", config: { host: h, tenant: wd[1], site: p[0] } } : null;
  }
  return null;
}

function Ring({ value, pre }) {
  const r = 20, c = 2 * Math.PI * r, off = c - (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div className="relative w-14 h-14 shrink-0" title={pre ? "Pré-score (mots-clés) — en attente de la note IA" : "Note IA"}>
      <svg viewBox="0 0 48 48" className="w-14 h-14 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#eef2f7" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={tone(value)} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={pre ? "3 3" : c} strokeDashoffset={pre ? 0 : off} style={{ transition: "stroke-dashoffset .6s ease" }}
          opacity={pre ? 0.55 : 1} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[15px] font-bold tabular-nums" style={{ color: tone(value) }}>{value}</span>
        {pre && <span className="text-[8px] uppercase tracking-wider text-slate-400 mt-0.5">pré</span>}
      </div>
    </div>
  );
}

function Stat({ value, label, accent }) {
  return (
    <div className="rounded-xl bg-white/[0.06] ring-1 ring-white/10 px-4 py-3 backdrop-blur">
      <div className={`text-2xl font-bold tabular-nums ${accent ?? "text-white"}`}>{value}</div>
      <div className="text-[11px] text-slate-300/80 mt-0.5">{label}</div>
    </div>
  );
}

// ---------- carte offre ----------
function OffreCard({ r, ouvert, onToggle, onAdapter, onSuivi, onIgnorer, onRestaurer, onLien }) {
  const o = r.job_offers ?? {};
  const pre = r.scored_by !== "ia";
  const s = scoreOf(r);
  const sal = salaire(o);
  const raisons = Array.isArray(r.reasons) ? r.reasons : [];
  return (
    <div className={`group rounded-2xl bg-white border transition ${r.status === "nouveau" ? "border-slate-200 shadow-[0_1px_0_rgba(15,23,42,.03)]" : "border-slate-200/70"} hover:border-indigo-200 hover:shadow-sm`}>
      <div className="p-4 sm:p-5 flex gap-4 cursor-pointer" onClick={onToggle}>
        <Ring value={s} pre={pre} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="font-semibold text-slate-900 leading-snug">{o.title}</h3>
            {r.status === "nouveau" && <span className="mt-1 w-2 h-2 rounded-full bg-indigo-500 shrink-0" title="Nouvelle" />}
          </div>
          <p className="text-sm text-slate-500 mt-0.5 truncate">
            <span className="font-medium text-slate-700">{o.company || "Entreprise non précisée"}</span>
            {o.location && <> · {o.location}</>}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {r.piste && <span className={`text-[11px] px-2 py-0.5 rounded-md ring-1 ${pisteCls[r.piste]}`}>{pisteLabel[r.piste]}</span>}
            {o.contract && o.contract !== r.piste && <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{o.contract}</span>}
            {sal && <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">{sal}</span>}
            {o.remote && <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Remote</span>}
            <span className="text-[11px] text-slate-400">{o.source} · {ilYa(o.posted_at || r.created_at)}</span>
          </div>
          {r.verdict && <p className="text-sm text-slate-700 mt-2.5">{r.verdict}</p>}
          {raisons.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {raisons.slice(0, ouvert ? 6 : 2).map((x, i) => (
                <li key={i} className="text-xs text-slate-500 flex gap-1.5"><span className="text-indigo-400">›</span><span>{x}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {ouvert && o.description && (
        <div className="px-5 pb-2 -mt-1">
          <p className="text-xs leading-relaxed text-slate-500 bg-slate-50 rounded-xl p-3 max-h-56 overflow-auto whitespace-pre-line">
            {o.description.slice(0, 2500)}{o.description.length > 2500 ? "…" : ""}
          </p>
        </div>
      )}
      <div className="px-4 sm:px-5 pb-4 pt-1 flex flex-wrap gap-2">
        {o.url && (
          <a href={o.url} target="_blank" rel="noreferrer" onClick={onLien}
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition">Voir l'offre ↗</a>
        )}
        <button onClick={onAdapter} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition">Adapter mon CV</button>
        {r.status !== "ajoute"
          ? <button onClick={onSuivi} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 transition">Ajouter au suivi</button>
          : <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">Dans le suivi ✓</span>}
        {r.status === "ignore"
          ? <button onClick={onRestaurer} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700">Restaurer</button>
          : <button onClick={onIgnorer} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-rose-600 transition">Pas pour moi</button>}
      </div>
    </div>
  );
}

// ---------- sources & sites carrières ----------
function Sources({ journal, sites, setSites, setMsg }) {
  const [url, setUrl] = useState("");
  const [nom, setNom] = useState("");
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (url ? parseSiteUrl(url) : null), [url]);

  const dernier = useMemo(() => {
    const m = {};
    for (const j of journal) if (!m[j.source]) m[j.source] = j;
    return m;
  }, [journal]);

  async function tester() {
    setBusy(true); setTest(null);
    try { setTest(await appelRadar("test_site", { site: { company: nom || "Test", ...parsed } })); }
    catch (e) { setTest({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  }
  async function enregistrer() {
    try {
      const s = await ajouterSite({ company: nom.trim(), ats: parsed.ats, config: parsed.config });
      setSites((l) => [...l, s].sort((a, b) => a.company.localeCompare(b.company)));
      setUrl(""); setNom(""); setTest(null);
      setMsg(`${s.company} ajouté — scanné chaque matin.`);
    } catch (e) { setMsg(`Ajout impossible : ${e.message}`); }
  }

  const etat = (j) => {
    if (!j) return ["bg-slate-300", "jamais lancé"];
    if (j.error && /absente/.test(j.error)) return ["bg-amber-400", "clé API à ajouter"];
    if (j.error) return ["bg-rose-500", j.error.slice(0, 80)];
    return ["bg-emerald-500", `${j.fetched} offres · ${ilYa(j.started_at)}`];
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 p-5 rounded-2xl bg-white border border-slate-200">
        <p className="text-sm font-semibold text-slate-800">Agrégateurs</p>
        <p className="text-xs text-slate-400 mb-3">France Travail, Adzuna (19 pays) et Google for Jobs via JSearch (LinkedIn, Indeed, Glassdoor…).</p>
        <ul className="space-y-2">
          {API_SOURCES.map((s) => {
            const [dot, txt] = etat(dernier[s]);
            return (
              <li key={s} className="flex items-center gap-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                <span className="font-medium text-slate-700 w-28">{s}</span>
                <span className="text-xs text-slate-500 truncate">{txt}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
          Les clés se mettent dans Supabase → Edge Functions → Secrets : <code className="text-slate-500">FT_CLIENT_ID</code>, <code className="text-slate-500">FT_CLIENT_SECRET</code>, <code className="text-slate-500">ADZUNA_APP_ID</code>, <code className="text-slate-500">ADZUNA_APP_KEY</code>, <code className="text-slate-500">JSEARCH_API_KEY</code>.
        </p>
      </div>

      <div className="lg:col-span-3 p-5 rounded-2xl bg-white border border-slate-200">
        <p className="text-sm font-semibold text-slate-800">Sites carrières surveillés <span className="text-slate-400 font-normal">({sites.filter((s) => s.enabled).length})</span></p>
        <p className="text-xs text-slate-400 mb-3">Colle l'URL de la page offres d'une boîte (Workday, Greenhouse, Lever, Ashby, SmartRecruiters).</p>
        <div className="space-y-2">
          <input value={url} onChange={(e) => { setUrl(e.target.value); setTest(null); }} placeholder="https://boite.wd3.myworkdayjobs.com/fr-FR/Careers"
            className="w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-indigo-400" />
          <div className="flex gap-2">
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de l'entreprise" className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-indigo-400" />
            <button onClick={tester} disabled={!parsed || busy} className="shrink-0 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">{busy ? "Test…" : "Tester"}</button>
            <button onClick={enregistrer} disabled={!parsed || !nom.trim() || !test?.ok} title={!test?.ok ? "Teste d'abord le site" : ""} className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">Ajouter</button>
          </div>
        </div>
        {url && !parsed && <p className="text-xs text-amber-700 mt-2">URL non reconnue. Ouvre la page « offres » de l'entreprise et copie l'adresse : elle contient souvent myworkdayjobs, greenhouse, lever, ashbyhq ou smartrecruiters.</p>}
        {parsed && !test && <p className="text-xs text-slate-400 mt-2">Détecté : {parsed.ats} · {Object.values(parsed.config).join(" / ")}</p>}
        {test && (test.ok
          ? <div className="text-xs mt-2 p-2.5 rounded-lg bg-emerald-50 text-emerald-800">{test.count} offre(s) data/IA trouvée(s){test.sample?.length ? " — ex. " + test.sample.slice(0, 3).join(" ; ") : ""}</div>
          : <div className="text-xs mt-2 p-2.5 rounded-lg bg-rose-50 text-rose-700">Échec : {test.error}</div>)}

        <ul className="mt-4 divide-y divide-slate-100 max-h-72 overflow-auto">
          {sites.map((s) => {
            const [dot, txt] = etat(dernier[`Carrières · ${s.company}`]);
            return (
              <li key={s.id} className="py-2 flex items-center gap-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full ${s.enabled ? dot : "bg-slate-200"}`} />
                <span className={`font-medium w-32 truncate ${s.enabled ? "text-slate-700" : "text-slate-400"}`}>{s.company}</span>
                <span className="text-[11px] text-slate-400 w-24 truncate hidden sm:block">{s.sector}</span>
                <span className="text-xs text-slate-500 truncate flex-1">{s.enabled ? txt : "en pause"}</span>
                <button onClick={async () => { await majSite(s.id, { enabled: !s.enabled }); setSites((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x))); }}
                  className="text-xs text-slate-400 hover:text-slate-700">{s.enabled ? "Pause" : "Activer"}</button>
                <button onClick={async () => { await supprimerSite(s.id); setSites((l) => l.filter((x) => x.id !== s.id)); }}
                  className="text-slate-300 hover:text-rose-500">✕</button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ---------- onglet principal ----------
export default function Radar({ onAdapter, onSuivi }) {
  const [rows, setRows] = useState([]);
  const [exclues, setExclues] = useState(0);
  const [journal, setJournal] = useState([]);
  const [sites, setSites] = useState([]);
  const [charge, setCharge] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [piste, setPiste] = useState("all");
  const [seuil, setSeuil] = useState(0);
  const [vue, setVue] = useState("a_voir");
  const [q, setQ] = useState("");
  const [ouvert, setOuvert] = useState(null);
  const [nb, setNb] = useState(30);
  const [voirSources, setVoirSources] = useState(false);

  async function recharger() {
    const [o, x, j, s] = await Promise.all([chargerOffres(), compterExclues(), chargerJournal(), chargerSites()]);
    setRows(o); setExclues(x); setJournal(j); setSites(s);
  }
  useEffect(() => { recharger().catch((e) => setMsg(e.message)).finally(() => setCharge(false)); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 6000); return () => clearTimeout(t); }, [msg]);

  async function lancer(action) {
    setBusy(action); setMsg("");
    try {
      const r = await appelRadar(action);
      const sc = r.score ?? {};
      const fetched = Object.values(r.collect ?? {}).reduce((a, b) => a + (b.fetched || 0), 0);
      const parts = [];
      if (r.collect) parts.push(`${fetched} offres collectées`);
      else if (action === "refresh") parts.push("collecte récente (< 3 h), notation seulement");
      parts.push(`${sc.added ?? 0} nouvelles pour toi`);
      if (sc.aiScored) parts.push(`${sc.aiScored} notées par l'IA`);
      if (sc.aiError) parts.push("note IA indisponible pour l'instant (tri par mots-clés en attendant)");
      setMsg(parts.join(" · "));
      await recharger();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(""); }
  }

  const patch = (id, p) => setRows((l) => l.map((r) => (r.offer_id === id ? { ...r, ...p } : r)));
  const statut = async (r, status) => { patch(r.offer_id, { status }); try { await majMatch(r.offer_id, { status }); } catch { /* optimiste */ } };
  const marquerVu = (r) => { if (r.status === "nouveau") statut(r, "vu"); };

  const filtrees = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return rows
      .filter((r) => (vue === "a_voir" ? ["nouveau", "vu"].includes(r.status) : r.status === vue))
      .filter((r) => piste === "all" || r.piste === piste)
      .filter((r) => scoreOf(r) >= seuil)
      .filter((r) => !nq || `${r.job_offers?.title} ${r.job_offers?.company} ${r.job_offers?.location}`.toLowerCase().includes(nq))
      .sort((a, b) => scoreOf(b) - scoreOf(a) || new Date(b.job_offers?.posted_at || b.created_at) - new Date(a.job_offers?.posted_at || a.created_at));
  }, [rows, vue, piste, seuil, q]);

  const actives = rows.filter((r) => ["nouveau", "vu"].includes(r.status));
  const stats = {
    nouvelles: rows.filter((r) => r.status === "nouveau").length,
    top: actives.filter((r) => scoreOf(r) >= 75).length,
    total: actives.length,
    sources: new Set(journal.filter((j) => !j.error && j.fetched > 0).map((j) => j.source)).size,
  };
  const parPiste = (p) => actives.filter((r) => p === "all" || r.piste === p).length;
  const derniere = journal[0]?.started_at;

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white" style={{ background: "#0d0b26" }}>
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(circle, #4f46e5, transparent 70%)" }} />
        <div className="absolute -bottom-28 -left-10 w-72 h-72 rounded-full blur-3xl opacity-40" style={{ background: "radial-gradient(circle, #0891b2, transparent 70%)" }} />
        <div className="absolute -bottom-24 right-24 w-64 h-64 rounded-full blur-3xl opacity-30" style={{ background: "radial-gradient(circle, #db2777, transparent 70%)" }} />
        <div className="relative">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="flex-1">
              <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[.18em] text-indigo-200/80">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Radar d'offres
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mt-2">Les offres faites pour toi</h2>
              <p className="text-sm text-slate-300/90 mt-1.5 max-w-lg">
                IA · data · automatisation — CDI en Île-de-France, international et VIE. Collecte chaque matin, triées selon ton dossier et notées sur ton CV.
              </p>
            </div>
            <div className="flex sm:flex-col gap-2 shrink-0">
              <button onClick={() => lancer("refresh")} disabled={!!busy}
                className="px-4 py-2.5 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-indigo-50 disabled:opacity-60 transition">
                {busy === "refresh" ? "Recherche en cours…" : "Actualiser"}
              </button>
              <button onClick={() => lancer("collect_sites")} disabled={!!busy}
                className="px-4 py-2.5 rounded-xl bg-white/10 ring-1 ring-white/20 text-sm font-medium hover:bg-white/15 disabled:opacity-60 transition">
                {busy === "collect_sites" ? "Scan des sites…" : "Scanner les sites carrières"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6">
            <Stat value={stats.nouvelles} label="nouvelles offres" accent="text-indigo-200" />
            <Stat value={stats.top} label="très bons matchs (75+)" accent="text-emerald-300" />
            <Stat value={stats.total} label="à regarder" />
            <Stat value={exclues} label="écartées automatiquement" accent="text-slate-400" />
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            {derniere ? `Dernière collecte ${ilYa(derniere)} · ${stats.sources} sources actives` : "Aucune collecte pour l'instant"} · prochaine : demain 6 h
          </p>
        </div>
      </div>

      {msg && <div className="px-4 py-3 rounded-xl bg-indigo-50 text-indigo-800 text-sm">{msg}</div>}

      {/* Filtres */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PISTES.map(([id, label]) => (
            <button key={id} onClick={() => { setPiste(id); setNb(30); }}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${piste === id ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {label} <span className={piste === id ? "text-slate-400" : "text-slate-400"}>{parPiste(id)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : titre, entreprise, ville…"
            className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-400" />
          <select value={seuil} onChange={(e) => setSeuil(+e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm cursor-pointer">
            {SEUILS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={vue} onChange={(e) => setVue(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm cursor-pointer">
            {VUES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={() => setVoirSources((v) => !v)} className={`px-3 py-2 rounded-lg text-sm border transition ${voirSources ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}>
            Sources & sites
          </button>
        </div>
      </div>

      {voirSources && <Sources journal={journal} sites={sites} setSites={setSites} setMsg={setMsg} />}

      {/* Liste */}
      {charge ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-2xl bg-white border border-slate-200 animate-pulse" />)}</div>
      ) : filtrees.length === 0 ? (
        <div className="p-10 text-center rounded-2xl border border-dashed border-slate-300 bg-white/50">
          <p className="text-slate-600 font-medium">{rows.length ? "Aucune offre avec ces filtres." : "Pas encore d'offres."}</p>
          <p className="text-sm text-slate-400 mt-1">{rows.length ? "Élargis la piste ou baisse le score minimum." : "Clique sur « Actualiser » ou attends la collecte de demain matin."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtrees.slice(0, nb).map((r) => (
            <OffreCard key={r.offer_id} r={r} ouvert={ouvert === r.offer_id}
              onToggle={() => { setOuvert(ouvert === r.offer_id ? null : r.offer_id); marquerVu(r); }}
              onLien={(e) => { e.stopPropagation(); marquerVu(r); }}
              onAdapter={() => { marquerVu(r); onAdapter(r); }}
              onSuivi={async () => { try { await onSuivi(r); await statut(r, "ajoute"); setMsg("Ajoutée au suivi."); } catch { setMsg("Ajout au suivi impossible."); } }}
              onIgnorer={() => statut(r, "ignore")}
              onRestaurer={() => statut(r, "vu")} />
          ))}
          {filtrees.length > nb && (
            <button onClick={() => setNb(nb + 30)} className="w-full py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50">
              Voir plus ({filtrees.length - nb} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
