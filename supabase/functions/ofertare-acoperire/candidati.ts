// Turtirea raspunsului AI: un obiect per CERINTA (cu `candidati: []`) devine cate un obiect
// per CANDIDAT, forma pe care o stie tot restul functiei (prefixele F/E/R/D/V, blocajul pe
// asociere, R15, valabilitatea la depunere).
//
// Sta separat de index.ts ca sa poata fi testat: `src/ofertareCandidati.test.js`. Logica asta
// decide CE vede omul in ecranul pe care se sprijina depunerea — nu voiam sa se sprijine doar
// pe „a trecut build-ul".

export const PLAFON_CANDIDATI = 3

export function turtesteCandidati(lista: any[]): any[] {
  const afara: any[] = []
  for (const g of lista || []) {
    if (!g || typeof g !== 'object') continue
    const cands = Array.isArray(g.candidati)
      ? g.candidati.filter((c: any) => c && typeof c === 'object')
      : null
    // Forma veche (campurile direct pe cerinta) trece nemodificata. La fel „gol",
    // „nu_se_aplica" si „regula_propunere", care n-au candidati prin definitie.
    if (!cands || !cands.length) { afara.push(g); continue }
    cands.slice(0, PLAFON_CANDIDATI).forEach((c: any, i: number) => afara.push({
      ...g, ...c,
      candidati: undefined,
      status: c.status || g.status,
      domeniu_rte: c.domeniu_rte ?? g.domeniu_rte,
      // `clarificare` e a CERINTEI, nu a candidatului: fara asta, trei candidati ar fi
      // propus de trei ori aceeasi intrebare catre autoritate.
      clarificare: i === 0 ? g.clarificare : null,
      // Ordinea in care le-a scris modelul E judecata lui. Daca nu da scor, o pastram ca
      // scor, altfel ecranul i-ar aseza dupa `id`, adica dupa hazardul inserarii.
      scor: typeof c.scor === 'number' ? c.scor : (90 - i * 20),
    }))
  }
  return afara
}

// ── R20 în cod: sudura se potrivește pe MATERIALUL conductei ────────────────────────────
// Promptul e o rugăminte către model; asta e o verificare. Pe 21.09.2026, la Răcari (rețea de
// DISTRIBUȚIE, deci PEHD), motorul a propus pe locul 1 un „Sudor electric autorizat" (141-111,
// Ø508) la cerința NTPEE art. 236/239. Un sudor de oțel nu sudează polietilenă. Regula scrisă
// în prompt a ținut la două rerulări — dar „a ținut de două ori" e un test trecut, nu o
// constrângere. Asta e constrângerea.
//
// NU blochează sudorii de oțel: o rețea de distribuție are și porțiuni de oțel (racorduri, SRM),
// unde un candidat de oțel e legitim. Semnalează doar forma pe care a luat-o greșeala: pe o
// cerință de sudură, la o licitație de distribuție, NICIUNUL dintre candidați nu e PEHD.
// Nu șterge propunerea — omul trebuie s-o vadă — dar o marchează și îi taie scorul.

export const AVERTISMENT_PEHD =
  'ATENȚIE: obiectul e rețea de DISTRIBUȚIE (PEHD), iar candidatul e sudor de oțel — nu acoperă îmbinările PE. Verifică dacă e nevoie de sudor PEHD.'

export const eDistributie = (obiect: string) => /distribu/i.test(String(obiect || ''))
export const eCerintaDeSudura = (text: string) => /sudur|sudat|sudor|îmbinăril|imbinaril/i.test(String(text || ''))
const eSudorPehd = (tip: string) => /pehd|polietilen/i.test(String(tip || ''))
const eSudor = (tip: string) => /sudor/i.test(String(tip || ''))

/** Marchează rândurile în care toți sudorii propuși pe o cerință sunt de oțel, la distribuție.
 *  `tipAutorizatiei(id)` întoarce denumirea tipului de autorizație (ex. „Sudor PEHD"). */
export function marcheazaSudoriNepotriviti(
  rows: any[], obiectLicitatie: string,
  textCerintei: (cerintaId: number) => string,
  tipAutorizatiei: (autorizatieId: any) => string,
): number {
  if (!eDistributie(obiectLicitatie)) return 0
  const peCerinta = new Map<number, any[]>()
  for (const r of rows || []) {
    if (!peCerinta.has(r.cerinta_id)) peCerinta.set(r.cerinta_id, [])
    peCerinta.get(r.cerinta_id)!.push(r)
  }
  let marcate = 0
  for (const [cid, lista] of peCerinta) {
    if (!eCerintaDeSudura(textCerintei(cid))) continue
    const sudori = lista.filter(r => r.autorizatie_id && eSudor(tipAutorizatiei(r.autorizatie_id)))
    if (!sudori.length) continue
    if (sudori.some(r => eSudorPehd(tipAutorizatiei(r.autorizatie_id)))) continue
    for (const r of sudori) {
      r.motiv = `${AVERTISMENT_PEHD} ${String(r.motiv || '').slice(0, 200)}`.slice(0, 300)
      r.referinta_text = `⚠️ ${String(r.referinta_text || '').slice(0, 290)}`
      r.scor = Math.min(Number(r.scor ?? 50), 40)
      marcate++
    }
  }
  return marcate
}
