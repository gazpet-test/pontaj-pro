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
