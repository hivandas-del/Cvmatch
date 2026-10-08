import { useEffect, useRef, useState } from "react";
import { chargerProfilComplet, enregistrerProfil, declencherProfil, appelRadar } from "./supabase";
import { extraireTexte } from "./extract";

// Mon profil : 2 documents (le CV et « ce que je cherche »). Claude les lit, cale la recherche du radar
// sur ce qui est visé ET sur l'expérience réelle du CV, puis le radar re-trie les offres.
const compterMots = (t = "") => (t.trim() ? t.trim().split(/\s+/).length : 0);
const EXEMPLE = `Ex. : Je cherche un CDI de Data Analyst ou Consultant IA à Paris, junior, à partir de novembre 2026.
Secteurs qui m'intéressent : banque, assurance, conseil. Salaire visé : 45-50 k€.
Je suis aussi ouvert à un VIE à l'étranger (Bruxelles, Genève, Londres…).
Je ne veux pas : alternance, stage, postes purement commerciaux.`;

const ETAPES = [
  ["1", "Ton CV", "PDF, DOCX ou texte"],
  ["2", "Ce que tu cherches", "Postes, lieux, contrat, salaire…"],
  ["3", "Claude cale la recherche", "Sur tes envies et ton vrai niveau"],
  ["4", "Offres triées", "Puis « Adapter mon CV » sur chacune"],
];

function Document({ numero, titre, aide, texte, setTexte, fichier, setFichier, placeholder, ouvertParDefaut }) {
  const ref = useRef(null);
  const [lecture, setLecture] = useState(false);
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const [err, setErr] = useState("");
  useEffect(() => { if (ouvertParDefaut) setOuvert(true); }, [ouvertParDefaut]);

  async function choisir(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setErr(""); setLecture(true);
    try {
      const t = await extraireTexte(f);
      if (!t) { setErr("Fichier illisible (scan en image ?). Colle le texte à la main."); setOuvert(true); }
      else { setTexte(t); setFichier(f.name); }
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setLecture(false); }
  }

  const n = compterMots(texte);
  return (
    <section className="carte p-5 sm:p-6 flex flex-col gap-4 min-w-0">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 w-8 h-8 rounded-full grid place-items-center text-sm font-bold ${n ? "bg-ink text-white" : "bg-stone-100 text-stone-600"}`}>
          {n ? "✓" : numero}
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-[19px] font-semibold tracking-[-0.02em]">{titre}</h2>
          <p className="m-0 mt-0.5 text-sm text-stone-600">{aide}</p>
        </div>
      </div>

      <input ref={ref} type="file" accept=".pdf,.docx,.txt" onChange={choisir} className="hidden" />
      <button onClick={() => ref.current.click()} disabled={lecture}
        className="w-full rounded-2xl border-2 border-dashed border-stone-300 hover:border-ink transition px-4 py-6 flex flex-col items-center gap-1.5 text-center">
        <span className="text-[15px] font-semibold">{lecture ? "Lecture du fichier…" : n ? "Remplacer le fichier" : "Choisir un fichier"}</span>
        <span className="text-[13px] text-stone-500 break-all">
          {fichier ? `${fichier} · ${n} mots` : n ? `Texte saisi · ${n} mots` : "PDF, DOCX ou TXT"}
        </span>
      </button>

      {err && <p role="alert" className="m-0 text-sm text-red-700">{err}</p>}

      {ouvert ? (
        <div className="flex flex-col gap-1.5">
          <textarea value={texte} onChange={(e) => { setTexte(e.target.value); if (!e.target.value) setFichier(""); }}
            rows={9} placeholder={placeholder} className="zone text-[14px]" aria-label={titre} />
          {!ouvertParDefaut && <button onClick={() => setOuvert(false)} className="self-start text-sm text-stone-600 hover:text-ink">Masquer le texte</button>}
        </div>
      ) : (
        <button onClick={() => setOuvert(true)} className="self-start text-sm text-stone-600 underline underline-offset-[3px] hover:text-ink">
          {n ? "Voir / corriger le texte" : "ou l'écrire directement"}
        </button>
      )}
    </section>
  );
}

const Puces = ({ items = [], fort }) => (
  <div className="flex flex-wrap gap-1.5">
    {items.map((x) => (
      <span key={x} className={`puce ${fort ? "bg-ink text-white font-semibold" : "bg-stone-100 text-stone-700"}`}>{x}</span>
    ))}
  </div>
);
const Bloc = ({ titre, children }) => (
  <div className="flex flex-col gap-2 min-w-0">
    <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-stone-500">{titre}</h3>
    {children}
  </div>
);

function Synthese({ profil, onAller, rescore }) {
  const s = profil.profil_synthese ?? {};
  const b = profil.brief ?? {};
  const pa = b.piste_a ?? {}, pb = b.piste_b ?? {};
  const k = (n) => (n ? `${Math.round(n / 1000)} k€` : null);
  return (
    <section className="carte p-5 sm:p-7 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-stone-500">Ce que Claude a compris</p>
          <p className="m-0 mt-2 text-[17px] sm:text-[19px] leading-snug font-medium tracking-[-0.01em]">
            {s.resume || "Recherche calée sur ton CV et tes souhaits."}
          </p>
          {s.niveau && <p className="m-0 mt-2 text-sm text-stone-600">Niveau retenu : {s.niveau}</p>}
        </div>
        <button onClick={() => onAller("radar")} className="btn-noir shrink-0">Voir les offres →</button>
      </div>

      {rescore && (
        <p className="m-0 px-4 py-3 rounded-xl bg-stone-100 text-sm text-stone-700">{rescore}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Bloc titre="Postes visés en priorité"><Puces items={b.titres_p1} fort /></Bloc>
        {!!b.titres_p2?.length && <Bloc titre="Aussi pertinents"><Puces items={b.titres_p2} /></Bloc>}
        {!!b.competences?.length && <Bloc titre="Compétences mises en avant"><Puces items={b.competences.slice(0, 18)} /></Bloc>}
        <Bloc titre="Où et comment">
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[14.5px]">
            {pa.actif !== false && (
              <li>{[pa.contrat || "CDI", pa.lieu || "Île-de-France", pa.teletravail, b.salaire_min_cdi_idf && `min ${k(b.salaire_min_cdi_idf)}`].filter(Boolean).join(" · ")}</li>
            )}
            {pb.actif !== false && (pb.villes?.length || pb.vie) ? (
              <li>International{pb.vie ? " (VIE inclus)" : ""} : {(pb.villes ?? []).slice(0, 8).join(", ") || "zones ouvertes"}{(pb.villes?.length ?? 0) > 8 ? "…" : ""}</li>
            ) : null}
            {b.disponibilite && <li>Disponible : {b.disponibilite}</li>}
            {b.experience_max != null && <li>Postes jusqu'à {b.experience_max} ans d'expérience demandée</li>}
          </ul>
        </Bloc>
        {!!b.exclusions_titre?.length && <Bloc titre="Écarté d'office"><Puces items={b.exclusions_titre.slice(0, 14)} /></Bloc>}
      </div>

      {(s.ecarts?.length || s.conseils?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5 border-t border-stone-200">
          {!!s.ecarts?.length && (
            <Bloc titre="Écarts entre tes envies et ton CV">
              <ul className="m-0 pl-4 flex flex-col gap-1.5 text-[14.5px] text-stone-700">{s.ecarts.map((x) => <li key={x}>{x}</li>)}</ul>
            </Bloc>
          )}
          {!!s.conseils?.length && (
            <Bloc titre="Pour maximiser tes chances">
              <ul className="m-0 pl-4 flex flex-col gap-1.5 text-[14.5px] text-stone-700">{s.conseils.map((x) => <li key={x}>{x}</li>)}</ul>
            </Bloc>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function Profil({ onAller, onProfil }) {
  const [profil, setProfil] = useState(null);
  const [charge, setCharge] = useState(false);
  const [cv, setCv] = useState("");
  const [cvFichier, setCvFichier] = useState("");
  const [souhaits, setSouhaits] = useState("");
  const [souhaitsFichier, setSouhaitsFichier] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [declenche, setDeclenche] = useState(null);
  const [rescore, setRescore] = useState("");
  const [err, setErr] = useState("");
  const attendu = useRef(false);

  useEffect(() => {
    chargerProfilComplet().then((p) => {
      setProfil(p);
      if (p && ["en_attente", "en_cours"].includes(p.profil_statut)) attendu.current = true;
      if (p) {
        setCv(p.cv_text || ""); setCvFichier(p.cv_fichier || "");
        setSouhaits(p.souhaits_text || ""); setSouhaitsFichier(p.souhaits_fichier || "");
      }
    }).catch(() => setErr("Chargement du profil impossible.")).finally(() => setCharge(true));
  }, []);

  // Tant que Claude travaille, on relit le profil toutes les 5 s ; à la fin, le radar re-trie les offres.
  const statut = profil?.profil_statut;
  const enCours = statut === "en_attente" || statut === "en_cours";
  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(async () => {
      const p = await chargerProfilComplet().catch(() => null);
      if (p) setProfil(p);
    }, 5000);
    return () => clearInterval(t);
  }, [enCours]);
  useEffect(() => {
    if (statut !== "a_jour" || !attendu.current) return;
    attendu.current = false;
    onProfil?.(profil);
    setRescore("Le radar re-trie les offres avec ta nouvelle recherche…");
    appelRadar("rescore").then((r) => {
      const x = r.rescore ?? {};
      const nv = x.nouvelles?.added ?? 0;
      setRescore(`Radar mis à jour : ${x.revues ?? 0} offres revues, ${x.reintegrees ?? 0} remises en jeu, ${x.exclues ?? 0} écartées${nv ? `, ${nv} nouvelles` : ""}. Les notes IA arrivent avec la tâche du matin.`);
    }).catch((e) => setRescore(`Re-tri du radar impossible : ${e.message}`));
  }, [statut]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = !profil || cv !== (profil.cv_text || "") || souhaits !== (profil.souhaits_text || "");
  const pret = compterMots(cv) >= 40 && compterMots(souhaits) >= 5;

  async function lancer() {
    setErr(""); setEnvoi(true); setRescore(""); setDeclenche(null);
    try {
      const p = await enregistrerProfil({ cv_text: cv.trim(), souhaits_text: souhaits.trim(), cv_fichier: cvFichier, souhaits_fichier: souhaitsFichier });
      setProfil(p); attendu.current = true; onProfil?.(p);
      setDeclenche(await declencherProfil());
    } catch (e) { setErr(`Enregistrement impossible : ${e.message}`); }
    finally { setEnvoi(false); }
  }

  const premiereFois = charge && !profil?.souhaits_text;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[32px] sm:text-[48px] font-semibold tracking-[-0.04em] leading-[1.02]">Mon profil</h1>
        <p className="mt-3 mb-0 text-[15px] text-stone-600 max-w-2xl">
          Deux documents suffisent : ton CV et ce que tu cherches. Claude en tire ta recherche, calée sur ton vrai niveau, et le radar trie les offres pour toi.
        </p>
      </div>

      <ol className="m-0 p-0 list-none grid grid-cols-2 lg:grid-cols-4 gap-2">
        {ETAPES.map(([n, t, d]) => (
          <li key={n} className="rounded-2xl bg-white/60 px-4 py-3">
            <span className="text-[12px] font-bold text-stone-500 tabular-nums">0{n}</span>
            <p className="m-0 text-[14.5px] font-semibold">{t}</p>
            <p className="m-0 text-[12.5px] text-stone-500">{d}</p>
          </li>
        ))}
      </ol>

      {err && <div role="alert" className="px-4 py-3.5 rounded-xl bg-red-50 text-red-800 text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Document numero="1" titre="Ton CV" aide="Ton CV de base, celui que Claude adaptera ensuite à chaque offre."
          texte={cv} setTexte={setCv} fichier={cvFichier} setFichier={setCvFichier} placeholder="Colle ton CV ici…" />
        <Document numero="2" titre="Ce que tu cherches" aide="Postes, lieux, contrat, secteurs, salaire, ce que tu ne veux pas. En vrac, ça marche."
          texte={souhaits} setTexte={setSouhaits} fichier={souhaitsFichier} setFichier={setSouhaitsFichier}
          placeholder={EXEMPLE} ouvertParDefaut={premiereFois} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={lancer} disabled={!pret || envoi || enCours || (!change && statut === "a_jour")} className="btn-noir px-6">
          {envoi ? "Envoi…" : enCours ? "Claude travaille…" : statut === "a_jour" && !change ? "Recherche à jour" : "Lancer la recherche"}
        </button>
        {!pret && charge && <span className="text-sm text-stone-600">Ajoute ton CV et quelques lignes sur ce que tu cherches.</span>}
        {pret && change && statut === "a_jour" && profil?.souhaits_text && <span className="text-sm text-stone-600">Documents modifiés : relance pour mettre la recherche à jour.</span>}
      </div>

      {enCours && (
        <section className="carte p-5 sm:p-6 flex items-start gap-4" aria-live="polite">
          <span className="relative mt-1 shrink-0 w-3 h-3">
            <span className="absolute inset-0 rounded-full bg-ink animate-ping opacity-40" />
            <span className="absolute inset-0 rounded-full bg-ink" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[16px] font-semibold">
              {statut === "en_cours" ? "Claude lit tes deux documents et cale la recherche…" : "Demande envoyée à Claude"}
            </p>
            <p className="m-0 mt-1 text-sm text-stone-600">
              {declenche && declenche.declenche === false
                ? "Lancement automatique pas encore branché : la demande est enregistrée et sera traitée par la tâche du matin (6h52)."
                : "Ça prend en général 1 à 2 minutes. Tu peux changer d'onglet, la page se met à jour toute seule."}
            </p>
            {profil?.profil_session_url && (
              <a href={profil.profil_session_url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-sm font-semibold underline underline-offset-[3px]">Suivre Claude en direct</a>
            )}
          </div>
        </section>
      )}

      {statut === "erreur" && (
        <section className="carte p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-red-800">Claude n'a pas pu finir : {profil.profil_erreur || "erreur inconnue"}</p>
          <button onClick={lancer} className="btn-gris btn-sm">Relancer</button>
        </section>
      )}

      {statut === "a_jour" && profil?.profil_synthese && <Synthese profil={profil} onAller={onAller} rescore={rescore} />}
    </div>
  );
}
