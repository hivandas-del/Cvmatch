import { useEffect, useState } from "react";
import { tonScore } from "./ui";

// ---------- liens : contact {texte, url} ou texte brut avec des adresses dedans ----------
const RE_LIEN = /(https?:\/\/[^\s,;)]+|www\.[^\s,;)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:fr|com|io|dev|me|net|org|app|eu|ai)(?:\/[^\s,;)]*)?(?![\w@]))/gi;
const versUrl = (t) => (/^https?:\/\//i.test(t) ? t : t.includes("@") && !t.includes("/") ? `mailto:${t}` : `https://${t}`);
const enUrl = (u) => (/^(https?:|mailto:|tel:)/i.test(u) ? u : versUrl(u));
const classeLien = "text-[#0563C1] underline underline-offset-[2px]";

function TexteLie({ texte }) {
  const s = String(texte ?? "");
  const morceaux = s.split(RE_LIEN);
  if (morceaux.length === 1) return s;
  return morceaux.map((m, i) => (i % 2 === 1
    ? <a key={i} href={versUrl(m.replace(/[.]$/, ""))} target="_blank" rel="noreferrer" className={classeLien}>{m}</a>
    : m));
}
const lienEnTexte = (c) => {
  if (!c || typeof c !== "object") return c || "";
  if (!c.url || !c.texte) return c.url || c.texte || "";
  const u = c.url.replace(/^mailto:/i, "");
  return c.texte.includes(u.replace(/^https?:\/\//i, "")) ? c.texte : `${c.texte} : ${u}`;
};

// Ancien format (avant le 16 oct.) → rubriques, pour afficher l'historique avec le même rendu.
function rubriques(cv) {
  if (Array.isArray(cv.sections)) return cv.sections;
  const r = [];
  if (cv.experiences?.length) r.push({ titre: "Expériences", type: "experiences", elements: cv.experiences });
  if (cv.formation?.length) r.push({ titre: "Formation", type: "formation", elements: cv.formation });
  if (cv.competences?.length) r.push({ titre: "Compétences", type: "groupes", elements: cv.competences });
  if (cv.langues?.length) r.push({ titre: "Langues", type: "ligne", elements: cv.langues });
  const extras = (cv.extras || []).filter(Boolean);
  if (extras.length) r.push({ titre: "En plus", type: "ligne", elements: extras });
  return r;
}
const elementsDe = (s) => (Array.isArray(s.elements) ? s.elements : []).filter((x) => x != null && x !== "");

// ---------- texte brut du CV (copier / coller dans un éditeur) ----------
const enteteExp = (e) => {
  const tete = [e.poste, e.entreprise].filter(Boolean).join(" – ");
  return [tete, e.lieu].filter(Boolean).join(" | ");
};
const groupeTexte = (c) => c.texte || (c.items || []).join(", ");

export function cvEnTexte(cv) {
  if (!cv) return "";
  const l = [];
  l.push(cv.nom || "", cv.titre || "");
  const contact = (cv.contact || []).filter(Boolean).map(lienEnTexte).filter(Boolean);
  if (contact.length) l.push(contact.join(" | "));
  if (cv.accroche) l.push("", cv.accroche);
  for (const s of rubriques(cv)) {
    const el = elementsDe(s);
    if (!el.length && !s.texte) continue;
    l.push("", (s.titre || "").toUpperCase());
    if (s.texte) l.push(s.texte);
    if (s.type === "experiences") el.forEach((e) => {
      l.push([enteteExp(e), e.dates].filter(Boolean).join("    "));
      (e.puces || []).forEach((p) => l.push(`- ${p}`));
      (e.liens || []).filter(Boolean).forEach((x) => l.push(`  ${lienEnTexte(x)}`));
    });
    else if (s.type === "projets") el.forEach((p) => {
      const liens = (p.liens || []).filter(Boolean).map(lienEnTexte).join(" · ");
      if (p.en_ligne) l.push(`${p.titre} : ${p.texte || ""}${liens ? " → " + liens : ""}`);
      else l.push(p.titre || "", `${p.texte || ""}${liens ? " → " + liens : ""}`);
    });
    else if (s.type === "formation") el.forEach((f) => {
      if (f.ecole) l.push([f.ecole, f.dates].filter(Boolean).join("    "));
      l.push(f.ecole ? f.diplome : [f.diplome, f.dates].filter(Boolean).join("    "));
      if (f.detail) l.push(f.detail);
    });
    else if (s.type === "groupes") el.forEach((c) => l.push(c.groupe ? `${c.groupe} : ${groupeTexte(c)}` : groupeTexte(c)));
    else if (s.type === "ligne") l.push(el.map(lienEnTexte).join(" · "));
    else el.forEach((x) => l.push(`- ${typeof x === "object" ? lienEnTexte(x) : x}`));
  }
  return l.join("\n").trim();
}

// ---------- la feuille de CV : même mise en page que le CV d'Hivan (écran + impression A4) ----------
// Calibri (Carlito en secours), nom centré espacé, contact séparé par « | » avec liens bleus,
// rubriques en capitales espacées suivies d'un filet, puces « - », dates en italique à droite.
const BLEU = "#0563C1";
const classeLienCV = "underline underline-offset-[2px]";
function LienCV({ c }) {
  if (c && typeof c === "object") {
    const t = c.texte || c.url;
    return c.url ? <a href={enUrl(c.url)} target="_blank" rel="noreferrer" className={classeLienCV} style={{ color: BLEU }}>{t}</a> : <TexteLie texte={t} />;
  }
  return <TexteLie texte={c} />;
}
const Sep = () => <span> | </span>;

function TitreRubrique({ titre }) {
  return (
    <div className="cv-rub flex items-center gap-3">
      <h3 className="m-0 shrink-0 font-normal uppercase tracking-[0.2em] text-[1.1em] leading-none">{titre}</h3>
      <span className="flex-1 border-b border-black translate-y-[0.1em]" aria-hidden="true" />
    </div>
  );
}

// « Cours : … » → libellé souligné, comme dans le CV.
function Detail({ texte }) {
  const m = String(texte || "").match(/^([^:]{1,30}?)\s*:\s*(.*)$/s);
  if (!m) return <TexteLie texte={texte} />;
  return <><span className="underline">{m[1]}</span> : <TexteLie texte={m[2]} /></>;
}

function Rubrique({ s }) {
  const el = elementsDe(s);
  if (!el.length && !s.texte) return null;
  return (
    <section className="cv-section flex flex-col gap-[0.35em]">
      <TitreRubrique titre={s.titre} />
      {s.texte && String(s.texte).split(/\n+/).map((p, i) => <p key={i} className="m-0"><TexteLie texte={p} /></p>)}

      {s.type === "experiences" && el.map((e, i) => (
        <div key={i} className={`cv-bloc ${i > 0 ? "mt-[0.45em]" : ""}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="m-0 font-bold">{enteteExp(e)}</p>
            {e.dates && <p className="m-0 italic whitespace-nowrap">{e.dates}</p>}
          </div>
          {(e.puces || []).map((p, j) => <p key={j} className="m-0 mt-[0.15em]">- <TexteLie texte={p} /></p>)}
          {e.liens?.filter(Boolean).length > 0 && (
            <p className="m-0 mt-[0.15em]">→ {e.liens.filter(Boolean).map((x, j) => <span key={j}>{j > 0 && " · "}<LienCV c={x} /></span>)}</p>
          )}
        </div>
      ))}

      {s.type === "projets" && el.map((p, i) => {
        const liens = (p.liens || []).filter(Boolean);
        const suite = liens.length > 0 && <> → {liens.map((x, j) => <span key={j}>{j > 0 && " · "}<LienCV c={x} /></span>)}</>;
        return p.en_ligne ? (
          <p key={i} className="cv-bloc m-0"><b>{p.titre} :</b> <TexteLie texte={p.texte} />{suite}</p>
        ) : (
          <div key={i} className="cv-bloc">
            <p className="m-0 font-bold">{p.titre}</p>
            <p className="m-0 mt-[0.15em]"><TexteLie texte={p.texte} />{suite}</p>
          </div>
        );
      })}

      {s.type === "formation" && el.map((f, i) => (
        <div key={i} className={`cv-bloc ${i > 0 ? "mt-[0.25em]" : ""}`}>
          {f.ecole && (
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 uppercase">{f.ecole}</p>
              {f.dates && <p className="m-0 italic whitespace-nowrap">{f.dates}</p>}
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <p className="m-0 font-bold">{f.diplome}</p>
            {!f.ecole && f.dates && <p className="m-0 italic whitespace-nowrap">{f.dates}</p>}
          </div>
          {f.detail && <p className="m-0"><Detail texte={f.detail} /></p>}
        </div>
      ))}

      {s.type === "groupes" && (
        <div className="flex flex-col gap-[0.1em]">
          {el.map((c, i) => <p key={i} className="m-0">{c.groupe && <><b>{c.groupe}</b> : </>}<TexteLie texte={groupeTexte(c)} /></p>)}
        </div>
      )}

      {s.type === "ligne" && <p className="m-0">{el.map((x, i) => <span key={i}>{i > 0 && " · "}<LienCV c={x} /></span>)}</p>}

      {!["experiences", "projets", "formation", "groupes", "ligne", "texte"].includes(s.type) && el.map((x, i) => (
        <p key={i} className="m-0">- <LienCV c={x} /></p>
      ))}
    </section>
  );
}

export function FeuilleCV({ cv }) {
  const contact = (cv.contact || []).filter(Boolean);
  return (
    <div className="overflow-x-auto rounded-[18px] bg-white">
      <article id="cv-feuille" className="cv-feuille bg-white text-black mx-auto px-5 py-7 sm:px-[56px] sm:py-[48px] flex flex-col gap-[0.7em]">
        <header className="text-center flex flex-col gap-[0.45em] mb-[0.2em]">
          <h2 className="m-0 text-[2.6em] font-normal tracking-[0.12em] leading-none uppercase">{cv.nom}</h2>
          {cv.titre && <p className="m-0 mt-[0.35em] text-[1.1em] uppercase tracking-[0.3em]">{cv.titre}</p>}
          {contact.length > 0 && (
            <p className="m-0">{contact.map((c, i) => <span key={i}>{i > 0 && <Sep />}{typeof c === "object" ? <LienCV c={c} /> : c}</span>)}</p>
          )}
        </header>
        {cv.accroche && <p className="m-0">{cv.accroche}</p>}
        {rubriques(cv).map((s, i) => <Rubrique key={i} s={s} />)}
      </article>
    </div>
  );
}

// ---------- attente : la tâche Claude tourne ----------
function Attente({ a, raison, onRelancer }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((now - new Date(a.created_at)) / 1000));
  const duree = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
  const etapes = [
    { label: "Demande envoyée", fait: true },
    { label: "Claude lit l'annonce et ton CV", fait: a.statut === "en_cours", actif: a.statut === "en_attente" },
    { label: "Réécriture ligne par ligne", fait: false, actif: a.statut === "en_cours" },
  ];
  const nonDeclenche = raison && raison !== "ok";
  return (
    <div className="carte p-6 sm:p-9 flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <span className="relative flex w-3 h-3 shrink-0 mt-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-ink opacity-30 animate-ping" />
          <span className="relative inline-flex w-3 h-3 rounded-full bg-ink" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[17px] font-semibold tracking-tight">Claude réécrit ton CV pour {a.poste || "ce poste"}{a.entreprise ? ` · ${a.entreprise}` : ""}</p>
          <p className="mt-1 mb-0 text-sm text-stone-600 tabular-nums">{duree} · en général 1 à 3 minutes, sur ton abonnement Claude. Tu peux changer d'onglet.</p>
        </div>
      </div>
      <ol className="m-0 p-0 list-none flex flex-col gap-3">
        {etapes.map((e, i) => (
          <li key={i} className={`flex items-center gap-3 text-[15px] ${e.fait ? "text-ink" : e.actif ? "text-ink font-semibold" : "text-stone-400"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0 ${e.fait ? "bg-ink text-white" : e.actif ? "border-2 border-ink" : "border border-stone-300"}`}>{e.fait ? "✓" : i + 1}</span>
            {e.label}
          </li>
        ))}
      </ol>
      {nonDeclenche && (
        <div className="rounded-xl bg-amber-50 text-amber-900 p-4 text-sm leading-relaxed flex flex-col gap-2">
          {raison === "token_manquant" && <p className="m-0"><b>Le bouton n'est pas encore relié à Claude.</b> Ta demande est enregistrée : elle partira dès que le jeton de la tâche « CVMatch — Adapter mon CV » sera ajouté dans les secrets Supabase (<code>CVMATCH_ROUTINE_TOKEN</code>).</p>}
          {raison === "limite_horaire" && <p className="m-0"><b>Limite atteinte</b> (30 adaptations par heure). Ta demande est gardée en file : relance-la dans quelques minutes.</p>}
          {raison === "token_invalide" && <p className="m-0"><b>Jeton refusé.</b> Régénère le jeton de la tâche sur claude.ai/code/routines puis mets à jour <code>CVMATCH_ROUTINE_TOKEN</code>.</p>}
          {!["token_manquant", "limite_horaire", "token_invalide"].includes(raison) && <p className="m-0"><b>Déclenchement impossible</b> ({raison}). Ta demande reste en file.</p>}
          <button onClick={onRelancer} className="btn-noir btn-sm self-start">Relancer</button>
        </div>
      )}
      {a.session_url && <a href={a.session_url} target="_blank" rel="noreferrer" className="self-start text-sm text-stone-600 underline underline-offset-[3px] hover:text-ink">Voir Claude travailler ↗</a>}
    </div>
  );
}

// Met la feuille au gabarit A4 (180 mm de large, 273 mm utiles) et réduit le corps du texte
// juste ce qu'il faut pour tenir sur une page, sans jamais retirer de contenu.
export function ajusterUnePage() {
  const f = document.getElementById("cv-feuille");
  if (!f) return;
  f.classList.add("cv-a4");
  const mm = 96 / 25.4;
  const hauteurUtile = 273 * mm;
  let k = 1;
  f.style.setProperty("--cv-k", "1");
  for (let i = 0; i < 14 && f.scrollHeight > hauteurUtile && k > 0.78; i++) {
    k = Math.round((k - 0.02) * 100) / 100;
    f.style.setProperty("--cv-k", String(k));
  }
}

// ---------- page Refonte CV ----------
export default function Refonte({ adaptations, courante, raisons, onChoisir, onRelancer, onSupprimer, onAller, chargement }) {
  const [copie, setCopie] = useState(false);
  const a = adaptations.find((x) => x.id === courante) || adaptations[0];
  const cv = a?.statut === "pret" ? a.resultat : null;

  const imprimer = () => {
    const titreAvant = document.title;
    const nom = [cv?.nom, a?.poste, a?.entreprise].filter(Boolean).join(" - ");
    document.title = `CV ${nom}`.replace(/[\\/:*?"<>|]+/g, " ");
    document.body.classList.add("impression-cv");
    ajusterUnePage();
    const fin = () => {
      document.body.classList.remove("impression-cv");
      document.getElementById("cv-feuille")?.classList.remove("cv-a4");
      document.title = titreAvant;
      window.removeEventListener("afterprint", fin);
    };
    window.addEventListener("afterprint", fin);
    window.print();
    setTimeout(fin, 1500);
  };
  const copier = () => { navigator.clipboard.writeText(cvEnTexte(cv)); setCopie(true); setTimeout(() => setCopie(false), 1500); };

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print">
        <h1 className="m-0 text-[30px] sm:text-[40px] font-semibold tracking-[-0.04em] leading-none">Refonte CV</h1>
        <p className="mt-3 mb-0 text-[15px] text-stone-600">Ton CV complet réécrit pour l'offre par Claude, sans rien inventer.</p>
      </div>

      {chargement && !adaptations.length && <div className="carte p-10 text-center text-[15px] text-stone-600 no-print">Chargement…</div>}
      {!chargement && !adaptations.length && (
        <div className="carte p-8 sm:p-10 flex flex-col items-center text-center gap-4 no-print">
          <p className="m-0 text-[15px] text-stone-600 max-w-md">Clique sur <b className="text-ink">« Adapter mon CV »</b> sur une offre de l'onglet Offres, ou colle une annonce dans Analyse.</p>
          <button onClick={() => onAller("radar")} className="btn-noir">Voir les offres</button>
        </div>
      )}

      {a && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
          {/* Historique */}
          <aside className="no-print lg:sticky lg:top-24">
            <p className="m-0 mb-2 text-xs font-semibold tracking-[0.06em] uppercase text-stone-600">Mes CV adaptés</p>
            <ul className="m-0 p-0 list-none flex lg:flex-col gap-2 overflow-x-auto pb-1 -mx-4 px-4 lg:mx-0 lg:px-0 snap-x">
              {adaptations.map((x) => {
                const sc = x.resultat?.score_apres;
                const t = tonScore(sc ?? null);
                const actif = x.id === a.id;
                return (
                  <li key={x.id} className="shrink-0 w-[220px] lg:w-auto snap-start">
                    <button onClick={() => onChoisir(x.id)} aria-current={actif ? "true" : undefined}
                      className={`w-full text-left rounded-xl p-3 flex items-center gap-3 transition ${actif ? "bg-ink text-white" : "bg-white hover:bg-stone-50"}`}>
                      <span className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-[13px] font-bold tabular-nums"
                        style={x.statut === "pret" && sc != null ? { background: t.bg, color: t.fg } : { background: actif ? "rgba(255,255,255,.15)" : "#F5F5F4" }}>
                        {x.statut === "pret" ? (sc ?? "✓") : x.statut === "erreur" ? "!" : <span className="w-2 h-2 rounded-full bg-current animate-pulse" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold truncate">{x.poste || "Poste"}</span>
                        <span className={`block text-[12px] truncate ${actif ? "text-white/70" : "text-stone-500"}`}>{x.entreprise || "—"} · {new Date(x.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Contenu */}
          <div className="flex flex-col gap-4 min-w-0">
            {(a.statut === "en_attente" || a.statut === "en_cours") && <Attente a={a} raison={raisons[a.id]} onRelancer={() => onRelancer(a.id)} />}

            {a.statut === "erreur" && (
              <div className="carte p-6 flex flex-col gap-3 no-print">
                <p className="m-0 text-[15px] font-semibold">La réécriture a échoué</p>
                <p className="m-0 text-sm text-stone-600">{a.erreur || "Erreur inconnue."}</p>
                <button onClick={() => onRelancer(a.id)} className="btn-noir btn-sm self-start">Relancer</button>
              </div>
            )}

            {cv && (<>
              <div className="carte p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 no-print">
                {cv.score_apres != null && (
                  <div className="flex items-center gap-3">
                    <span className="puce font-bold tabular-nums" style={{ background: tonScore(cv.score_avant).bg, color: tonScore(cv.score_avant).fg }}>{cv.score_avant}</span>
                    <span className="text-stone-400" aria-hidden="true">→</span>
                    <span className="puce font-bold tabular-nums text-[14px]" style={{ background: tonScore(cv.score_apres).bg, color: tonScore(cv.score_apres).fg }}>{cv.score_apres}</span>
                    <span className="text-sm text-stone-600">note IA · ton CV de base → CV adapté</span>
                  </div>
                )}
                <div className="flex gap-2 sm:ml-auto">
                  <button onClick={imprimer} className="btn-noir btn-sm flex-1 sm:flex-none">Télécharger en PDF</button>
                  <button onClick={copier} className="btn-gris btn-sm flex-1 sm:flex-none">{copie ? "Copié ✓" : "Copier le texte"}</button>
                </div>
              </div>

              <FeuilleCV cv={cv} />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 no-print">
                {cv.changements?.length > 0 && (
                  <div className="carte p-5 md:col-span-1">
                    <p className="m-0 mb-2.5 text-sm font-semibold">Ce que Claude a changé</p>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2">{cv.changements.map((c, i) => <li key={i} className="text-sm flex gap-2"><span className="text-stone-400">→</span><span>{c}</span></li>)}</ul>
                  </div>
                )}
                {cv.mots_cles?.length > 0 && (
                  <div className="carte p-5">
                    <p className="m-0 mb-2.5 text-sm font-semibold">Mots-clés de l'offre repris</p>
                    <div className="flex flex-wrap gap-1.5">{cv.mots_cles.map((t, i) => <span key={i} className="puce bg-green-50 text-green-800">{t}</span>)}</div>
                  </div>
                )}
                {cv.manques?.length > 0 && (
                  <div className="carte p-5">
                    <p className="m-0 mb-1 text-sm font-semibold">Absent de ton parcours</p>
                    <p className="m-0 mb-2.5 text-[12.5px] text-stone-500">Non ajouté au CV : à préparer pour l'entretien.</p>
                    <div className="flex flex-wrap gap-1.5">{cv.manques.map((t, i) => <span key={i} className="puce bg-red-50 text-red-800">{t}</span>)}</div>
                  </div>
                )}
              </div>
            </>)}

            <button onClick={() => { if (confirm("Supprimer ce CV adapté ?")) onSupprimer(a.id); }}
              className="no-print self-start text-sm text-stone-500 hover:text-red-700">Supprimer ce CV adapté</button>
          </div>
        </div>
      )}
    </div>
  );
}
