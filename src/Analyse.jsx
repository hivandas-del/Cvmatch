import { useEffect, useState } from "react";
import { tonScore } from "./ui";

// L'analyse passe par la tâche Claude « CV MATCH » (abonnement, pas de clé API) :
// l'appli dépose la demande dans cv_analyses, Claude écrit le résultat, l'appli relit la ligne.

const enAttente = (a) => a?.statut === "en_attente" || a?.statut === "en_cours";

function Chrono({ depuis }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((now - new Date(depuis)) / 1000));
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`}</>;
}

// ---------- attente : squelette du résultat + avancement ----------
export function AttenteAnalyse({ a, raison, onRelancer }) {
  const nonDeclenche = raison && raison !== "ok";
  const etapes = [
    { label: "Demande envoyée", fait: true },
    { label: "Claude lit l'annonce et ton CV", fait: a.statut === "en_cours", actif: a.statut === "en_attente" },
    { label: "Note, points forts, manques, conseils", fait: false, actif: a.statut === "en_cours" },
  ];
  return (
    <div className="carte p-5 sm:p-7 flex flex-col gap-6" aria-live="polite">
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative w-32 h-32 shrink-0">
          <svg className="w-32 h-32 animate-spin [animation-duration:2.4s]" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#F5F5F4" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="#0A0A0A" strokeWidth="10" strokeLinecap="round" strokeDasharray="70 327" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-stone-600 tabular-nums"><Chrono depuis={a.created_at} /></span>
        </div>
        <div className="min-w-0 flex flex-col gap-1.5 text-center sm:text-left">
          <p className="m-0 text-[17px] font-semibold tracking-tight">
            Claude analyse ton CV pour {a.poste || "cette offre"}{a.entreprise ? ` · ${a.entreprise}` : ""}
          </p>
          <p className="m-0 text-sm text-stone-600">En général moins d'une minute, sur ton abonnement Claude. Tu peux changer d'onglet, le résultat restera ici.</p>
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
          {raison === "token_manquant" && <p className="m-0"><b>Le bouton n'est pas encore relié à Claude.</b> Ta demande est enregistrée : elle partira dès que le jeton de la tâche sera ajouté dans les secrets Supabase (<code>CVMATCH_ROUTINE_TOKEN</code>).</p>}
          {raison === "limite_horaire" && <p className="m-0"><b>Limite horaire atteinte.</b> Ta demande est gardée en file : relance-la dans quelques minutes.</p>}
          {raison === "token_invalide" && <p className="m-0"><b>Jeton refusé.</b> Régénère le jeton de la tâche sur claude.ai/code/routines puis mets à jour <code>CVMATCH_ROUTINE_TOKEN</code>.</p>}
          {!["token_manquant", "limite_horaire", "token_invalide"].includes(raison) && <p className="m-0"><b>Déclenchement impossible</b> ({raison}). Ta demande reste en file.</p>}
          <button onClick={onRelancer} className="btn-noir btn-sm self-start">Relancer</button>
        </div>
      )}
      {a.session_url && <a href={a.session_url} target="_blank" rel="noreferrer" className="self-start text-sm text-stone-600 underline underline-offset-[3px] hover:text-ink">Voir Claude travailler ↗</a>}
    </div>
  );
}

// ---------- erreur ----------
export function ErreurAnalyse({ a, onRelancer }) {
  return (
    <div className="carte p-6 flex flex-col gap-3">
      <p className="m-0 text-[15px] font-semibold">L'analyse n'a pas abouti.</p>
      {a.erreur && <p className="m-0 text-sm text-stone-600">{a.erreur}</p>}
      <button onClick={onRelancer} className="btn-noir btn-sm self-start">Relancer</button>
    </div>
  );
}

// ---------- historique (les dernières analyses, cliquables) ----------
export function ListeAnalyses({ analyses, courante, onChoisir, onSupprimer }) {
  if (analyses.length < 2) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 etiquette">Analyses récentes</p>
      <ul className="m-0 p-0 list-none flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {analyses.map((a) => {
          const score = a.statut === "pret" ? a.resultat?.score : null;
          const t = tonScore(score);
          const actif = a.id === courante;
          return (
            <li key={a.id} className="shrink-0">
              <div className={`group flex items-center gap-2.5 pl-2 pr-1 py-1.5 rounded-xl border transition-colors ${actif ? "border-ink bg-white" : "border-stone-200 bg-white/60 hover:border-stone-400"}`}>
                <button onClick={() => onChoisir(a.id)} className="flex items-center gap-2.5 text-left">
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-bold tabular-nums shrink-0"
                    style={{ background: t.bg, color: t.fg }}>
                    {enAttente(a) ? <span className="w-2 h-2 rounded-full bg-ink animate-pulse" /> : a.statut === "erreur" ? "!" : score ?? "–"}
                  </span>
                  <span className="flex flex-col min-w-0 max-w-[170px]">
                    <span className="text-[13px] font-semibold truncate">{a.poste || "Offre sans titre"}</span>
                    <span className="text-[12px] text-stone-500 truncate">{a.entreprise || new Date(a.created_at).toLocaleDateString("fr-FR")}</span>
                  </span>
                </button>
                <button onClick={() => onSupprimer(a.id)} aria-label="Supprimer cette analyse"
                  className="w-6 h-6 rounded-md text-stone-400 hover:text-ink hover:bg-stone-100 flex items-center justify-center">×</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
