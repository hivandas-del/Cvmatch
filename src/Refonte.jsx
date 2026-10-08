import { useEffect, useState } from "react";
import { tonScore } from "./ui";

// ---------- texte brut du CV (copier / coller dans un éditeur) ----------
export function cvEnTexte(cv) {
  if (!cv) return "";
  const l = [];
  l.push(cv.nom || "", cv.titre || "");
  if (cv.contact?.length) l.push(cv.contact.filter(Boolean).join(" · "));
  if (cv.accroche) l.push("", cv.accroche);
  if (cv.experiences?.length) {
    l.push("", "EXPÉRIENCES");
    cv.experiences.forEach((e) => {
      l.push("", `${e.poste} — ${[e.entreprise, e.lieu].filter(Boolean).join(", ")}${e.dates ? " — " + e.dates : ""}`);
      (e.puces || []).forEach((p) => l.push(`- ${p}`));
    });
  }
  if (cv.formation?.length) {
    l.push("", "FORMATION");
    cv.formation.forEach((f) => l.push(`${f.diplome} — ${f.ecole}${f.dates ? " — " + f.dates : ""}${f.detail ? "\n  " + f.detail : ""}`));
  }
  if (cv.competences?.length) {
    l.push("", "COMPÉTENCES");
    cv.competences.forEach((c) => l.push(`${c.groupe} : ${(c.items || []).join(", ")}`));
  }
  if (cv.langues?.length) l.push("", "LANGUES", cv.langues.join(" · "));
  const extras = (cv.extras || []).filter(Boolean);
  if (extras.length) l.push("", "EN PLUS", ...extras.map((x) => `- ${x}`));
  return l.join("\n").trim();
}

// ---------- la feuille de CV (écran + impression A4) ----------
const Section = ({ titre, children }) => (
  <section className="cv-section">
    <h3 className="m-0 mb-2 text-[10.5px] font-bold tracking-[0.14em] uppercase text-stone-500 border-b border-stone-200 pb-1">{titre}</h3>
    {children}
  </section>
);

function FeuilleCV({ cv }) {
  const extras = (cv.extras || []).filter(Boolean);
  return (
    <article id="cv-feuille" className="bg-white text-ink rounded-[18px] px-6 py-7 sm:px-12 sm:py-11 text-[13px] leading-[1.5] flex flex-col gap-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <header>
        <h2 className="m-0 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-none">{cv.nom}</h2>
        <p className="mt-2 mb-0 text-[15px] font-semibold text-stone-700">{cv.titre}</p>
        {cv.contact?.filter(Boolean).length > 0 && (
          <p className="mt-2 mb-0 text-[12px] text-stone-500 flex flex-wrap gap-x-3 gap-y-0.5">
            {cv.contact.filter(Boolean).map((c, i) => <span key={i}>{c}</span>)}
          </p>
        )}
        {cv.accroche && <p className="mt-4 mb-0 text-[13.5px] text-stone-800">{cv.accroche}</p>}
      </header>

      {cv.experiences?.length > 0 && (
        <Section titre="Expériences">
          <div className="flex flex-col gap-3.5">
            {cv.experiences.map((e, i) => (
              <div key={i} className="cv-bloc">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="m-0 font-semibold text-[13.5px]">{e.poste}<span className="font-normal text-stone-600"> · {[e.entreprise, e.lieu].filter(Boolean).join(", ")}</span></p>
                  {e.dates && <p className="m-0 text-[12px] text-stone-500 tabular-nums whitespace-nowrap">{e.dates}</p>}
                </div>
                <ul className="mt-1 mb-0 pl-4 flex flex-col gap-0.5 list-disc marker:text-stone-400">
                  {(e.puces || []).map((p, j) => <li key={j}>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {cv.formation?.length > 0 && (
        <Section titre="Formation">
          <div className="flex flex-col gap-2">
            {cv.formation.map((f, i) => (
              <div key={i} className="cv-bloc">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="m-0 font-semibold">{f.diplome}<span className="font-normal text-stone-600"> · {f.ecole}</span></p>
                  {f.dates && <p className="m-0 text-[12px] text-stone-500 tabular-nums whitespace-nowrap">{f.dates}</p>}
                </div>
                {f.detail && <p className="m-0 text-stone-600">{f.detail}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {cv.competences?.length > 0 && (
        <Section titre="Compétences">
          <div className="flex flex-col gap-1">
            {cv.competences.map((c, i) => (
              <p key={i} className="m-0"><span className="font-semibold">{c.groupe}</span><span className="text-stone-400"> — </span>{(c.items || []).join(" · ")}</p>
            ))}
          </div>
        </Section>
      )}

      {(cv.langues?.length > 0 || extras.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 cv-section">
          {cv.langues?.length > 0 && <Section titre="Langues"><p className="m-0">{cv.langues.join(" · ")}</p></Section>}
          {extras.length > 0 && <Section titre="En plus"><p className="m-0">{extras.join(" · ")}</p></Section>}
        </div>
      )}
    </article>
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
    const fin = () => { document.body.classList.remove("impression-cv"); document.title = titreAvant; window.removeEventListener("afterprint", fin); };
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
                    <span className="text-sm text-stone-600">compatibilité avec l'offre</span>
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
