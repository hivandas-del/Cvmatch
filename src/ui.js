// Code couleur du score : la seule couleur de l'interface (tout le reste est noir, blanc, pierre).
export const SEUIL_BON = 75;
export const SEUIL_MOYEN = 50;

export function tonScore(s) {
  if (s == null) return { bg: "#F5F5F4", fg: "#57534E", trait: "#A8A29E", label: "Non noté" };
  if (s >= SEUIL_BON) return { bg: "#DCFCE7", fg: "#15803D", trait: "#16A34A", label: "Très bon match" };
  if (s >= SEUIL_MOYEN) return { bg: "#FFEDD5", fg: "#C2410C", trait: "#EA580C", label: "Moyen" };
  return { bg: "#FEE2E2", fg: "#B91C1C", trait: "#DC2626", label: "Pas adapté" };
}

export const LEGENDE = [
  { trait: "#16A34A", texte: `${SEUIL_BON}+ très bon` },
  { trait: "#EA580C", texte: `${SEUIL_MOYEN}–${SEUIL_BON - 1} moyen` },
  { trait: "#DC2626", texte: `< ${SEUIL_MOYEN} pas adapté` },
];

export function initiales(email = "") {
  const nom = email.split("@")[0].replace(/[0-9]+/g, "");
  const parts = nom.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
}
