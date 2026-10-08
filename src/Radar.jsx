import { useEffect, useMemo, useState } from "react";
import {
  chargerOffres, compterExclues, majMatch, chargerJournal, chargerSites, ajouterSite, majSite, supprimerSite, appelRadar,
} from "./supabase";
import { tonScore, LEGENDE } from "./ui";

// ---------- utilitaires ----------
const PISTES = [["all", "Tout"], ["A", "CDI Île-de-France"], ["B", "International"], ["VIE", "VIE"]];
const SEUILS = [[0, "Score"], [50, "50+"], [75, "75+"], [85, "85+"]];
const VUES = [["a_voir", "À regarder"], ["nouveau", "Nouvelles"], ["ajoute", "Ajoutées au suivi"], ["ignore", "Ignorées"]];
const pisteLabel = { A: "CDI IDF", B: "International", VIE: "VIE" };
const API_SOURCES = ["France Travail", "Adzuna", "JSearch"];
// Note affichée : celle du CV adapté si « Adapter mon CV » a tourné, sinon la note IA du CV de base.
const scoreOf = (r) => r.score_cv_adapte ?? r.score ?? r.prescore ?? 0;
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

// ---------- carte offre ----------
// Lien de candidature : l'annonce d'origine, sinon une recherche Google du poste.
const lienPostuler = (o) =>
  o.url || `https://www.google.com/search?q=${encodeURIComponent([o.title, o.company, "candidature"].filter(Boolean).join(" "))}`;

function OffreCard({ r, ouvert, onToggle, onAdapter, onSuivi, onPostule, onIgnorer, onRestaurer, onLien }) {
  const o = r.job_offers ?? {};
  const [vientDePostuler, setVientDePostuler] = useState(false);
  const pre = r.scored_by !== "ia";
  const s = scoreOf(r);
  const t = tonScore(s);
  const sal = salaire(o);
  const raisons = Array.isArray(r.reasons) ? r.reasons : [];
  const resume = r.verdict || raisons[0];
  return (
    <article className="carte p-5 flex flex-col gap-4 min-w-0">
      <button type="button" onClick={onToggle} aria-expanded={ouvert} className="flex gap-3.5 text-left">
        <span className="w-14 h-14 shrink-0 rounded-2xl flex flex-col items-center justify-center leading-none" style={{ background: t.bg, color: t.fg }}
          title={r.score_cv_adapte != null ? `Note IA avec ton CV adapté (CV de base : ${r.score ?? "—"})` : pre ? "Pré-score par mots-clés, en attente de la note IA" : "Note IA de ton CV de base"}>
          <span className="text-[22px] font-bold tabular-nums">{s}</span>
          {r.score_cv_adapte != null
            ? <span className="text-[9.5px] font-semibold uppercase tracking-wider mt-0.5 opacity-80">{r.score != null && r.score_cv_adapte > r.score ? `+${r.score_cv_adapte - r.score} CV` : "CV adapté"}</span>
            : pre && <span className="text-[9.5px] font-semibold uppercase tracking-wider mt-0.5 opacity-80">pré</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className="min-w-0 text-[16.5px] font-semibold leading-snug tracking-[-0.01em] break-words">{o.title}</span>
            {r.status === "nouveau" && <span className="mt-2 w-2 h-2 rounded-full bg-ink shrink-0" title="Nouvelle" />}
          </span>
          <span className="block text-sm text-stone-600 mt-0.5 truncate">{o.company || "Entreprise non précisée"}{o.location && ` · ${o.location}`}</span>
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold" style={{ color: t.fg }}>{t.label}</span>
        {r.piste && <span className="puce bg-stone-100 font-medium">{pisteLabel[r.piste]}</span>}
        {o.contract && o.contract !== r.piste && <span className="puce bg-stone-100">{o.contract}</span>}
        {sal && <span className="puce bg-stone-100">{sal}</span>}
        {o.remote && <span className="puce bg-stone-100">Remote</span>}
      </div>

      {resume && <p className="m-0 text-[14.5px] leading-relaxed text-stone-700">{resume}</p>}

      {ouvert && (
        <div className="flex flex-col gap-3">
          {raisons.length > 0 && (
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
              {raisons.slice(0, 6).map((x, i) => <li key={i} className="text-[13.5px] text-stone-600 flex gap-2"><span className="text-stone-400">→</span><span>{x}</span></li>)}
            </ul>
          )}
          {o.description && (
            <p className="m-0 text-[13px] leading-relaxed text-stone-600 bg-stone-100 rounded-xl p-3.5 max-h-60 overflow-auto whitespace-pre-line break-words">
              {o.description.slice(0, 2500)}{o.description.length > 2500 ? "…" : ""}
            </p>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-baseline gap-3 text-[12.5px] text-stone-500">
          <span className="min-w-0 truncate">{o.source} · {ilYa(o.posted_at || r.created_at)}{(raisons.length > 1 || o.description) && <> · <button onClick={onToggle} className="underline underline-offset-2 hover:text-ink">{ouvert ? "moins" : "détails"}</button></>}</span>
          {r.status === "ignore"
            ? <button onClick={onRestaurer} className="ml-auto shrink-0 hover:text-ink">Restaurer</button>
            : <button onClick={onIgnorer} className="ml-auto shrink-0 hover:text-red-700">Pas pour moi</button>}
        </div>
        <a href={lienPostuler(o)} target="_blank" rel="noreferrer" onClick={(e) => { onLien(e); setVientDePostuler(true); }}
          title={o.url ? "Ouvrir l'annonce pour postuler" : "Lien direct indisponible : recherche de l'annonce"}
          className="btn-noir w-full">
          Postuler{!o.url && <span className="font-normal text-white/60"> · recherche</span>} <span aria-hidden="true">↗</span>
        </a>
        {vientDePostuler && r.status !== "ajoute" && (
          <div role="status" className="flex items-center gap-3 rounded-xl bg-stone-100 p-3 text-[13.5px]">
            <span className="flex-1 min-w-0">C'est envoyé&nbsp;?</span>
            <button onClick={async () => { await onPostule(); setVientDePostuler(false); }} className="btn-noir btn-sm shrink-0">J'ai postulé ✓</button>
            <button onClick={() => setVientDePostuler(false)} aria-label="Pas encore" className="text-stone-500 hover:text-ink shrink-0 px-1">Pas encore</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onAdapter} className="btn-gris btn-sm">Adapter mon CV</button>
          {r.status !== "ajoute"
            ? <button onClick={onSuivi} className="btn-gris btn-sm">Suivre</button>
            : <span className="btn-sm inline-flex items-center justify-center rounded-xl font-semibold bg-green-50 text-green-800">Suivi ✓</span>}
        </div>
      </div>
    </article>
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
      setMsg(`${s.company} ajouté : scanné chaque matin.`);
    } catch (e) { setMsg(`Ajout impossible : ${e.message}`); }
  }

  const etat = (j) => {
    if (!j) return ["bg-stone-300", "jamais lancé"];
    if (j.error && /absente/.test(j.error)) return ["bg-orange-500", "clé API à ajouter"];
    if (j.error) return ["bg-red-600", j.error.slice(0, 80)];
    return ["bg-green-600", `${j.fetched} offres · ${ilYa(j.started_at)}`];
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
      <div className="lg:col-span-2 carte p-5 min-w-0">
        <p className="m-0 text-[15px] font-semibold">Agrégateurs</p>
        <p className="mt-1 mb-4 text-[13px] text-stone-600">France Travail, Adzuna (19 pays) et Google for Jobs via JSearch (LinkedIn, Indeed, Glassdoor…).</p>
        <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
          {API_SOURCES.map((s) => {
            const [dot, txt] = etat(dernier[s]);
            return (
              <li key={s} className="flex items-center gap-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <span className="font-semibold w-28 shrink-0">{s}</span>
                <span className="text-[13px] text-stone-600 truncate">{txt}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 mb-0 text-xs text-stone-500 leading-relaxed">
          Les clés se mettent dans Supabase → Edge Functions → Secrets : <code>FT_CLIENT_ID</code>, <code>FT_CLIENT_SECRET</code>, <code>ADZUNA_APP_ID</code>, <code>ADZUNA_APP_KEY</code>, <code>JSEARCH_API_KEY</code>.
        </p>
      </div>

      <div className="lg:col-span-3 carte p-5 min-w-0">
        <p className="m-0 text-[15px] font-semibold">Sites carrières surveillés <span className="text-stone-500 font-normal">· {sites.filter((s) => s.enabled).length}</span></p>
        <p className="mt-1 mb-4 text-[13px] text-stone-600">Colle l'URL de la page offres d'une entreprise (Workday, Greenhouse, Lever, Ashby, SmartRecruiters).</p>
        <div className="flex flex-col gap-2">
          <input aria-label="URL de la page carrières" value={url} onChange={(e) => { setUrl(e.target.value); setTest(null); }} placeholder="https://boite.wd3.myworkdayjobs.com/fr-FR/Careers" className="champ h-11 text-sm" />
          <div className="flex gap-2">
            <input aria-label="Nom de l'entreprise" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de l'entreprise" className="champ h-11 text-sm flex-1 min-w-0" />
            <button onClick={tester} disabled={!parsed || busy} className="btn-gris btn-sm h-11 shrink-0">{busy ? "Test…" : "Tester"}</button>
            <button onClick={enregistrer} disabled={!parsed || !nom.trim() || !test?.ok} title={!test?.ok ? "Teste d'abord le site" : ""} className="btn-noir btn-sm h-11 shrink-0">Ajouter</button>
          </div>
        </div>
        {url && !parsed && <p className="mt-2 mb-0 text-[13px] text-orange-700">URL non reconnue. Ouvre la page « offres » de l'entreprise et copie l'adresse : elle contient souvent myworkdayjobs, greenhouse, lever, ashbyhq ou smartrecruiters.</p>}
        {parsed && !test && <p className="mt-2 mb-0 text-[13px] text-stone-500">Détecté : {parsed.ats} · {Object.values(parsed.config).join(" / ")}</p>}
        {test && (test.ok
          ? <p className="mt-2 mb-0 text-[13px] p-3 rounded-xl bg-green-50 text-green-800">{test.count} offre(s) data/IA trouvée(s){test.sample?.length ? " — ex. " + test.sample.slice(0, 3).join(" ; ") : ""}</p>
          : <p className="mt-2 mb-0 text-[13px] p-3 rounded-xl bg-red-50 text-red-800">Échec : {test.error}</p>)}

        <ul className="m-0 mt-4 p-0 list-none divide-y divide-stone-100 max-h-72 overflow-auto">
          {sites.map((s) => {
            const [dot, txt] = etat(dernier[`Carrières · ${s.company}`]);
            return (
              <li key={s.id} className="py-2.5 flex items-center gap-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.enabled ? dot : "bg-stone-200"}`} />
                <span className={`font-semibold w-32 shrink-0 truncate ${s.enabled ? "" : "text-stone-400"}`}>{s.company}</span>
                <span className="text-[13px] text-stone-600 truncate flex-1">{s.enabled ? txt : "en pause"}</span>
                <button onClick={async () => { await majSite(s.id, { enabled: !s.enabled }); setSites((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x))); }}
                  className="text-[13px] font-semibold text-stone-500 hover:text-ink shrink-0">{s.enabled ? "Pause" : "Activer"}</button>
                <button onClick={async () => { await supprimerSite(s.id); setSites((l) => l.filter((x) => x.id !== s.id)); }}
                  aria-label={`Retirer ${s.company}`} className="w-7 h-7 rounded-lg text-stone-400 hover:text-red-700 hover:bg-red-50 shrink-0">✕</button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ---------- onglet principal ----------
const selectCls = "h-11 flex-1 sm:flex-none min-w-0 px-3 rounded-xl bg-white text-sm font-semibold cursor-pointer outline-none";

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
      if (r.lots) {
        setMsg(`Scan lancé sur ${r.sites} sites carrières (${r.lots} lots en parallèle) · résultats dans ~1 min`);
        setTimeout(() => recharger().catch(() => {}), 75000);
        return;
      }
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
  const nouvelles = rows.filter((r) => r.status === "nouveau").length;
  const sourcesActives = new Set(journal.filter((j) => !j.error && j.fetched > 0).map((j) => j.source)).size;
  const parPiste = (p) => actives.filter((r) => p === "all" || r.piste === p).length;
  const derniere = journal[0]?.started_at;
  const pl = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  return (
    <div className="flex flex-col gap-6">
      {/* En-tête */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-5 pt-2">
        <div className="flex-1 min-w-0">
          <h1 className="m-0 text-[32px] sm:text-[48px] font-semibold tracking-[-0.04em] leading-[1.02]">
            {nouvelles} nouvelle{nouvelles > 1 ? "s" : ""} offre{nouvelles > 1 ? "s" : ""}.<br />
            <span className="text-stone-500">{actives.length} à regarder.</span>
          </h1>
          <p className="mt-4 mb-0 text-sm text-stone-600">
            {derniere ? `Dernière collecte ${ilYa(derniere)} · ${pl(sourcesActives, "source")} active${sourcesActives > 1 ? "s" : ""}` : "Aucune collecte pour l'instant"} · {pl(exclues, "offre")} écartée{exclues > 1 ? "s" : ""} automatiquement
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-stone-600">
            {LEGENDE.map((l) => <span key={l.texte} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: l.trait }} />{l.texte}</span>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button onClick={() => lancer("refresh")} disabled={!!busy} className="btn-noir">{busy === "refresh" ? "Recherche en cours…" : "Actualiser"}</button>
          <button onClick={() => lancer("collect_sites")} disabled={!!busy} className="btn-blanc">{busy === "collect_sites" ? "Scan des sites…" : "Scanner les sites carrières"}</button>
        </div>
      </div>

      {msg && <div role="status" className="px-4 py-3.5 rounded-xl bg-white text-sm">{msg}</div>}

      {/* Filtres */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
          {PISTES.map(([id, label]) => (
            <button key={id} onClick={() => { setPiste(id); setNb(30); }} aria-pressed={piste === id}
              className={`h-10 px-4 shrink-0 rounded-full text-sm font-semibold transition ${piste === id ? "bg-ink text-white" : "bg-white text-stone-700 hover:text-ink"}`}>
              {label} <span className={piste === id ? "text-white/60" : "text-stone-400"}>{parPiste(id)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" placeholder="Rechercher un titre, une entreprise, une ville…"
            className="h-11 basis-full sm:basis-auto sm:flex-1 min-w-0 px-4 rounded-xl bg-white text-sm outline-none border border-transparent focus:border-ink" />
          <select aria-label="Score minimum" value={seuil} onChange={(e) => setSeuil(+e.target.value)} className={selectCls}>
            {SEUILS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Vue" value={vue} onChange={(e) => setVue(e.target.value)} className={selectCls}>
            {VUES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={() => setVoirSources((v) => !v)} aria-expanded={voirSources}
            className={`h-11 px-4 shrink-0 rounded-xl text-sm font-semibold transition ${voirSources ? "bg-ink text-white" : "bg-white hover:text-ink text-stone-700"}`}>
            Sources<span className="hidden sm:inline"> &amp; sites</span>
          </button>
        </div>
      </div>

      {voirSources && <Sources journal={journal} sites={sites} setSites={setSites} setMsg={setMsg} />}

      {/* Liste */}
      {charge ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-60 carte animate-pulse" />)}</div>
      ) : filtrees.length === 0 ? (
        <div className="carte p-10 text-center">
          <p className="m-0 text-[15px] font-semibold">{rows.length ? "Aucune offre avec ces filtres." : "Pas encore d'offres."}</p>
          <p className="mt-1.5 mb-0 text-sm text-stone-600">{rows.length ? "Élargis la piste ou baisse le score minimum." : "Clique sur « Actualiser » ou attends la collecte de demain matin."}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtrees.slice(0, nb).map((r) => (
              <OffreCard key={r.offer_id} r={r} ouvert={ouvert === r.offer_id}
                onToggle={() => { setOuvert(ouvert === r.offer_id ? null : r.offer_id); marquerVu(r); }}
                onLien={(e) => { e.stopPropagation(); marquerVu(r); }}
                onAdapter={() => { marquerVu(r); onAdapter(r); }}
                onSuivi={async () => { try { await onSuivi(r); await statut(r, "ajoute"); setMsg("Ajoutée au suivi."); } catch { setMsg("Ajout au suivi impossible."); } }}
                onPostule={async () => { try { await onSuivi(r, "Envoyée"); await statut(r, "ajoute"); setMsg("Candidature ajoutée au suivi (Envoyée)."); } catch { setMsg("Ajout au suivi impossible."); } }}
                onIgnorer={() => statut(r, "ignore")}
                onRestaurer={() => statut(r, "vu")} />
            ))}
          </div>
          {filtrees.length > nb && (
            <button onClick={() => setNb(nb + 30)} className="btn-blanc w-full">Voir plus ({filtrees.length - nb} restantes)</button>
          )}
        </>
      )}
    </div>
  );
}
