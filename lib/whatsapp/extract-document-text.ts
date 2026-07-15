import { promises as fs } from "fs";

const MAX_EXTRACTED_CHARS = 6000;

// Keeps the bot's document understanding provider-agnostic (unlike audio, which is
// Gemini-only) — extracted text is just injected as a normal text ContentPart, so it
// works the same whether the bot runs on Google or OpenRouter.
export async function extractDocumentText(absolutePath: string, mimeType: string | null): Promise<string | null> {
  try {
    if (mimeType === "application/pdf") {
      // Import the inner module directly, not the package root — pdf-parse's index.js
      // has a top-level debug block gated on `!module.parent` that (mis)fires under
      // ESM dynamic import and tries to read a bundled test fixture PDF that doesn't
      // exist in this project, crashing the import.
      const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
      const buffer = await fs.readFile(absolutePath);
      const result = await pdfParse(buffer);
      return truncate(result.text);
    }

    if (mimeType?.startsWith("text/")) {
      const text = await fs.readFile(absolutePath, "utf-8");
      return truncate(text);
    }

    return null;
  } catch (err) {
    console.error("[extract-document-text] No se pudo extraer texto del documento:", err);
    return null;
  }
}

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_EXTRACTED_CHARS ? `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}…` : trimmed;
}
