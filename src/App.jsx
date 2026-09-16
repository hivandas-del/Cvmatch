import { useState, useEffect, useRef } from "react";
import {
  supabase, callClaude, inscription, connexion, deconnexion,
  chargerCandidatures, ajouterCandidature, majCandidature, supprimerCandidature,
} from "./supabase";
import { extraireTexte } from "./extract";

const STATUTS = ["À postuler", "Envoyée", "Relancée", "Entretien", "Refusée", "Offre"];
const CONTRATS = ["CDI", "VIE", "Graduate Program", "Stage", "Alternance", "CDD"];
const CANAUX = ["—", "LinkedIn", "Mail"];
const statutColor = {
  "À postuler": "bg-slate-100 text-slate-600", Envoyée: "bg-blue-50 text-blue-700",
  Relancée: "bg-amber-50 text-amber-700", Entretien: "bg-violet-50 text-violet-700",
  Refusée: "bg-rose-50 text-rose-700", Offre: "bg-emerald-50 text-emerald-700",
};
const scoreColor = (s) => (s >= 75 ? "#059669" : s >= 50 ? "#d97706" : "#e11d48");
const joursDepuis = (d) => Math.floor((Date.now() - new Date(d)) / 86400000);
const compterMots = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const inputCls = "px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-400";

function Gauge({ score }) {
  const r = 52, c = 2 * Math.PI * r, off = c - (score / 100) * c;
  return (
    <div className="relative w-36 h-36 shrink-0">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="10"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums" style={{ color: scoreColor(score) }}>{score}</span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
    </div>
  );
}

// ---------- Écran de connexion ----------
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("connexion"); // connexion | inscription
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const go = async () => {
    setErr(""); setLoading(true);
    const fn = mode === "connexion" ? connexion : inscription;
    const { error } = await fn(email, password);
    setLoading(false);
    if (error) setErr(mode === "connexion" ? "Email ou mot de passe incorrect." : error.message);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-5">
      <div className="w-full max-w-sm p-6 rounded-2xl bg-white border border-slate-200 text-center">
        <div className="w-11 h-11 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold mx-auto mb-3">M</div>
        <h1 className="text-xl font-bold mb-1">CVMatch</h1>
        <p className="text-slate-500 text-sm mb-5">{mode === "connexion" ? "Connecte-toi à ton suivi." : "Crée ton compte (mot de passe : 6 caractères min)."}</p>
        <div className="space-y-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ton@email.com" className={inputCls + " w-full"} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Mot de passe"
            onKeyDown={(e) => e.key === "Enter" && email && password && go()} className={inputCls + " w-full"} />
          {err && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg p-2 text-left">{err}</p>}
          <button onClick={go} disabled={!email || !password || loading}
            className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition">
            {loading ? "…" : mode === "connexion" ? "Se connecter" : "Créer mon compte"}
          </button>
          <button onClick={() => { setMode(mode === "connexion" ? "inscription" : "connexion"); setErr(""); }}
            className="text-xs text-slate-400 hover:text-slate-600 pt-1">
            {mode === "connexion" ? "Pas encore de compte ? Créer un compte" : "Déjà un compte ? Se connecter"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setPret(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!pret) return <div className="min-h-screen bg-slate-50" />;
  if (!session) return <Login />;
  return <Dashboard userId={session.user.id} email={session.user.email} />;
}

function Dashboard({ userId, email }) {
  const [tab, setTab] = useState("analyse");
  const [cv, setCv] = useState("");
  const [cvNom, setCvNom] = useState("");
  const [cvManuel, setCvManuel] = useState(false);
  const [cvLoading, setCvLoading] = useState(false);
  const cvFileRef = useRef(null);
  const [annonce, setAnnonce] = useState("");
  const [entreprise, setEntreprise] = useState("");
  const [poste, setPoste] = useState("");
  const [contrat, setContrat] = useState("CDI");

  const [analyse, setAnalyse] = useState(null);
  const [refonte, setRefonte] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState("");
  const [err, setErr] = useState("");
  const [copie, setCopie] = useState("");

  const [candidatures, setCandidatures] = useState([]);
  const [fContrat, setFContrat] = useState("Tous");
  const [fStatut, setFStatut] = useState("Tous");
  const [ajoutTexte, setAjoutTexte] = useState("");

  useEffect(() => { chargerCandidatures().then(setCandidatures).catch(() => setErr("Chargement impossible.")); }, []);

  const copier = (txt, id) => { navigator.clipboard.writeText(txt); setCopie(id); setTimeout(() => setCopie(""), 1500); };

  async function choisirCV(e) {
    const f = e.target.files[0];
    if (!f) return;
    setErr(""); setCvLoading(true);
    try {
      const txt = await extraireTexte(f);
      if (!txt) { setErr("CV illisible (peut-être scanné en image). Colle le texte à la main."); setCvManuel(true); }
      else { setCv(txt); setCvNom(f.name); }
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setCvLoading(false); }
  }

  async function run(kind, fn) {
    setErr(""); setLoading(kind);
    try { await fn(); } catch { setErr("Requête échouée. Vérifie les champs, ou que l'IA est bien configurée (clé Anthropic)."); }
    finally { setLoading(""); }
  }

  const lancerAnalyse = () => run("analyse", async () => {
    setAnalyse(null);
    const r = await callClaude(
      "Tu es un expert recrutement et ATS. Réponds UNIQUEMENT avec un objet JSON valide, sans backticks ni texte autour.",
      `Compare ce CV à cette annonce. JSON exact :
{"score":<0-100>,"resume":"<une phrase>","presentes":["<mots-clés du CV qui matchent>"],"manquantes":["<attendus mais absents>"],"conseils":["<3-5 conseils concrets>"]}
CV:\n${cv}\nANNONCE:\n${annonce}`);
    setAnalyse(r);
  });

  const lancerRefonte = () => run("refonte", async () => {
    setRefonte(null); setTab("refonte");
    const r = await callClaude(
      "Tu es un coach CV. Réponds UNIQUEMENT avec un objet JSON valide, sans backticks.",
      `Réécris ce CV pour l'annonce, sans inventer d'expérience. JSON exact :
{"titre":"<titre adapté>","accroche":"<2-3 lignes>","bullets":["<puces résultats + mots-clés>"],"a_ajouter":["<à mettre en avant>"]}
CV:\n${cv}\nANNONCE:\n${annonce}`);
    setRefonte(r);
  });

  const lancerMessage = () => run("message", async () => {
    setMessage(null); setTab("message");
    const r = await callClaude(
      "Tu rédiges des messages LinkedIn de candidat à recruteur. Réponds UNIQUEMENT avec un objet JSON valide, sans backticks.",
      `Rédige un message LinkedIn pour ${entreprise || "l'entreprise"}, poste ${poste || "visé"}.
Contraintes STRICTES : dire que j'ai déjà postulé ; mettre en avant UNE chose précise que j'apporte (déduite du CV et de l'annonce) ; terminer par une question simple ; ton pro et chaleureux ; MOINS DE 90 MOTS.
JSON exact : {"message":"<le message>"}
CV:\n${cv}\nANNONCE:\n${annonce}`);
    setMessage(r);
  });

  async function inserer(obj) {
    const ligne = await ajouterCandidature({ ...obj, user_id: userId });
    setCandidatures((c) => [ligne, ...c]);
  }
  const ajouterDepuisAnalyse = () => inserer({
    entreprise: entreprise || "—", poste: poste || "—", contrat,
    canal: "—", contact: "", statut: "À postuler", score: analyse ? analyse.score : null, source: "manuel",
  });
  const ligneVide = () => inserer({
    entreprise: "—", poste: "—", contrat: "CDI", canal: "—", contact: "", statut: "À postuler", score: null, source: "manuel",
  });
  const ajoutRapide = () => run("ajout", async () => {
    const r = await callClaude(
      "Tu extrais des infos d'offres d'emploi. Réponds UNIQUEMENT avec un objet JSON valide, sans backticks.",
      `Extrais de ce texte : {"entreprise":"<ou —>","poste":"<ou —>","contrat":"<CDI, VIE, Graduate Program, Stage, Alternance ou CDD>"}. Si manque, "—".
TEXTE:\n${ajoutTexte}`);
    await inserer({
      entreprise: r.entreprise || "—", poste: r.poste || "—",
      contrat: CONTRATS.includes(r.contrat) ? r.contrat : "CDI",
      canal: "—", contact: "", statut: "Envoyée", score: null, source: "manuel",
    });
    setAjoutTexte("");
  });

  async function maj(id, k, v) {
    setCandidatures((l) => l.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
    try { await majCandidature(id, { [k]: v }); } catch { setErr("Sauvegarde impossible."); }
  }
  async function supprimer(id) {
    setCandidatures((l) => l.filter((x) => x.id !== id));
    try { await supprimerCandidature(id); } catch { setErr("Suppression impossible."); }
  }

  const aRelancer = candidatures.filter((c) => ["Envoyée", "Relancée"].includes(c.statut) && joursDepuis(c.date_candidature) >= 5);
  const msgRelance = (c) =>
    `Bonjour${c.contact ? " " + c.contact : ""}, je me permets de revenir vers vous concernant ma candidature au poste de ${c.poste} chez ${c.entreprise} (envoyée il y a ${joursDepuis(c.date_candidature)} jours). Je reste très motivé et disponible pour en échanger. Seriez-vous ouvert à un court échange cette semaine ?`;

  const filtrees = candidatures.filter((c) => (fContrat === "Tous" || c.contrat === fContrat) && (fStatut === "Tous" || c.statut === fStatut));
  const tabs = [["analyse", "Analyse"], ["refonte", "Refonte CV"], ["message", "Message LinkedIn"], ["suivi", `Suivi${candidatures.length ? ` (${candidatures.length})` : ""}`]];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="max-w-4xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">M</div>
          <h1 className="text-2xl font-bold tracking-tight">CVMatch</h1>
          <button onClick={deconnexion} className="ml-auto text-xs text-slate-400 hover:text-slate-600">{email} · Déconnexion</button>
        </div>
        <p className="text-slate-500 text-sm mb-6">Analyse ton CV, réécris-le, prépare ton message, suis tes candidatures.</p>

        <div className="flex flex-wrap gap-1 p-1 bg-slate-200/60 rounded-xl mb-6 w-fit">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition ${tab === id ? "bg-white shadow-sm text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
          ))}
        </div>

        {err && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

        {tab === "analyse" && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <input value={entreprise} onChange={(e) => setEntreprise(e.target.value)} placeholder="Entreprise" className={inputCls} />
              <input value={poste} onChange={(e) => setPoste(e.target.value)} placeholder="Poste visé" className={inputCls} />
              <select value={contrat} onChange={(e) => setContrat(e.target.value)} className={inputCls + " cursor-pointer"}>{CONTRATS.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div><label className="text-sm font-medium text-slate-600 mb-1 block">Ton CV</label>
                {!cvManuel ? (
                  <div className="border border-slate-200 rounded-lg bg-white p-6 text-center">
                    <input ref={cvFileRef} type="file" accept=".pdf,.docx,.txt" onChange={choisirCV} className="hidden" />
                    <button onClick={() => cvFileRef.current.click()} disabled={cvLoading}
                      className="px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition">
                      {cvLoading ? "Lecture…" : "Parcourir…"}
                    </button>
                    {cvNom
                      ? <p className="text-xs text-emerald-600 mt-3">✓ {cvNom} chargé</p>
                      : <p className="text-xs text-slate-400 mt-3">PDF, DOCX ou TXT</p>}
                    <button onClick={() => setCvManuel(true)} className="block mx-auto text-xs text-slate-400 hover:text-slate-600 mt-3">ou coller le texte</button>
                  </div>
                ) : (
                  <div>
                    <textarea value={cv} onChange={(e) => setCv(e.target.value)} rows={10} placeholder="Colle ton CV ici…"
                      className="w-full p-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-400 resize-none" />
                    <button onClick={() => setCvManuel(false)} className="text-xs text-slate-400 hover:text-slate-600 mt-1">← revenir au fichier</button>
                  </div>
                )}
              </div>
              <div><label className="text-sm font-medium text-slate-600 mb-1 block">L'annonce</label>
                <textarea value={annonce} onChange={(e) => setAnnonce(e.target.value)} rows={10} placeholder="Colle l'offre ici…" className="w-full p-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-400 resize-none" /></div>
            </div>
            <button onClick={lancerAnalyse} disabled={loading || !cv || !annonce} className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition">
              {loading === "analyse" ? "Analyse en cours…" : "Analyser la compatibilité"}</button>
            {analyse && (
              <div className="mt-2 p-5 rounded-2xl bg-white border border-slate-200 space-y-5">
                <div className="flex flex-col sm:flex-row items-center gap-5"><Gauge score={analyse.score} /><p className="text-slate-600 text-sm leading-relaxed">{analyse.resume}</p></div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><p className="text-sm font-semibold text-emerald-700 mb-2">Points forts</p><div className="flex flex-wrap gap-1.5">{analyse.presentes.map((t, i) => <span key={i} className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs">{t}</span>)}</div></div>
                  <div><p className="text-sm font-semibold text-rose-700 mb-2">Manquant</p><div className="flex flex-wrap gap-1.5">{analyse.manquantes.map((t, i) => <span key={i} className="px-2 py-1 rounded-md bg-rose-50 text-rose-700 text-xs">{t}</span>)}</div></div>
                </div>
                <div><p className="text-sm font-semibold text-slate-700 mb-2">Conseils</p><ul className="space-y-1.5">{analyse.conseils.map((c, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-indigo-500 mt-0.5">→</span><span>{c}</span></li>)}</ul></div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={lancerRefonte} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition">Réécrire mon CV</button>
                  <button onClick={lancerMessage} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition">Rédiger le message LinkedIn</button>
                  <button onClick={ajouterDepuisAnalyse} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition">Ajouter au suivi</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "refonte" && (
          <div>
            {!refonte && loading !== "refonte" && <div className="p-8 text-center text-slate-400 text-sm border border-dashed border-slate-300 rounded-2xl">Lance une analyse puis « Réécrire mon CV ».</div>}
            {loading === "refonte" && <div className="p-8 text-center text-slate-500 text-sm">Réécriture en cours…</div>}
            {refonte && (
              <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-5">
                <div><p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Titre</p><p className="text-lg font-semibold text-slate-800">{refonte.titre}</p></div>
                <div><p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Accroche</p><p className="text-sm text-slate-600 leading-relaxed">{refonte.accroche}</p></div>
                <div><p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Expériences réécrites</p><ul className="space-y-2">{refonte.bullets.map((b, i) => <li key={i} className="text-sm text-slate-700 flex gap-2 p-2.5 rounded-lg bg-slate-50"><span className="text-indigo-500">•</span><span>{b}</span></li>)}</ul></div>
                <div><p className="text-xs uppercase tracking-wide text-slate-400 mb-2">À mettre en avant</p><div className="flex flex-wrap gap-1.5">{refonte.a_ajouter.map((t, i) => <span key={i} className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs">{t}</span>)}</div></div>
              </div>
            )}
          </div>
        )}

        {tab === "message" && (
          <div>
            {!message && loading !== "message" && <div className="p-8 text-center text-slate-400 text-sm border border-dashed border-slate-300 rounded-2xl">Lance une analyse puis « Rédiger le message LinkedIn ».</div>}
            {loading === "message" && <div className="p-8 text-center text-slate-500 text-sm">Rédaction en cours…</div>}
            {message && (
              <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Message ({compterMots(message.message)} mots)</span>
                  <span className={`text-xs px-2 py-0.5 rounded-md ${compterMots(message.message) <= 90 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{compterMots(message.message) <= 90 ? "≤ 90 mots ✓" : "trop long"}</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap p-4 rounded-lg bg-slate-50">{message.message}</p>
                <button onClick={() => copier(message.message, "msg")} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition">{copie === "msg" ? "Copié ✓" : "Copier le message"}</button>
                <p className="text-xs text-slate-400">À toi de l'envoyer depuis LinkedIn — jamais en automatique, c'est ce qui protège ton compte.</p>
              </div>
            )}
          </div>
        )}

        {tab === "suivi" && (
          <div className="space-y-4">
            {aRelancer.length > 0 && (
              <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200">
                <p className="text-sm font-semibold text-amber-800 mb-3">À relancer cette semaine ({aRelancer.length})</p>
                <div className="space-y-3">
                  {aRelancer.map((c) => (
                    <div key={c.id} className="p-3 rounded-lg bg-white border border-amber-100">
                      <p className="text-sm font-medium text-slate-800">{c.contact ? c.contact + " — " : ""}{c.poste} · {c.entreprise}<span className="text-slate-400 font-normal"> · sans réponse depuis {joursDepuis(c.date_candidature)} j</span></p>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{msgRelance(c)}</p>
                      <button onClick={() => copier(msgRelance(c), c.id)} className="mt-2 text-xs px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition">{copie === c.id ? "Copié ✓" : "Copier la relance"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="p-4 rounded-2xl bg-white border border-slate-200">
              <p className="text-sm font-semibold text-slate-700 mb-1">Ajout rapide</p>
              <p className="text-xs text-slate-400 mb-2">Colle le texte de l'offre — l'IA remplit entreprise, poste, contrat et crée la ligne.</p>
              <textarea value={ajoutTexte} onChange={(e) => setAjoutTexte(e.target.value)} rows={3} placeholder="Colle l'offre ici…" className="w-full p-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-400 resize-none mb-2" />
              <button onClick={ajoutRapide} disabled={loading || !ajoutTexte} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition">{loading === "ajout" ? "Extraction…" : "Ajouter automatiquement"}</button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={ligneVide} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition">+ Ligne</button>
              <div className="flex gap-2 ml-auto">
                <select value={fContrat} onChange={(e) => setFContrat(e.target.value)} className={inputCls + " cursor-pointer"}><option>Tous</option>{CONTRATS.map((c) => <option key={c}>{c}</option>)}</select>
                <select value={fStatut} onChange={(e) => setFStatut(e.target.value)} className={inputCls + " cursor-pointer"}><option>Tous</option>{STATUTS.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            {filtrees.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm border border-dashed border-slate-300 rounded-2xl">Aucune candidature. Ajoute une ligne ou utilise l'ajout rapide.</div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-sm min-w-[720px]">
                  <thead><tr className="bg-slate-50 text-slate-500 text-left text-xs">
                    <th className="px-3 py-3 font-medium">Entreprise</th><th className="px-3 py-3 font-medium">Poste</th><th className="px-3 py-3 font-medium">Contrat</th>
                    <th className="px-3 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Canal</th><th className="px-3 py-3 font-medium">Contact</th>
                    <th className="px-3 py-3 font-medium">Statut</th><th className="px-3 py-3 font-medium">Score</th><th className="px-3 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {filtrees.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-3 py-2"><input value={c.entreprise} onChange={(e) => maj(c.id, "entreprise", e.target.value)} className="w-full bg-transparent outline-none font-medium text-slate-800" /></td>
                        <td className="px-3 py-2"><input value={c.poste} onChange={(e) => maj(c.id, "poste", e.target.value)} className="w-full bg-transparent outline-none text-slate-600" /></td>
                        <td className="px-3 py-2"><select value={c.contrat} onChange={(e) => maj(c.id, "contrat", e.target.value)} className="bg-transparent outline-none text-xs text-slate-600 cursor-pointer">{CONTRATS.map((x) => <option key={x}>{x}</option>)}</select></td>
                        <td className="px-3 py-2"><input type="date" value={c.date_candidature} onChange={(e) => maj(c.id, "date_candidature", e.target.value)} className="bg-transparent outline-none text-slate-500 text-xs" /></td>
                        <td className="px-3 py-2"><select value={c.canal} onChange={(e) => maj(c.id, "canal", e.target.value)} className="bg-transparent outline-none text-xs text-slate-600 cursor-pointer">{CANAUX.map((x) => <option key={x}>{x}</option>)}</select></td>
                        <td className="px-3 py-2"><input value={c.contact || ""} onChange={(e) => maj(c.id, "contact", e.target.value)} placeholder="—" className="w-24 bg-transparent outline-none text-slate-600" /></td>
                        <td className="px-3 py-2"><select value={c.statut} onChange={(e) => maj(c.id, "statut", e.target.value)} className={`text-xs px-2 py-1 rounded-md border-0 outline-none cursor-pointer ${statutColor[c.statut]}`}>{STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                        <td className="px-3 py-2 tabular-nums font-medium" style={{ color: c.score != null ? scoreColor(c.score) : "#94a3b8" }}>{c.score != null ? c.score : "—"}</td>
                        <td className="px-3 py-2 text-right"><button onClick={() => supprimer(c.id)} className="text-slate-300 hover:text-rose-500 transition">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-400">Tes candidatures sont enregistrées dans ta base — synchro sur tous tes appareils.</p>
          </div>
        )}
      </div>
    </div>
  );
}
