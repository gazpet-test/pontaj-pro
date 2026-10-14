// Monitor egress — alegerea citirii oficiale de afișat (pur, testat în monitorEgressCitire.test.js).
// d = rezultatul RPC egress_statistici (migrarea 20261030a): oficial = citirea ciclului curent, oficial_ultima = ultima din
// ORICE ciclu. Se afișează citirea curentă; dacă lipsește (colector oprit peste schimbarea ciclului), ultima din orice ciclu.
// Vechimea se calculează pe citirea AFIȘATĂ (of.citit_la), nu pe oficial_vechime_ore (aceea e a lui oficial_ultima): o
// citire curentă de 30 h nu are voie să pară proaspătă doar pentru că există una mai nouă din ciclul anterior.
export const PRAG_VECHIME_ORE = 26  // același prag ca alerta „colector oprit” din egress_detector

export function citireOficialaAfisata(d, acumMs = Date.now()) {
  const curent = d?.oficial || null
  const of = curent || d?.oficial_ultima || null
  const t = of?.citit_la ? new Date(of.citit_la).getTime() : NaN
  const citit = Number.isFinite(t) ? new Date(t) : null
  const vechimeOre = citit ? Math.max(0, (acumMs - t) / 3600000) : null
  return { curent, of, dinCicluTrecut: !curent && !!of, citit, vechimeOre, veche: vechimeOre != null && vechimeOre > PRAG_VECHIME_ORE }
}
