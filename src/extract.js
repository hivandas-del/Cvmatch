import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + pdfjsLib.version + "/pdf.worker.min.mjs";

// Extrait le texte brut d'un fichier CV (PDF, DOCX ou TXT).
export async function extraireTexte(file) {
  const nom = file.name.toLowerCase();

  if (nom.endsWith(".pdf")) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let texte = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      texte += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return texte.trim();
  }

  if (nom.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return value.trim();
  }

  if (nom.endsWith(".txt")) {
    return (await file.text()).trim();
  }

  throw new Error("Format non supporte : choisis un PDF, DOCX ou TXT.");
}
