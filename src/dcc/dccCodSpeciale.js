// Intrările cu caractere invizibile din src/dcc/dccCodCazuri.json sunt scrise ca NUME (fișierul rămâne ASCII lizibil, fără secvențe de scăpare
// care se pot pierde la copiere); aici se transformă în textul real, cu coduri numerice. Folosit de dccCod.test.js și de proba PGlite (paritate).
const TAB = String.fromCharCode(9)
const LF = String.fromCharCode(10)
const NBSP = String.fromCharCode(160)
const SPECIALE = {
  TAB_LF: TAB + 'sr2' + LF,
  SR1_NBSP: 'SR1' + NBSP,
  TAB,
}
export const intrareReala = s => (typeof s === 'string' && Object.prototype.hasOwnProperty.call(SPECIALE, s) ? SPECIALE[s] : s)

// generator determinist (mulberry32, semință fixă): aceleași șiruri / combinații în vitest și în proba SQL <-> JS
export function generator(samanta) {
  let a = samanta >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const alege = (r, lista) => lista[Math.floor(r() * lista.length)]

// 500 de șiruri pentru proprietatea intervalului: litere / cifre / spațiu ASCII / TAB / NBSP / ß / forme apropiate de cele canonice
export function siruriInterval(n = 500, samanta = 20261124) {
  const r = generator(samanta)
  const bucati = ['general', 'GENERAL', 'General', 'SR', 'sr', 'S', 'ABCD', 'ABCDE', '1', '12', '123', '1234', ' ', TAB, LF, NBSP, 'ß', '-', '', 'R', 'x']
  const out = []
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(r() * 4)
    let s = ''
    for (let j = 0; j < k; j++) s += alege(r, bucati)
    out.push(s)
  }
  return out
}

// 500 de combinații pentru paritatea formatorului: format, componente (inclusiv valori la limită și invalide), titlu scurt, extensie
export function combinatiiFormator(formate, n = 500, samanta = 20261125) {
  const r = generator(samanta)
  const numeFormate = Object.keys(formate)
  const titluri = ['Raport lunar', 'Ședință țeavă', 'ştampilă ţ', '  __x__  ', ' — ', 'A'.repeat(70) + ' b', 'Plan 1/2 (rev)', '', 'Î', 'abc' + NBSP + 'def']
  const out = []
  for (let i = 0; i < n; i++) {
    const comp = {
      contract: alege(r, ['30', '43', '29', '3', '300']),
      emitent: alege(r, ['AAA', 'SUB', 'aaa', 'AA', null]),
      tematica: alege(r, ['TM1', 'TM2', 'TS', 'CTG2', null, 'T', 'tm1']),
      tip: alege(r, ['COR', 'DES', 'MOM', 'RAP', 'C', 'CORES']),
      secventa: alege(r, [1, 45, 99, 100, 199, 99999, 0, 100000, null]),
      fila: alege(r, [null, null, 1, 12, 99, 100, 999, 0]),
      anexa: alege(r, [null, null, null, 1, 2, 99, 100, 0]),
      revizie: alege(r, [0, 1, 2, 12, -1, null]),
      limba: alege(r, ['RO', 'EN', 'BI', null, 'FR']),
    }
    out.push({ format: alege(r, numeFormate), comp, titlu_scurt: alege(r, titluri), ext: alege(r, ['pdf', 'PDF', 'docx', 'tar.gz', '', 'abcdefghi', 'Dwg']) })
  }
  return out
}
