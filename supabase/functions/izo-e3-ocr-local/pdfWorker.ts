import { PDFDocument } from 'npm:pdf-lib@1.17.1'
// Exclusiv Deno; acest modul nu intră în bundle-ul Vercel.
self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try {
    const pdf = await PDFDocument.load(event.data, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true })
    if (pdf.isEncrypted || pdf.context.trailerInfo.Encrypt) { self.postMessage('invalid'); return }
    const n = pdf.getPageCount()
    // Citirea efectivă a fiecărei pagini verifică referințele arborelui.
    const pagini = pdf.getPages()
    if (n < 1 || pagini.length !== n || pagini.some(p => !Number.isFinite(p.getWidth()) || !Number.isFinite(p.getHeight()) || p.getWidth() <= 0 || p.getHeight() <= 0)) self.postMessage('invalid')
    else self.postMessage(n === 1 ? 'mono' : 'multi')
  } catch (e) {
    // Excepțiile pdf-lib la încărcarea fișierului sunt erori de document.
    self.postMessage(e instanceof Error && (e.name === 'RangeError' && /memory|allocation/i.test(e.message)) ? 'neverificabil' : 'invalid')
  }
}
