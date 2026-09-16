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