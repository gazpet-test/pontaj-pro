// TKT-0329 B (PR3): rolul cantitativ pe SECȚIUNE (spec §5.0), decis înaintea filtrării, în ordinea:
//   1. antetul formularului (F3 / C6 / C7–C9, sectiuni.ts) — doar pentru listele de cantități;
//   2. marcaje pe pagină (ATR): „Aviz tehnic de racordare” ca titlu de rând, „Anexa 1 la Aviz / ATR”, „date tehnice de racordare”,
//      sau abrevierea ATR oriunde pe pagină. Un rând de cuprins / borderou numerotat („1. Aviz tehnic de racordare emis de …”) NU e marcaj;
//   3. titlul documentului (Fișa de date, Caiet de sarcini, memoriu / PTh, răspuns, planșă) și tipul lui;
//   4. decizia omului (rol_confirmat / nu_e_sursa_cantitativa, pe secțiune) — aplicată de apelant peste rezultatul de aici;
//   5. altfel „alt”.
// Funcții pure, fără rețea. Secțiunile sunt intervale [de, pana) în textul documentului, pe pagini întregi când există ⟦PAGINA n⟧.
import { sectiuniLista } from './sectiuni.ts'

export type Rol = 'f3' | 'c6' | 'lista_alt' | 'atr' | 'cs' | 'fisa_date' | 'memoriu' | 'plansa' | 'raspuns' | 'alt'
export type DecisDe = 'antet' | 'marcaj' | 'titlu' | 'model' | 'om'
export type SectiuneRol = { de: number; pana: number; pagini: [number, number] | null; rol: Rol; decis_de: DecisDe }

const faraDiacritice = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

export function rolDinTitlu(nume: string, tip: string): { rol: Rol; decis_de: DecisDe } {
  const n = faraDiacritice(nume || '').toLowerCase()
  if (tip === 'raspuns_clarificare' || /\braspuns\b|\bclarificar/.test(n)) return { rol: 'raspuns', decis_de: 'titlu' }
  if (tip === 'fisa_date' || /fisa\s*(de\s*)?date|fisadate/.test(n)) return { rol: 'fisa_date', decis_de: 'titlu' }
  if (tip === 'cs_volum' || /caiet(ul)?\s*(de\s*)?sarcini/.test(n)) return { rol: 'cs', decis_de: 'titlu' }
  if (/\bplans[ae]\b/.test(n)) return { rol: 'plansa', decis_de: 'titlu' }
  if (/memoriu|\bpth\b|proiect\s+tehnic/.test(n)) return { rol: 'memoriu', decis_de: 'titlu' }
  return { rol: 'alt', decis_de: 'titlu' }
}

const RE_ATR_TITLU = /^(?:[#*\s>\[|]*)(?:aviz(?:ul)?\s+tehnic\s+de\s+racordare|anexa\s*(?:nr\.?\s*)?1\s+la\s+(?:aviz|atr)|date\s+tehnice\s+de\s+racordare)/i
const RE_ATR_ORIUNDE = /\bATR\b|anexa\s*(?:nr\.?\s*)?1\s+la\s+(?:avizul|atr)|date\s+tehnice\s+de\s+racordare/i
const RE_LISTA_NUMEROTATA = /^\s*(?:\d{1,3}[.)]|[a-z][.)]|[-•])\s+/i

export function paginaAreMarcajAtr(pagina: string): boolean {
  for (const linie0 of pagina.split('\n')) {
    const linie = faraDiacritice(linie0)
    if (RE_LISTA_NUMEROTATA.test(linie) && !/\bATR\b/.test(linie)) continue
    if (RE_ATR_TITLU.test(linie.replace(/^\[PLANSA:\s*/i, '')) || RE_ATR_ORIUNDE.test(linie)) return true
  }
  return false
}

// paginile unui text: [{nr, de, pana}] după ⟦PAGINA n⟧; fără marcaje = o singură „pagină” fără număr
export function pagini(t: string): { nr: number | null; de: number; pana: number }[] {
  const out: { nr: number | null; de: number; pana: number }[] = []
  const re = /⟦PAGINA\s*(\d{1,5})⟧/g
  let m: RegExpExecArray | null, prev: { nr: number | null; de: number } | null = null
  while ((m = re.exec(t)) !== null) {
    if (prev) out.push({ ...prev, pana: m.index })
    else if (m.index > 0) out.push({ nr: null, de: 0, pana: m.index })
    prev = { nr: Number(m[1]), de: m.index }
  }
  if (prev) out.push({ ...prev, pana: t.length })
  if (!out.length) out.push({ nr: null, de: 0, pana: t.length })
  return out
}

const ROL_ANTET: Record<string, Rol> = { lista_f3: 'f3', lista_c6: 'c6', lista_alt: 'lista_alt' }

export function sectiuniRol(text: string, nume: string, tip: string): SectiuneRol[] {
  const t = text || ''
  const titlu = rolDinTitlu(nume, tip)
  const pe: { de: number; pana: number; nr: number | null; rol: Rol; decis_de: DecisDe }[] = []
  if (tip === 'lista_cantitati') {
    // 1. antetul formularului; o listă fără niciun antet rămâne F3 după TITLU (tipul documentului), nu după antet
    const sect = sectiuniLista(t)
    const areAntet = /Formular\s*[FC]\s*\d|Lista\s+cu\s+cantit|Lista\s+cuprinz/i.test(t)
    for (const s of sect) pe.push({ de: s.de, pana: s.pana, nr: null, rol: ROL_ANTET[s.tip], decis_de: areAntet ? 'antet' : 'titlu' })
  } else {
    for (const p of pagini(t)) {
      const atr = paginaAreMarcajAtr(t.slice(p.de, p.pana))
      pe.push({ de: p.de, pana: p.pana, nr: p.nr, rol: atr ? 'atr' : titlu.rol, decis_de: atr ? 'marcaj' : titlu.decis_de })
    }
  }
  // comasare: pagini consecutive cu același rol și aceeași sursă a deciziei
  const out: SectiuneRol[] = []
  for (const s of pe) {
    const ult = out[out.length - 1]
    const nrPag = s.nr ?? paginaPrima(t, s.de)
    if (ult && ult.rol === s.rol && ult.decis_de === s.decis_de && ult.pana === s.de) {
      ult.pana = s.pana
      if (ult.pagini && nrPag !== null) ult.pagini[1] = Math.max(ult.pagini[1], paginaUltima(t, s.de, s.pana) ?? nrPag)
    } else {
      const ultima = paginaUltima(t, s.de, s.pana)
      out.push({ de: s.de, pana: s.pana, pagini: nrPag !== null ? [nrPag, ultima ?? nrPag] : null, rol: s.rol, decis_de: s.decis_de })
    }
  }
  return out
}

function paginaPrima(t: string, de: number): number | null {
  const i = t.lastIndexOf('⟦PAGINA', de)
  const j = t.indexOf('⟦PAGINA', de)
  const k = i >= 0 ? i : j
  if (k < 0) return null
  const m = /⟦PAGINA\s*(\d{1,5})/.exec(t.slice(k, k + 20))
  return m ? Number(m[1]) : null
}
function paginaUltima(t: string, de: number, pana: number): number | null {
  const i = t.lastIndexOf('⟦PAGINA', Math.max(de, pana - 1))
  if (i < 0) return null
  const m = /⟦PAGINA\s*(\d{1,5})/.exec(t.slice(i, i + 20))
  return m ? Number(m[1]) : null
}

// secțiunea în formatul deciziilor umane: „*” (tot documentul) sau „a-b” (pagini)
export function cheieSectiune(s: SectiuneRol, totDocumentul: boolean): string {
  return totDocumentul || !s.pagini ? '*' : `${s.pagini[0]}-${s.pagini[1]}`
}
