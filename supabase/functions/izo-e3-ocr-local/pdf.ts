import { PDFDocument } from 'npm:pdf-lib@1.17.1'
export type VerdictPdf = 'mono' | 'multi' | 'invalid' | 'neverificabil'
// În proces, fără Worker (01.11.2026): modulul worker separat, încărcat prin URL, nu intra în bundle-ul deployat (eszip ia doar
// importurile statice), deci verificarea întorcea mereu „neverificabil” și orice cerere E3 primea 409 înainte de upload.
// Un PDF care blochează parserul (max 12 MB, limitat de citesteCorp) e oprit de limita de CPU a Edge Runtime. Handler-ul verifică
// ÎNAINTE de admite, deci nu rămâne nicio cerere și nu se consumă încercarea; clientul primește 5xx și afișează eroarea
// (B4: un 5xx generic NU pornește automat rezerva Haiku), iar operatorul poate relua (Copilot #907 r2 P2-02).
export async function verificaPdf(bytes: Uint8Array): Promise<VerdictPdf> {
  const text = new TextDecoder('latin1')
  if (!text.decode(bytes.slice(0, 5)).startsWith('%PDF-') || !/%%EOF\s*$/.test(text.decode(bytes.slice(-1024)))) return 'invalid'
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true })
    if (pdf.isEncrypted || pdf.context.trailerInfo.Encrypt) return 'invalid'
    const n = pdf.getPageCount()
    // Citirea efectivă a fiecărei pagini verifică referințele arborelui.
    const pagini = pdf.getPages()
    if (n < 1 || pagini.length !== n || pagini.some(p => !Number.isFinite(p.getWidth()) || !Number.isFinite(p.getHeight()) || p.getWidth() <= 0 || p.getHeight() <= 0)) return 'invalid'
    return n === 1 ? 'mono' : 'multi'
  } catch (e) {
    // Excepțiile pdf-lib la încărcarea fișierului sunt erori de document; lipsa de memorie nu e vina documentului.
    return e instanceof Error && e.name === 'RangeError' && /memory|allocation/i.test(e.message) ? 'neverificabil' : 'invalid'
  }
}
