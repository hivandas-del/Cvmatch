import { useState, useEffect, useRef } from "react";
import {
  supabase, callClaude, inscription, connexion, deconnexion, motDePasseOublie, nouveauMotDePasse,
  chargerCandidatures, ajouterCandidature, majCandidature, supprimerCandidature, chargerProfil,
  creerAdaptation, chargerAdaptations, chargerAdaptation, declencherAdaptation, relancerAdaptation, supprimerAdaptation,
} from "./supabase";
import { extraireTexte } from "./extract";
import Radar from "./Radar";
import Refonte from "./Refonte";
import Profil from "./Profil";
import { tonScore, initiales } from "./ui";

const STATUTS = ["À postuler", "Envoyée", "Relancée", "Entretien", "Refusée", "Offre"];
const CONTRATS = ["CDI", "VIE", "Graduate Program", "Stage", "Alternance", "CDD"];
const CANAUX = ["—", "LinkedIn", "Mail"];
const statutColor = {
  "À postuler": "bg-stone-100 text-stone-700", Envoyée: "bg-blue-50 text-blue-800",
  Relancée: "bg-amber-50 text-amber-800", Entretien: "bg-violet-50 text-violet-800",
  Refusée: "bg-red-50 text-red-800", Offre: "bg-green-50 text-green-800",
};
const joursDepuis = (d) => Math.floor((Date.now() - new Date(d)) / 86400000);
const compterMots = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

// ---------- icônes (trait) ----------
const Ico = ({ d, size = 20, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
);
export const IcoFleche = (p) => <Ico {...p} d="M5 12h14M13 6l6 6-6 6" />;
const IcoProfil = (p) => <Ico {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Ico>;
const IcoOffres = (p) => <Ico {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></Ico>;
const IcoAnalyse = (p) => <Ico {...p} d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" />;
const IcoCV = (p) => <Ico {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></Ico>;
const IcoMessage = (p) => <Ico {...p} d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const IcoSuivi = (p) => <Ico {...p}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></Ico>;

// ---------- logo (piste Radar) ----------
const LogoRadar = ({ size = 18, fond = "#F5F5F4" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
    <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="10" />
    <circle cx="50" cy="50" r="18" fill="none" stroke="currentColor" strokeWidth="10" />
    <circle cx="76.9" cy="23.1" r="11" fill="currentColor" stroke={fond} strokeWidth="7" />
  </svg>
);
const Logo = ({ fond }) => (
  <span className="inline-flex items-center gap-2 text-[13px] font-bold tracking-[0.08em] uppercase">
    <LogoRadar fond={fond} />CVMatch
  </span>
);

function Gauge({ score }) {
  const t = tonScore(score);
  const r = 52, c = 2 * Math.PI * r, off = c - (score / 100) * c;
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#F5F5F4" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={t.trait} strokeWidth="10"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums tracking-tight" style={{ color: t.fg }}>{score}</span>
        <span className="text-xs font-semibold" style={{ color: t.fg }}>{t.label}</span>
      </div>
    </div>
  );
}

// ---------- erreurs Auth en clair ----------
function messageErreur(error) {
  const m = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid_credentials")) return "Email ou mot de passe incorrect. Mot de passe oublié ? Clique sur le lien au-dessus du champ.";
  if (m.includes("not confirmed")) return "Ton email n'est pas encore confirmé : clique sur le lien reçu par mail.";
  if (m.includes("rate limit") || m.includes("for security purposes")) return "Trop de tentatives : attends une minute avant de réessayer.";
  if (m.includes("password") && m.includes("6")) return "Mot de passe trop court (6 caractères minimum).";
  return error?.message || "Une erreur est survenue.";
}

// ---------- présentation (moitié gauche de la connexion) ----------
function Presentation() {
  const exemples = [
    { s: 88, t: "Consultant·e AI & Data Platform", b: "Wavestone · Puteaux" },
    { s: 58, t: "AI Project Manager", b: "Devoteam · Levallois" },
  ];
  return (
    <section className="carte p-6 sm:p-10 lg:p-12 flex flex-col gap-6 lg:justify-between lg:min-h-[calc(100vh-48px)]">
      <Logo fond="#FFFFFF" />
      <div className="flex flex-col gap-5 lg:gap-7">
        <h1 className="m-0 text-[30px] sm:text-[48px] lg:text-[56px] font-semibold tracking-[-0.04em] leading-none">Le bon poste.<br />Sans chercher.</h1>
        <p className="m-0 text-[15px] sm:text-[17px] text-stone-600 leading-relaxed max-w-md">
          Chaque matin, CVMatch rassemble les offres IA &amp; data de 23 sources, écarte ce qui ne te correspond pas et note le reste selon ton CV.
        </p>
        <div className="hidden sm:flex flex-col gap-3">
          {exemples.map((e) => {
            const t = tonScore(e.s);
            return (
              <div key={e.t} className="flex items-center gap-3.5 rounded-2xl bg-stone-100 px-4 py-3.5">
                <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-base font-bold" style={{ background: t.bg, color: t.fg }}>{e.s}</span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold truncate">{e.t}</div>
                  <div className="text-[13px] text-stone-600">{e.b} · <span style={{ color: t.fg }} className="font-semibold">{t.label.toLowerCase()}</span></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex sm:hidden gap-2 flex-wrap">
          {[88, 58, 34].map((s) => { const t = tonScore(s); return <span key={s} className="puce font-semibold" style={{ background: t.bg, color: t.fg }}>{s} {t.label.toLowerCase().replace(" match", "")}</span>; })}
        </div>
      </div>
      <div className="hidden sm:flex gap-7 text-sm text-stone-600">
        <span><b className="text-ink font-semibold">23</b> sources</span>
        <span><b className="text-ink font-semibold">6 h</b> chaque matin</span>
        <span><b className="text-ink font-semibold">1 clic</b> pour adapter ton CV</span>
      </div>
    </section>
  );
}

// ---------- connexion / inscription / mot de passe oublié ----------
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("connexion"); // connexion | inscription | oubli
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const changer = (m) => { setMode(m); setErr(""); setInfo(""); };
  const go = async (e) => {
    e?.preventDefault();
    setErr(""); setInfo(""); setLoading(true);
    try {
      if (mode === "connexion") {
        const { error } = await connexion(email, password);
        if (error) setErr(messageErreur(error));
      } else if (mode === "inscription") {
        const { data, error } = await inscription(email, password);
        if (error) setErr(messageErreur(error));
        // Email déjà utilisé : Supabase renvoie un faux utilisateur sans identité, sans erreur.
        else if (data.user && (data.user.identities ?? []).length === 0) { setErr("Un compte existe déjà avec cet email : connecte-toi, ou utilise « Mot de passe oublié »."); setMode("connexion"); }
        else if (!data.session) setInfo("Compte créé ! Clique sur le lien reçu par mail pour l'activer, puis reviens ici.");
      } else {
        const { error } = await motDePasseOublie(email);
        if (error) setErr(messageErreur(error));
        else setInfo("Si un compte existe, un mail vient de partir. Ouvre le lien sur cet appareil pour choisir un nouveau mot de passe.");
      }
    } finally { setLoading(false); }
  };

  const titres = {
    connexion: ["Content de te revoir", "Tes nouvelles offres t'attendent."],
    inscription: ["Crée ton compte", "Reçois chaque matin les offres faites pour toi."],
    oubli: ["Mot de passe oublié", "Entre ton email : tu recevras un lien pour en choisir un nouveau."],
  }[mode];
  const pret = email && (mode === "oubli" || password);

  return (
    <div className="min-h-screen bg-stone-100 p-4 sm:p-6 lg:grid lg:grid-cols-2 lg:gap-6">
      <Presentation />
      <section className="flex items-center justify-center py-8 lg:py-0">
        <form onSubmit={go} className="w-full max-w-[400px] flex flex-col gap-6">
          {mode !== "oubli" && (
            <div role="tablist" aria-label="Connexion ou inscription" className="grid grid-cols-2 p-1 rounded-2xl bg-stone-200">
              {[["connexion", "Connexion"], ["inscription", "Inscription"]].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => changer(id)}
                  className={`h-11 rounded-xl text-[15px] font-semibold transition ${mode === id ? "bg-white text-ink shadow-sm" : "text-stone-600 hover:text-ink"}`}>{label}</button>
              ))}
            </div>
          )}
          <div>
            <h2 className="m-0 text-[28px] sm:text-[30px] font-semibold tracking-[-0.03em]">{titres[0]}</h2>
            <p className="mt-2 mb-0 text-[15px] text-stone-600">{titres[1]}</p>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="etiquette">Email</label>
              <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="ton@email.com" className="champ" />
            </div>
            {mode !== "oubli" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-baseline">
                  <label htmlFor="pwd" className="etiquette">Mot de passe</label>
                  {mode === "connexion" && <button type="button" onClick={() => changer("oubli")} className="text-[13.5px] underline underline-offset-[3px] hover:text-stone-600">Mot de passe oublié ?</button>}
                </div>
                <input id="pwd" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={mode === "inscription" ? "6 caractères minimum" : ""}
                  autoComplete={mode === "connexion" ? "current-password" : "new-password"} className="champ" />
              </div>
            )}
          </div>
          {err && <p role="alert" className="m-0 text-sm rounded-xl p-3.5 bg-red-50 text-red-800">{err}</p>}
          {info && <p role="status" className="m-0 text-sm rounded-xl p-3.5 bg-green-50 text-green-800">{info}</p>}
          <button type="submit" disabled={!pret || loading} className="btn-noir h-[54px] text-base rounded-2xl">
            {loading ? "…" : { connexion: "Se connecter", inscription: "Créer mon compte", oubli: "Recevoir le lien" }[mode]}
            {!loading && <IcoFleche size={18} />}
          </button>
          {mode === "oubli"
            ? <button type="button" onClick={() => changer("connexion")} className="text-sm text-stone-600 hover:text-ink">← Revenir à la connexion</button>
            : <p className="m-0 text-center text-[13px] text-stone-600">Tes données restent privées · synchronisé sur ordi et téléphone</p>}
        </form>
      </section>
    </div>
  );
}

// ---------- après le lien « mot de passe oublié » ----------
function NouveauMotDePasse({ onFini }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const valider = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    const { error } = await nouveauMotDePasse(pwd);
    setLoading(false);
    if (error) setErr(messageErreur(error)); else onFini();
  };
  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
      <form onSubmit={valider} className="carte w-full max-w-[420px] p-6 sm:p-8 flex flex-col gap-5">
        <Logo fond="#FFFFFF" />
        <div>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.03em]">Nouveau mot de passe</h1>
          <p className="mt-2 mb-0 text-[15px] text-stone-600">Choisis-en un nouveau (6 caractères minimum).</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="npwd" className="etiquette">Nouveau mot de passe</label>
          <input id="npwd" value={pwd} onChange={(e) => setPwd(e.target.value)} type="password" autoComplete="new-password" className="champ" />
        </div>
        {err && <p role="alert" className="m-0 text-sm rounded-xl p-3.5 bg-red-50 text-red-800">{err}</p>}
        <button type="submit" disabled={pwd.length < 6 || loading} className="btn-noir h-[54px] text-base rounded-2xl">{loading ? "…" : "Enregistrer"}</button>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [pret, setPret] = useState(false);
  const [recup, setRecup] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setPret(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "PASSWORD_RECOVERY") setRecup(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!pret) return <div className="min-h-screen bg-stone-100" />;
  if (recup && session) return <NouveauMotDePasse onFini={() => setRecup(false)} />;
  if (!session) return <Login />;
  return <Dashboard userId={session.user.id} email={session.user.email} />;
}

// ---------- vide / chargement ----------
const Vide = ({ children }) => (
  <div className="carte p-10 text-center text-[15px] text-stone-600">{children}</div>
);

function Dashboard({ userId, email }) {
  const [tab, setTab] = useState("radar");
  const [menu, setMenu] = useState(false);
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
  const [adaptations, setAdaptations] = useState([]);
  const [courante, setCourante] = useState(null);
  const [raisons, setRaisons] = useState({});
  const [adaptChargement, setAdaptChargement] = useState(true);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState("");
  const [err, setErr] = useState("");
  const [copie, setCopie] = useState("");

  const [candidatures, setCandidatures] = useState([]);
  const [fContrat, setFContrat] = useState("Tous");
  const [fStatut, setFStatut] = useState("Tous");
  const [ajoutTexte, setAjoutTexte] = useState("");

  useEffect(() => { chargerCandidatures().then(setCandidatures).catch(() => setErr("Chargement impossible.")); }, []);
  // Le CV du profil sert de CV par défaut partout (Analyse, Adapter mon CV) ; sans profil, on commence par là.
  useEffect(() => {
    chargerProfil().then((p) => {
      if (p?.cv_text) { setCv((c) => c || p.cv_text); setCvNom((n) => n || "CV de ton profil"); }
      else setTab((t) => (t === "radar" ? "profil" : t));
    }).catch(() => {});
  }, []);
  const majProfil = (p) => { if (p?.cv_text) { setCv(p.cv_text); setCvNom(p.cv_fichier || "CV de ton profil"); } };
  useEffect(() => {
    chargerAdaptations().then(setAdaptations).catch(() => {}).finally(() => setAdaptChargement(false));
  }, []);

  // Tant qu'une adaptation tourne, on relit sa ligne toutes les 4 s (la tâche Claude écrit le résultat en base).
  const enCours = adaptations.filter((a) => a.statut === "en_attente" || a.statut === "en_cours").map((a) => a.id).join(",");
  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(async () => {
      const maj = await Promise.all(enCours.split(",").map((id) => chargerAdaptation(id).catch(() => null)));
      setAdaptations((l) => l.map((a) => maj.find((m) => m?.id === a.id) || a));
    }, 4000);
    return () => clearInterval(t);
  }, [enCours]);

  const aller = (t) => { setTab(t); setMenu(false); window.scrollTo({ top: 0 }); };
  // Menu compte : se ferme au clic à côté ou avec Échap.
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const clic = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", clic);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", clic); document.removeEventListener("keydown", esc); };
  }, [menu]);
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

  // ---------- Adapter mon CV : file d'attente + tâche Claude (abonnement) ----------
  async function declencher(id) {
    const r = await declencherAdaptation(id);
    setRaisons((m) => ({ ...m, [id]: r.declenche ? "ok" : r.raison }));
    if (r.session_url) setAdaptations((l) => l.map((a) => (a.id === id ? { ...a, session_url: r.session_url } : a)));
  }
  async function adapter({ offer_id = null, entreprise: ent, poste: pos, annonce: ann, cvTexte }) {
    setErr("");
    let texteCV = cvTexte || cv;
    if (!texteCV) {
      const p = await chargerProfil().catch(() => null);
      texteCV = p?.cv_text || "";
      if (texteCV) { setCv(texteCV); setCvNom("CV de ton profil"); }
    }
    if (!texteCV) { setErr("Ajoute d'abord ton CV dans Mon profil (icône en haut à droite)."); aller("profil"); return; }
    if (!ann?.trim()) { setErr("L'annonce est vide : colle-la dans l'onglet Analyse."); aller("analyse"); return; }
    try {
      const a = await creerAdaptation({ offer_id, entreprise: ent || null, poste: pos || null, annonce: ann, cv_text: texteCV });
      setAdaptations((l) => [a, ...l]);
      setCourante(a.id);
      aller("refonte");
      await declencher(a.id);
    } catch { setErr("Impossible d'enregistrer la demande d'adaptation."); }
  }
  const lancerRefonte = () => adapter({ entreprise, poste, annonce });
  async function relancer(id) {
    setAdaptations((l) => l.map((a) => (a.id === id ? { ...a, statut: "en_attente", erreur: null, created_at: new Date().toISOString() } : a)));
    try { await relancerAdaptation(id); await declencher(id); } catch { setErr("Relance impossible."); }
  }
  async function supprimerAdapt(id) {
    setAdaptations((l) => l.filter((a) => a.id !== id));
    if (courante === id) setCourante(null);
    try { await supprimerAdaptation(id); } catch { setErr("Suppression impossible."); }
  }

  const lancerMessage = () => run("message", async () => {
    setMessage(null); aller("message");
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

  // ---------- passerelles depuis le radar ----------
  const contratDe = (c) => (CONTRATS.includes(c) ? c : "CDI");
  async function adapterDepuisRadar(r) {
    const o = r.job_offers ?? {};
    setEntreprise(o.company || ""); setPoste(o.title || ""); setContrat(contratDe(o.contract));
    setAnnonce([o.title, [o.company, o.location].filter(Boolean).join(" — "), "", o.description || ""].join("\n"));
    setAnalyse(null); setMessage(null);
    const ann = [o.title, [o.company, o.location].filter(Boolean).join(" — "), "", o.description || ""].join("\n");
    // Le CV du profil (celui du radar) sert de base, sauf si un autre CV est déjà chargé.
    await adapter({ offer_id: r.offer_id, entreprise: o.company, poste: o.title, annonce: ann });
  }
  const suivreDepuisRadar = (r, statut = "À postuler") => {
    const o = r.job_offers ?? {};
    return inserer({
      entreprise: o.company || "—", poste: o.title || "—", contrat: contratDe(o.contract),
      canal: "—", contact: "", statut, score: r.score ?? null, source: "radar",
    });
  };
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
  const tabs = [
    { id: "radar", label: "Offres", court: "Offres", Icon: IcoOffres },
    { id: "analyse", label: "Analyse", court: "Analyse", Icon: IcoAnalyse },
    { id: "refonte", label: "Refonte CV", court: "CV", Icon: IcoCV },
    { id: "message", label: "Message", court: "Message", Icon: IcoMessage },
    { id: "suivi", label: "Suivi", court: "Suivi", Icon: IcoSuivi, n: candidatures.length },
  ];
  const titrePage = (t, s) => (
    <div className="mb-6">
      <h1 className="m-0 text-[30px] sm:text-[40px] font-semibold tracking-[-0.04em] leading-none">{t}</h1>
      {s && <p className="mt-3 mb-0 text-[15px] text-stone-600">{s}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-stone-100 text-ink pb-24 md:pb-10">
      {/* En-tête */}
      <header className="no-print sticky top-0 z-30 bg-stone-100/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 md:h-20 flex items-center gap-4">
          <button onClick={() => aller("radar")} className="md:w-48 text-left" aria-label="CVMatch, accueil"><Logo /></button>
          <nav aria-label="Principal" className="hidden md:flex mx-auto gap-1 p-1 rounded-2xl bg-white">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => aller(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={`h-10 px-4 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${tab === t.id ? "bg-ink text-white" : "text-stone-600 hover:text-ink"}`}>
                {t.label}{t.n ? <span className={`text-[11px] px-1.5 rounded-full ${tab === t.id ? "bg-white/20" : "bg-stone-100"}`}>{t.n}</span> : null}
              </button>
            ))}
          </nav>
          <div ref={menuRef} className="ml-auto md:ml-0 md:w-48 flex justify-end relative">
            <button onClick={() => setMenu((m) => !m)} aria-label="Mon compte" aria-expanded={menu} aria-haspopup="menu"
              title="Mon compte"
              className={`w-10 h-10 rounded-full flex items-center justify-center transition ${tab === "profil" ? "bg-ink text-white" : "bg-white text-ink hover:bg-stone-200"}`}>
              <IcoProfil size={20} />
            </button>
            {menu && (<>
              <div role="menu" className="absolute right-0 top-12 w-64 carte p-2 shadow-lg z-40">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-9 h-9 shrink-0 rounded-full bg-stone-100 flex items-center justify-center text-[12px] font-bold">{initiales(email)}</span>
                  <p className="m-0 text-[13px] text-stone-600 truncate">{email}</p>
                </div>
                <div className="h-px bg-stone-200 mx-2 my-1" />
                <button role="menuitem" onClick={() => aller("profil")}
                  className={`w-full text-left px-3 h-11 rounded-xl text-sm font-semibold flex items-center gap-2.5 ${tab === "profil" ? "bg-stone-100" : "hover:bg-stone-100"}`}>
                  <IcoProfil size={18} />Mon profil
                </button>
                <button role="menuitem" onClick={deconnexion} className="w-full text-left px-3 h-11 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 hover:text-ink">Se déconnecter</button>
              </div>
            </>)}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 pt-2">
        {err && <div role="alert" className="mb-5 px-4 py-3.5 rounded-xl bg-red-50 text-red-800 text-sm">{err}</div>}

        {tab === "profil" && <Profil onAller={aller} onProfil={majProfil} />}
        {tab === "radar" && <Radar onAdapter={adapterDepuisRadar} onSuivi={suivreDepuisRadar} />}

        {tab === "analyse" && (
          <div className="flex flex-col gap-5">
            {titrePage("Analyse", "Compare ton CV à une offre et vois ce qui colle ou ce qui manque.")}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5"><label htmlFor="ent" className="etiquette">Entreprise</label><input id="ent" value={entreprise} onChange={(e) => setEntreprise(e.target.value)} className="champ" /></div>
              <div className="flex flex-col gap-1.5"><label htmlFor="pos" className="etiquette">Poste visé</label><input id="pos" value={poste} onChange={(e) => setPoste(e.target.value)} className="champ" /></div>
              <div className="flex flex-col gap-1.5"><label htmlFor="ctr" className="etiquette">Contrat</label>
                <select id="ctr" value={contrat} onChange={(e) => setContrat(e.target.value)} className="champ cursor-pointer">{CONTRATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="etiquette">Ton CV</span>
                {!cvManuel ? (
                  <div className="carte p-6 text-center flex flex-col items-center gap-3 min-h-[220px] justify-center">
                    <input ref={cvFileRef} type="file" accept=".pdf,.docx,.txt" onChange={choisirCV} className="hidden" />
                    <button onClick={() => cvFileRef.current.click()} disabled={cvLoading} className="btn-noir">
                      {cvLoading ? "Lecture…" : "Choisir un fichier"}
                    </button>
                    {cvNom ? <p className="m-0 text-sm font-semibold text-green-700">✓ {cvNom}</p> : <p className="m-0 text-sm text-stone-600">PDF, DOCX ou TXT</p>}
                    <button onClick={() => setCvManuel(true)} className="text-sm text-stone-600 underline underline-offset-[3px] hover:text-ink">ou coller le texte</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <textarea value={cv} onChange={(e) => setCv(e.target.value)} rows={9} placeholder="Colle ton CV ici…" className="zone" aria-label="Texte du CV" />
                    <button onClick={() => setCvManuel(false)} className="self-start text-sm text-stone-600 hover:text-ink">← revenir au fichier</button>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ann" className="etiquette">L'annonce</label>
                <textarea id="ann" value={annonce} onChange={(e) => setAnnonce(e.target.value)} rows={9} placeholder="Colle l'offre ici…" className="zone" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={lancerRefonte} disabled={!annonce} className="btn-noir">Adapter mon CV</button>
              <button onClick={lancerAnalyse} disabled={loading || !cv || !annonce} className="btn-gris">
                {loading === "analyse" ? "Analyse en cours…" : "Analyser la compatibilité"}
              </button>
            </div>
            {analyse && (
              <div className="carte p-5 sm:p-7 flex flex-col gap-6">
                <div className="flex flex-col sm:flex-row items-center gap-5"><Gauge score={analyse.score} /><p className="m-0 text-[15px] leading-relaxed">{analyse.resume}</p></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div><p className="m-0 mb-2.5 text-sm font-semibold">Points forts</p><div className="flex flex-wrap gap-1.5">{analyse.presentes.map((t, i) => <span key={i} className="puce bg-green-50 text-green-800">{t}</span>)}</div></div>
                  <div><p className="m-0 mb-2.5 text-sm font-semibold">Manquant</p><div className="flex flex-wrap gap-1.5">{analyse.manquantes.map((t, i) => <span key={i} className="puce bg-red-50 text-red-800">{t}</span>)}</div></div>
                </div>
                <div><p className="m-0 mb-2.5 text-sm font-semibold">Conseils</p><ul className="m-0 p-0 list-none flex flex-col gap-2">{analyse.conseils.map((c, i) => <li key={i} className="text-[15px] flex gap-2.5"><span className="text-stone-400">→</span><span>{c}</span></li>)}</ul></div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={lancerRefonte} className="btn-noir">Réécrire mon CV</button>
                  <button onClick={lancerMessage} className="btn-gris">Rédiger le message LinkedIn</button>
                  <button onClick={ajouterDepuisAnalyse} className="btn-gris">Ajouter au suivi</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "refonte" && (
          <Refonte adaptations={adaptations} courante={courante} raisons={raisons} chargement={adaptChargement}
            onChoisir={setCourante} onRelancer={relancer} onSupprimer={supprimerAdapt} onAller={aller} />
        )}

        {tab === "message" && (
          <div>
            {titrePage("Message LinkedIn", "Un message court pour relancer le recruteur après ta candidature.")}
            {!message && loading !== "message" && <Vide>Lance une analyse puis « Rédiger le message LinkedIn ».</Vide>}
            {loading === "message" && <Vide>Rédaction en cours…</Vide>}
            {message && (
              <div className="carte p-5 sm:p-7 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold tracking-[0.06em] uppercase text-stone-600">Message · {compterMots(message.message)} mots</span>
                  <span className={`puce font-semibold ${compterMots(message.message) <= 90 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{compterMots(message.message) <= 90 ? "≤ 90 mots ✓" : "trop long"}</span>
                </div>
                <p className="m-0 text-[15px] leading-relaxed whitespace-pre-wrap p-4 rounded-xl bg-stone-100">{message.message}</p>
                <button onClick={() => copier(message.message, "msg")} className="btn-noir self-start">{copie === "msg" ? "Copié ✓" : "Copier le message"}</button>
                <p className="m-0 text-[13px] text-stone-600">À toi de l'envoyer depuis LinkedIn — jamais en automatique, c'est ce qui protège ton compte.</p>
              </div>
            )}
          </div>
        )}

        {tab === "suivi" && (
          <div className="flex flex-col gap-5">
            {titrePage("Suivi", `${candidatures.length} candidature${candidatures.length > 1 ? "s" : ""} · synchronisé sur tous tes appareils.`)}
            {aRelancer.length > 0 && (
              <div className="carte p-5">
                <p className="m-0 mb-3 text-[15px] font-semibold">À relancer cette semaine <span className="puce bg-amber-50 text-amber-800 ml-1">{aRelancer.length}</span></p>
                <div className="flex flex-col gap-3">
                  {aRelancer.map((c) => (
                    <div key={c.id} className="p-4 rounded-xl bg-stone-100">
                      <p className="m-0 text-[15px] font-semibold">{c.contact ? c.contact + " — " : ""}{c.poste} · {c.entreprise}<span className="text-stone-600 font-normal"> · sans réponse depuis {joursDepuis(c.date_candidature)} j</span></p>
                      <p className="mt-1.5 mb-0 text-sm text-stone-600 leading-relaxed">{msgRelance(c)}</p>
                      <button onClick={() => copier(msgRelance(c), c.id)} className="btn-noir btn-sm mt-3">{copie === c.id ? "Copié ✓" : "Copier la relance"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="carte p-5 flex flex-col gap-3">
              <div><p className="m-0 text-[15px] font-semibold">Ajout rapide</p><p className="mt-1 mb-0 text-sm text-stone-600">Colle le texte de l'offre : l'IA remplit entreprise, poste et contrat.</p></div>
              <textarea value={ajoutTexte} onChange={(e) => setAjoutTexte(e.target.value)} rows={3} placeholder="Colle l'offre ici…" className="zone" aria-label="Texte de l'offre" />
              <button onClick={ajoutRapide} disabled={loading || !ajoutTexte} className="btn-noir self-start">{loading === "ajout" ? "Extraction…" : "Ajouter automatiquement"}</button>
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={ligneVide} className="btn-blanc btn-sm shrink-0">+ Ligne</button>
              <div className="flex gap-2 ml-auto min-w-0">
                <select aria-label="Filtrer par contrat" value={fContrat} onChange={(e) => setFContrat(e.target.value)} className="h-10 min-w-0 px-3 rounded-xl bg-white text-sm font-semibold cursor-pointer"><option>Tous</option>{CONTRATS.map((c) => <option key={c}>{c}</option>)}</select>
                <select aria-label="Filtrer par statut" value={fStatut} onChange={(e) => setFStatut(e.target.value)} className="h-10 min-w-0 px-3 rounded-xl bg-white text-sm font-semibold cursor-pointer"><option>Tous</option>{STATUTS.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            {filtrees.length === 0 ? (
              <Vide>Aucune candidature. Ajoute une ligne, utilise l'ajout rapide ou « Ajouter au suivi » depuis une offre.</Vide>
            ) : (<>
              {/* Mobile : une carte par candidature */}
              <ul className="md:hidden m-0 p-0 list-none flex flex-col gap-2.5">
                {filtrees.map((c) => {
                  const t = tonScore(c.score);
                  return (
                    <li key={c.id} className="carte p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        {c.score != null
                          ? <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-base font-bold tabular-nums" style={{ background: t.bg, color: t.fg }}>{c.score}</span>
                          : <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center bg-stone-100 text-stone-400">—</span>}
                        <div className="min-w-0 flex-1">
                          <input aria-label="Entreprise" value={c.entreprise} onChange={(e) => maj(c.id, "entreprise", e.target.value)} className="w-full bg-transparent outline-none text-[15px] font-semibold" />
                          <input aria-label="Poste" value={c.poste} onChange={(e) => maj(c.id, "poste", e.target.value)} className="w-full bg-transparent outline-none text-sm text-stone-600" />
                        </div>
                        <button onClick={() => supprimer(c.id)} aria-label="Supprimer" className="w-8 h-8 shrink-0 rounded-lg text-stone-400 hover:text-red-700 hover:bg-red-50">✕</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select aria-label="Statut" value={c.statut} onChange={(e) => maj(c.id, "statut", e.target.value)} className={`h-9 text-[13px] font-semibold px-3 rounded-full border-0 outline-none cursor-pointer ${statutColor[c.statut]}`}>{STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                        <select aria-label="Contrat" value={c.contrat} onChange={(e) => maj(c.id, "contrat", e.target.value)} className="h-9 px-3 rounded-full bg-stone-100 text-[13px] outline-none cursor-pointer">{CONTRATS.map((x) => <option key={x}>{x}</option>)}</select>
                        <input aria-label="Date" type="date" value={c.date_candidature} onChange={(e) => maj(c.id, "date_candidature", e.target.value)} className="h-9 px-3 rounded-full bg-stone-100 text-[13px] outline-none" />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden md:block overflow-x-auto carte">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="text-left text-xs font-semibold tracking-[0.04em] uppercase text-stone-600 border-b border-stone-200">
                    <th className="px-4 py-3.5">Entreprise</th><th className="px-3 py-3.5">Poste</th><th className="px-3 py-3.5">Contrat</th>
                    <th className="px-3 py-3.5">Date</th><th className="px-3 py-3.5">Canal</th><th className="px-3 py-3.5">Contact</th>
                    <th className="px-3 py-3.5">Statut</th><th className="px-3 py-3.5">Score</th><th className="px-3 py-3.5"><span className="sr-only">Supprimer</span></th>
                  </tr></thead>
                  <tbody>
                    {filtrees.map((c) => {
                      const t = tonScore(c.score);
                      return (
                        <tr key={c.id} className="border-t border-stone-100">
                          <td className="px-4 py-2.5"><input aria-label="Entreprise" value={c.entreprise} onChange={(e) => maj(c.id, "entreprise", e.target.value)} className="w-full bg-transparent outline-none font-semibold" /></td>
                          <td className="px-3 py-2.5"><input aria-label="Poste" value={c.poste} onChange={(e) => maj(c.id, "poste", e.target.value)} className="w-full bg-transparent outline-none text-stone-700" /></td>
                          <td className="px-3 py-2.5"><select aria-label="Contrat" value={c.contrat} onChange={(e) => maj(c.id, "contrat", e.target.value)} className="bg-transparent outline-none text-[13px] cursor-pointer">{CONTRATS.map((x) => <option key={x}>{x}</option>)}</select></td>
                          <td className="px-3 py-2.5"><input aria-label="Date" type="date" value={c.date_candidature} onChange={(e) => maj(c.id, "date_candidature", e.target.value)} className="bg-transparent outline-none text-stone-600 text-[13px]" /></td>
                          <td className="px-3 py-2.5"><select aria-label="Canal" value={c.canal} onChange={(e) => maj(c.id, "canal", e.target.value)} className="bg-transparent outline-none text-[13px] cursor-pointer">{CANAUX.map((x) => <option key={x}>{x}</option>)}</select></td>
                          <td className="px-3 py-2.5"><input aria-label="Contact" value={c.contact || ""} onChange={(e) => maj(c.id, "contact", e.target.value)} placeholder="—" className="w-24 bg-transparent outline-none text-stone-700" /></td>
                          <td className="px-3 py-2.5"><select aria-label="Statut" value={c.statut} onChange={(e) => maj(c.id, "statut", e.target.value)} className={`text-[12.5px] font-semibold px-2.5 py-1 rounded-full border-0 outline-none cursor-pointer ${statutColor[c.statut]}`}>{STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                          <td className="px-3 py-2.5">{c.score != null ? <span className="puce font-bold tabular-nums" style={{ background: t.bg, color: t.fg }}>{c.score}</span> : <span className="text-stone-400">—</span>}</td>
                          <td className="px-3 py-2.5 text-right"><button onClick={() => supprimer(c.id)} aria-label="Supprimer la ligne" className="w-8 h-8 rounded-lg text-stone-400 hover:text-red-700 hover:bg-red-50">✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
          </div>
        )}
      </main>

      {/* Barre d'onglets mobile */}
      <nav aria-label="Principal" className="no-print md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-stone-200 grid grid-cols-5" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map(({ id, court, Icon }) => (
          <button key={id} onClick={() => aller(id)} aria-current={tab === id ? "page" : undefined}
            className={`h-16 flex flex-col items-center justify-center gap-1 text-[11.5px] ${tab === id ? "text-ink font-bold" : "text-stone-500 font-medium"}`}>
            <Icon size={22} />{court}
          </button>
        ))}
      </nav>
    </div>
  );
}
