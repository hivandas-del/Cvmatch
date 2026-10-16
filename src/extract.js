import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + pdfjsLib.version + "/pdf.worker.min.mjs";

// Bloc ajouté à la fin du texte : les adresses des liens du fichier (invisibles dans le texte brut).
// Ce n'est pas une rubrique du CV : la refonte s'en sert pour rattacher chaque URL à son libellé.
export const MARQUEUR_LIENS = "[Liens du document]";

const propre = (s) => (s || "").replace(/\s+/g, " ").trim();
const sansProtocole = (u) => u.replace(/^mailto:/i, "").replace(/^https?:\/\//i, "").replace(/\/$/, "");

function blocLiens(liens) {
  const vus = new Set();
  const lignes = [];
  for (const { texte, url } of liens) {
    if (!url || !/^(https?:|mailto:)/i.test(url) || vus.has(url)) continue;
    vus.add(url);
    const t = propre(texte);
    lignes.push(t && sansProtocole(t) !== sansProtocole(url) ? `- ${t} : ${url}` : `- ${url}`);
  }
  return lignes.length ? `\n\n${MARQUEUR_LIENS}\n${lignes.join("\n")}` : "";
}

// Libellé d'un lien PDF : le texte dont le centre tombe dans le rectangle du lien.
function texteSous(rect, items) {
  const [x1, y1, x2, y2] = rect;
  const xa = Math.min(x1, x2) - 1, xb = Math.max(x1, x2) + 1, ya = Math.min(y1, y2) - 2, yb = Math.max(y1, y2) + 2;
  return items
    .filter((it) => {
      const x = it.transform[4] + (it.width || 0) / 2, y = it.transform[5] + (it.height || 0) / 3;
      return x >= xa && x <= xb && y >= ya && y <= yb;
    })
    .map((it) => it.str).join(" ");
}

// Extrait le texte d'un fichier CV (PDF, DOCX ou TXT), avec l'adresse des liens.
export async function extraireTexte(file) {
  const nom = file.name.toLowerCase();

  if (nom.endsWith(".pdf")) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let texte = "";
    const liens = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      texte += content.items.map((it) => it.str).join(" ") + "\n";
      const annots = await page.getAnnotations().catch(() => []);
      for (const a of annots) {
        if (a.subtype === "Link" && a.url) liens.push({ texte: texteSous(a.rect, content.items), url: a.url });
      }
    }
    return (texte.trim() + blocLiens(liens)).trim();
  }

  if (nom.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf.slice(0) });
    let liens = [];
    try {
      const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf.slice(0) });
      const doc = new DOMParser().parseFromString(html, "text/html");
      liens = [...doc.querySelectorAll("a[href]")].map((a) => ({ texte: a.textContent, url: a.getAttribute("href") }));
    } catch { /* texte seul */ }
    return (value.trim() + blocLiens(liens)).trim();
  }

  if (nom.endsWith(".txt")) {
    return (await file.text()).trim();
  }

  throw new Error("Format non supporte : choisis un PDF, DOCX ou TXT.");
}
