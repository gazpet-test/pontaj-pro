// zipFlux.mjs — parcurgerea ÎN FLUX a unui ZIP (antetele locale), comună edge-ului ofertare-seap-import (ZIP inline +
// rezerva DownloadArchive) și /api/seap-import (copia byte cu byte api/_zipFlux.js — funcțiile Vercel nu importă din afara api/).
//
// Audit Jakarinos 07.10.2026:
//  #9  — parserul vechi trata ORICE octeți care nu erau antet local (data descriptor, gunoi, flux tăiat) ca „sfârșit normal”:
//        documentele rămase dispăreau fără urmă, iar api-ul marca documentația „adusă”. Acum sfârșitul e valid DOAR la
//        directorul central / înregistrarea finală; EOF înainte, antet necunoscut, intrare cu „data descriptor” fără
//        dimensiuni în antet, ZIP64 → { complet: false, motiv } — apelantul raportează eroarea și predă arhiva workerului
//        NAS (extractorul izolat 7-Zip), nu declară importul reușit.
//  #10 — decomprimarea nu avea plafon (bombă ZIP: câțiva KB → GB în memorie). Acum ieșirea fiecărei intrări e plafonată
//        la min(maxIesire, mărimea declarată în antet) și verificată la final (mărimea reală = cea declarată).
// Intrări criptate / metode necunoscute (doar 0 stored și 8 deflate) → eroare pe intrare (apelantul o vede), nu gunoi urcat.
// Folderele („dir/”) nu sunt fișiere: se sar.

export const SIG_LOCAL = 0x04034b50
export const SIG_CENTRAL = 0x02014b50
export const SIG_FINAL = 0x06054b50
export const SIG_DESCRIPTOR = 0x08074b50

const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** Coadă peste un ReadableStreamDefaultReader, fără concatenări repetate. */
export class Flux {
  /** @param {ReadableStreamDefaultReader<Uint8Array>} rdr */
  constructor(rdr) { this.rdr = rdr; this.coada = []; this.disponibil = 0; this.gata = false }
  async umple(n) {
    while (this.disponibil < n && !this.gata) {
      const { value, done } = await this.rdr.read()
      if (done || !value) { this.gata = true; break }
      const v = value instanceof Uint8Array ? value : new Uint8Array(value)
      this.coada.push(v)
      this.disponibil += v.length
    }
  }
  scoate(n, consuma = true) {
    const cat = Math.min(n, this.disponibil)
    const out = new Uint8Array(cat)
    let pus = 0, i = 0
    while (pus < cat) {
      const b = this.coada[i]
      const iau = Math.min(b.length, cat - pus)
      out.set(b.subarray(0, iau), pus)
      pus += iau
      if (consuma) {
        if (iau === b.length) this.coada.shift(); else this.coada[0] = b.subarray(iau)
      } else i++
    }
    if (consuma) this.disponibil -= cat
    return out
  }
  /** Exact n octeți sau null (flux terminat înainte). */
  async exact(n) { await this.umple(n); return this.disponibil >= n ? this.scoate(n) : null }
  /** Primii n octeți, fără a-i consuma (null dacă nu mai sunt n). */
  async priveste(n) { await this.umple(n); return this.disponibil >= n ? this.scoate(n, false) : null }
  async sari(n) {
    let ramas = n
    while (ramas > 0) {
      await this.umple(Math.min(ramas, 1 << 20))
      if (this.disponibil === 0) return false
      ramas -= this.scoate(Math.min(ramas, this.disponibil)).length
    }
    return true
  }
}

/** Flux peste un buffer deja în memorie (ZIP-ul dinăuntrul unui document adus per fișier). */
export const fluxDinBuf = (b) => new Flux(new Blob([b]).stream().getReader())

/** Decomprimă o intrare, cu plafon de ieșire. metoda 0 = stored, 8 = deflate; altceva = eroare.
 *  @param {Uint8Array} comprimat @param {number} metoda @param {number} maxIesire */
export async function dezumfla(comprimat, metoda, maxIesire) {
  if (metoda === 0) {
    if (comprimat.length > maxIesire) throw new Error(`intrare peste limita de ${maxIesire} octeți`)
    return comprimat
  }
  if (metoda !== 8) throw new Error(`metodă de compresie nesuportată (${metoda}) — o despachetează extractorul de pe NAS`)
  const rdr = new Blob([comprimat]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const bucati = []
  let tot = 0
  for (;;) {
    const { value, done } = await rdr.read()
    if (done) break
    tot += value.length
    if (tot > maxIesire) {
      try { await rdr.cancel() } catch (_) { /* deja închis */ }
      throw new Error(`decomprimat peste limita de ${maxIesire} octeți (mărimea din antet) — posibilă bombă ZIP, oprit`)
    }
    bucati.push(value)
  }
  const out = new Uint8Array(tot)
  let p = 0
  for (const x of bucati) { out.set(x, p); p += x.length }
  return out
}

/** Parcurge ZIP-ul. `vrea(h)` decide dacă intrarea se citește; `primeste(h, brut)` întoarce 'stop' ca să oprească (buget);
 *  `eroare(nume, motiv)` primește erorile pe intrare (parcurgerea continuă). Rezultat: { complet, oprit, motiv } —
 *  complet = am ajuns la directorul central (sau oprirea a fost cerută de apelant); altfel motivul.
 *  @param {Flux} flux
 *  @param {(h: {nume: string, metoda: number, csize: number, usize: number, flags: number}) => boolean} vrea
 *  @param {(h: any, brut: Uint8Array) => Promise<'stop' | 'continua'>} primeste
 *  @param {(nume: string, motiv: string) => void} eroare
 *  @param {{ maxIesire: number }} opt */
export async function parcurgeZip(flux, vrea, primeste, eroare, opt) {
  const maxIesire = opt?.maxIesire ?? 200 * 1024 * 1024
  const sariDescriptor = async () => {   // după date: [semnătură] crc32 csize usize (12 sau 16 octeți)
    const p = await flux.priveste(4)
    if (!p) return false
    return flux.sari(u32(p, 0) === SIG_DESCRIPTOR ? 16 : 12)
  }
  const trunchiata = { complet: false, oprit: false, motiv: 'arhivă trunchiată (fluxul s-a terminat înainte de directorul central)' }
  for (;;) {
    const sig = await flux.priveste(4)
    if (!sig) return trunchiata
    const s = u32(sig, 0)
    if (s === SIG_CENTRAL || s === SIG_FINAL) return { complet: true, oprit: false, motiv: null }
    if (s !== SIG_LOCAL) return { complet: false, oprit: false, motiv: `antet necunoscut 0x${s.toString(16)} în arhivă (format nesuportat în flux)` }
    const head = await flux.exact(30)
    if (!head) return trunchiata
    // anti-bug 1 (15.09): csize la 18, usize la 22
    const h = { flags: u16(head, 6), metoda: u16(head, 8), csize: u32(head, 18), usize: u32(head, 22), nume: '' }
    const nl = u16(head, 26), el = u16(head, 28)
    const numeBuf = await flux.exact(nl)
    if (!numeBuf) return trunchiata
    h.nume = new TextDecoder().decode(numeBuf)
    if (el && !(await flux.sari(el))) return trunchiata
    const descriptor = (h.flags & 0x08) !== 0
    if (descriptor && h.csize === 0) {
      return { complet: false, oprit: false, motiv: `intrare cu „data descriptor” (mărimi necunoscute în antet): ${h.nume} — nu se poate parcurge în flux` }
    }
    if (h.csize === 0xffffffff || h.usize === 0xffffffff) return { complet: false, oprit: false, motiv: `ZIP64 (${h.nume}) — nesuportat în flux` }
    const eDosar = /\/$/.test(h.nume) && h.usize === 0
    const criptat = (h.flags & 0x01) !== 0
    if (eDosar || criptat || !vrea(h)) {
      if (criptat && !eDosar) eroare(h.nume, 'intrare criptată (parolă) — nu se poate citi')
      if (!(await flux.sari(h.csize))) return trunchiata
      if (descriptor && !(await sariDescriptor())) return trunchiata
      continue
    }
    // review PR-C P2 (#10, partea de memorie): csize vine din antet — nu se citește în memorie mai mult decât poate ieși
    // legitim (plafonul + marja deflate), iar o intrare stocată are csize = usize. Altfel: eroare pe intrare, octeții săriți
    // în flux (fără buffer), parcurgerea continuă aliniată.
    if (h.csize > maxIesire + 65536 || (h.metoda === 0 && h.csize !== h.usize)) {
      eroare(h.nume, h.metoda === 0 && h.csize !== h.usize
        ? `intrare stocată cu mărimi diferite în antet (${h.csize} ≠ ${h.usize}) — coruptă`
        : `intrare comprimată de ${h.csize} octeți, peste limita de ${maxIesire} — nu se citește în memorie`)
      if (!(await flux.sari(h.csize))) return trunchiata
      if (descriptor && !(await sariDescriptor())) return trunchiata
      continue
    }
    const comprimat = await flux.exact(h.csize)
    if (!comprimat) return trunchiata
    if (descriptor && !(await sariDescriptor())) return trunchiata
    let brut
    try {
      brut = await dezumfla(comprimat, h.metoda, Math.min(maxIesire, h.usize))
      if (brut.length !== h.usize) throw new Error(`mărime decomprimată ${brut.length} ≠ ${h.usize} din antet — intrare coruptă`)
    } catch (e) {
      eroare(h.nume, String(e?.message || e))
      continue
    }
    if ((await primeste(h, brut)) === 'stop') return { complet: true, oprit: true, motiv: null }
  }
}
