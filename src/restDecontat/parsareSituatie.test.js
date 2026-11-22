// Teste pentru parsarea situației de plată Transgaz în formatul F3 DOCX — fixture-uri SINTETICE care imită EXACT structura reală
// (paragrafele, ordinea, „Total=”, controlul „Cheltuieli directe din articole”, „TOTAL GENERAL DEVIZ” cu spațiu la mii), cu coduri /
// prețuri / denumiri inventate (repo public). Așteptările sunt scrise de mână (L25), nu citite din cod. Paritatea UM / cheie / câmpuri RPC
// cu migrarea 20270105a se verifică pe textul migrării (L19). Fișierele reale se testează separat, local (parsareSituatieReal.local.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import JSZip from 'jszip'
import {
  parseSituatieF3, situatieDinParagrafe, parseSituatie, parseSituatieExcel, parseDevizModificare, tipRand, toleranta, liniePentruRpc, liniePentruRpcBaza,
  CAMPURI_LINIE_RPC, CAMPURI_LINIE_RPC_BAZA, TOLERANTA_PE_LINIE_LEI, TOLERANTA_MAX_LEI, MOTIV_FORMAT_F3,
  RE_ART, RE_ART_INCEPUT, RE_TOTAL_ART, RE_OBIECT, RE_OBIECTIV, RE_DEVIZ, RE_SITUATIE, RE_PAG, RE_SEP, RE_ANTET_TABEL, RE_CHELT_DIRECTE, RE_CONTROL_ANTET,
  RE_CONTROL_NUMERE, RE_TOTAL_GENERAL, RE_GREUTATE, RE_SPORURI,
} from './parsareSituatie.js'
import { UM_LISTA, normalizeUm, acelasiUm, umCanonic, eUmCunoscut } from './um.js'
import { cheieClient } from './potrivire.js'
import { paragrafeDinDocXml, articoleDinParagrafe } from '../devizParser.js'

const MIG = fs.readFileSync(new URL('../../supabase/migrations/20270105a_executie_rest_decontat.sql', import.meta.url), 'utf8').replace(/\r/g, '')

// ── constructorul de fixture-uri F3 (structura reală, valori inventate) ──
const SEP = '================================================================='
const ANTET_TABEL = ['= NR. SIMBOL ART. CANTITATE UM PU MAT VAL MAT =', '= D E N U M I R E PU MAN VAL MAN =', '= A R T I C O L PU UTI VAL UTI =', '= PU TRA VAL TRA =', '= SPOR MAT MAN UTI GR./UA GR.TOT. T O T A L =']
const OBIECTIV = ['Obiectivul: 0999 700000001 CONDUCTA DE TEST A-B (INCL.', 'PROTECTIE SI FIBRA) -', 'LOT T']
const f2 = x => x.toFixed(2), f3 = x => x.toFixed(3)
/** „3 223.38”: mii cu spațiu, ca la TOTAL GENERAL DEVIZ / TOTAL cu TVA */
const mii = x => { const [i, z] = f2(Math.abs(x)).split('.'); return `${x < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${z}` }
function antetDeviz({ obiectCod = '0001', obiectNume = ['TRONSON 1'], luna = 10, an = 2026, devizCod = 'DZ0101', devizNume = ['4.1.1/1 Firul conductei - tronson 1'], obiectiv = OBIECTIV, situatie = true } = {}) {
  return [...obiectiv, `Obiectul: ${obiectCod} 45000000 ${obiectNume[0]}`, ...obiectNume.slice(1), ...(situatie ? [`Situatie de plata in luna ${luna} anul ${an}`] : []),
    `Deviz ${devizCod} ${devizNume[0]}`, ...devizNume.slice(1), 'Categoria de lucrari: 0999', 'Preturi de contractare. Preturile sunt exprimate in RON', SEP, ...ANTET_TABEL, SEP]
}
/** un articol F3: linia de articol + 1–4 paragrafe de denumire (fiecare cu PU / VAL la final) + rândul „gr/UA gr.tot Total= …” */
function art({ nr, cod, faza = null, um, cant, puMat = 0, denumire = ['LUCRARE DE TEST'], total }) {
  const linii = [`${nr} ${cod} ${faza != null ? `[ ${faza}] ` : ''}${um} ${f3(cant)} ${f2(puMat)} ${f2(cant * puMat)}`]
  denumire.forEach((d, i) => linii.push(`${d} ${f2(i === 0 ? 10 : 0)} ${f2(i === 0 ? 10 * cant : 0)}`))
  for (let i = denumire.length; i < 3; i++) linii.push('0.00 0.00')
  linii.push(`0.001 0 Total= ${f2(total)}`)
  return linii
}
/** blocul de după articole: controlul (ultimul număr = total), CAM, Total cheltuieli directe, indirecte, profit, TOTAL GENERAL, TVA, semnături */
function sfarsitDeviz({ total, tg }) {
  return ['Cheltuieli directe din articole:', 'GREUTATE MATERIALE MANOPERA UTILAJ TRANSPORT TOTAL', `0.021 ${f2(total / 2)} ${f2(total / 2)} 0.00 0.00 ${f2(total)}`,
    'Din care:', 'Valoare aferenta utilaje termice = 0.00', 'Valoare aferenta utilaje electrice = 0.00', 'Alte cheltuieli directe:', '-Contributie asiguratorie pentru munca',
    `( ${f2(total / 2)} + 0.00 * 0.000 +`, '0.00 * 0.000) * 0.02250 = 29.02', 'Total cheltuieli directe:', 'GREUTATE MATERIALE MANOPERA UTILAJ TRANSPORT TOTAL',
    `0.021 ${f2(total / 2)} ${f2(total / 2 + 29.02)} 0.00 0.00 ${f2(total + 29.02)}`, 'Cheltuieli indirecte:', `${f2(total + 29.02)} * 0.08000 = ${mii((total + 29.02) * 0.08)}`,
    'Profit:', `${f2((total + 29.02) * 1.08)} * 0.05000 = ${mii((total + 29.02) * 1.08 * 0.05)}`, `TOTAL GENERAL DEVIZ: ${mii(tg)}`,
    `TVA ${f2(tg)} * 21.0% = ${mii(tg * 0.21)}`, `TOTAL cu TVA ${mii(tg * 1.21)}`, 'EXECUTANT BENEFICIAR', 'INTOCMIT VERIFICAT']
}
async function docx(paragrafe) {
  const zip = new JSZip()
  const body = paragrafe.map(p => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}
const fisier = (nume, paragrafe) => ({ name: nume, arrayBuffer: async () => docx(paragrafe) })

// ── devizul D1 (reconciliat): 7 articole în formele reale — simbol alfanumeric / numeric / cu „%”, fază „[ 1]”, UM „BUC.” / „HM.” / „100 MC.” /
// „ORA” / „M” / „M.C.”, un rând de denumire care începe cu cifre („150 MM”). Suma scrisă de mână: 1313.46 + 1500 + 1705.55 + 5945 + 350 + 520.99 + 998.09 = 12333.09
const ART_D1 = [
  art({ nr: '001', cod: 'TSX01A1', um: 'BUC.', cant: 6, puMat: 3.91, denumire: ['MONTARE STALPI DE TEST CU VOL PANA', 'LA 2 MC CU MACARA DE 10-12 TF.'], total: 1313.46 }),
  art({ nr: '002', cod: '6420001', um: 'BUC.', cant: 6, puMat: 250, denumire: ['Borne de test - calculatie de', 'pret nr.2'], total: 1500 }),
  art({ nr: '003', cod: 'GX04J2', faza: 1, um: 'HM.', cant: 6.6, puMat: 11.5, denumire: ['TEAVA DE TEST CU EXECUTIE', 'MECANIZATA A LANSARII DN=600MM TEREN', 'GREU'], total: 1705.55 }),
  art({ nr: '004', cod: 'TSC04B1', um: '100 MC.', cant: 5, denumire: ['SAP.MEC.CU EXC.DE 0,71-1,25MC IN PAM.CU', 'UMIDITATE NATURAL DESC.DEP.TER.CAT.2'], total: 5945 }),
  art({ nr: '005', cod: 'AUT0001', um: 'ORA', cant: 1, denumire: ['AUTOLAB.MOBIL PT.VERIFICARI DE TEST PE', 'AUTO 3T'], total: 350 }),
  art({ nr: '006', cod: 'GD17A1%', um: 'M', cant: 2617, puMat: 0.1, denumire: ['TEAVA DIN POLIETILENA DE TEST'], total: 520.99 }),
  art({ nr: '007', cod: 'CP29E1', um: 'M.C.', cant: 3, puMat: 0.05, denumire: ['CONTROL DE TEST LA', 'COND.TEHNOLOGICE(TEHNICA A)CONDUCTA DN', '150 MM'], total: 998.09 }),
]
const SUMA_D1 = 12333.09, TG_D1 = 14123.45
const D1 = (sfarsit = sfarsitDeviz({ total: SUMA_D1, tg: TG_D1 })) => [...antetDeviz(), ...ART_D1.flat(), ...sfarsit]
// devizul D2 pe alt obiect (0005), nume de obiect și de deviz pe mai multe paragrafe; 2 articole: 100 + 40.5 = 140.5
const ART_D2 = [
  art({ nr: '011', cod: 'TSA01A1', um: 'M.C.', cant: 10, denumire: ['SAPATURA DE TEST'], total: 100 }),
  art({ nr: '012', cod: 'IZFBTT', faza: 3, um: 'MP.', cant: 8.96, puMat: 1.21, denumire: ['IZOLATIE DE TEST', 'CU BANDA'], total: 40.5 }),
]
const SUMA_D2 = 140.5, TG_D2 = 161.22
const D2 = () => [...antetDeviz({ obiectCod: '0005', obiectNume: ['NCS-CONTROL DE TEST CAP-', 'CAP - Act', 'aditional nr.1'], devizCod: 'DZ0507', devizNume: ['1.2.5/1 Pregatire culoar de lucru -', 'tronson 5'] }), ...ART_D2.flat(), ...sfarsitDeviz({ total: SUMA_D2, tg: TG_D2 })]

describe('paritate cu migrarea 20270105a (L19: o singură definiție)', () => {
  it('UM_LISTA = exact lista UM-START / UM-END din fn_rest_decontat_um', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_um'), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_rest_decontat_um('))
    const bloc = corp.match(/-- UM-START\n([\s\S]*?)-- UM-END/)
    expect(bloc).not.toBeNull()
    const sql = [...bloc[1].matchAll(/\('([0-9A-Z]+)', (\d+), '([A-Z]+)'\)/g)].map(m => [m[1], Number(m[2]), m[3]])
    expect(sql.length).toBeGreaterThan(10)
    expect(UM_LISTA).toEqual(sql)
    expect(corp).toContain("upper(regexp_replace(coalesce(p_um, ''), '[[:space:].]', '', 'g'))")
    expect(corp).toContain('coalesce(l.b, n.u), coalesce(l.m, 1)::numeric')
  })
  it('normalizeUm se comportă ca fn_rest_decontat_um pe UM-urile BRUTE din F3 („100 MC.”, „M.C.”, „BUC.”, „HM.”, „ORA”)', () => {
    expect(normalizeUm('100 MC.')).toEqual({ um: 'MC', factor: 100 })
    expect(normalizeUm('100 M.C.')).toEqual({ um: 'MC', factor: 100 })
    expect(normalizeUm('M.C.')).toEqual({ um: 'MC', factor: 1 })
    expect(normalizeUm('BUC.')).toEqual({ um: 'BUC', factor: 1 })
    expect(normalizeUm('HM.')).toEqual({ um: 'M', factor: 100 })
    expect(normalizeUm('MP.')).toEqual({ um: 'MP', factor: 1 })
    expect(normalizeUm(' ml ')).toEqual({ um: 'M', factor: 1 })
    expect(normalizeUm('to')).toEqual({ um: 'KG', factor: 1000 })
    expect(normalizeUm('ORA')).toEqual({ um: 'ORA', factor: 1 }) // necunoscut = el însuși, factor 1
    expect(normalizeUm('TONA')).toEqual({ um: 'TONA', factor: 1 }) // „TONA” nu e în lista migrării: rămâne el însuși (potrivirea cere UM egal)
    expect(normalizeUm(null)).toEqual({ um: '', factor: 1 })
    const nbsp = String.fromCharCode(160)
    expect(umCanonic(`100${nbsp}MC`)).toBe(`100${nbsp}MC`) // NBSP nu e [[:space:]] în SQL → nici aici
    expect(acelasiUm('HM.', 'ml')).toBe(true)
    expect(acelasiUm('M.C.', 'M')).toBe(false)
    expect(acelasiUm('', '')).toBe(false)
    for (const [u] of UM_LISTA) expect(eUmCunoscut(u.toLowerCase())).toBe(true)
    expect(eUmCunoscut(' m.c. ')).toBe(true)
    expect(eUmCunoscut('lei')).toBe(false)
    expect(eUmCunoscut('ORA')).toBe(false)
    expect(eUmCunoscut('')).toBe(false)
    expect(eUmCunoscut(null)).toBe(false)
  })
  it('cheieClient = fn_rest_decontat_cheie (text SQL verificat + exemple)', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_cheie('), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_rest_decontat_cheie('))
    for (const p of ['p_obiect', 'p_deviz', 'p_cod']) expect(corp).toContain(`upper(btrim(regexp_replace(coalesce(${p}, ''), '[[:space:]]+', ' ', 'g')))`)
    expect(corp).toContain("CASE WHEN p_nr IS NULL THEN '' ELSE '|#' || upper(btrim(regexp_replace(p_nr, '[[:space:]]+', ' ', 'g'))) END")
    expect(cheieClient('0001', 'DZ0101', ' tsx01a1 ', null)).toBe('0001|DZ0101|TSX01A1')
    expect(cheieClient('0001', 'DZ0101', 'tsx01a1', '2')).toBe('0001|DZ0101|TSX01A1|#2')
    expect(cheieClient(' 01\t', 'deviz  oferta\n1', 'cod', undefined)).toBe('01|DEVIZ OFERTA 1|COD')
    expect(cheieClient(null, null, null, null)).toBe('||')
    expect(cheieClient('a', 'b', 'c', '')).toBe('A|B|C|#')
  })
  it('câmpurile liniei spre RPC-uri = listele acceptate de fn_rest_decontat_confirma_situatie / _baza; liniePentruRpc* produc EXACT acele chei', () => {
    const sit = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_confirma_situatie('))
    const mSit = [...sit.matchAll(/k NOT IN \(([^)]+)\)/g)].find(x => x[1].includes("'obiect_cod'"))
    expect(mSit).toBeTruthy()
    expect([...mSit[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()).toEqual([...CAMPURI_LINIE_RPC, 'cheie', 'potrivire'].sort())
    const baza = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_confirma_baza('), MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_confirma_situatie('))
    const mBaza = [...baza.matchAll(/k NOT IN \(([^)]+)\)/g)].find(x => x[1].includes("'obiect_nume'"))
    expect(mBaza).toBeTruthy()
    expect([...mBaza[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()).toEqual([...CAMPURI_LINIE_RPC_BAZA].sort())
    // pret_unitar / cantitate_cumulat_doc pot fi null în ambele RPC-uri (textul migrării)
    expect(sit).toContain("jsonb_typeof(e->'pret_unitar') NOT IN ('number', 'null')")
    expect(baza).toContain("jsonb_typeof(e->'pret_unitar') NOT IN ('number', 'null')")
    const l = { obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'DZ0101', deviz_nume: 'X', nr: '001', cod: 'TSX01A1', denumire: 'D', um: 'BUC.', cantitate: 6, valoare: 1313.46, tip_rand: 'articol', paragraf: 20 }
    const r = liniePentruRpc(l)
    expect(Object.keys(r).sort()).toEqual([...CAMPURI_LINIE_RPC].sort())
    expect(r).toEqual({ obiect_cod: '0001', deviz_cod: 'DZ0101', nr: '001', cod: 'TSX01A1', denumire: 'D', um: 'BUC.', cantitate_perioada: 6, cantitate_cumulat_doc: null, pret_unitar: null, valoare: 1313.46, tip_rand: 'articol' })
    const b = liniePentruRpcBaza(l)
    expect(Object.keys(b).sort()).toEqual([...CAMPURI_LINIE_RPC_BAZA].sort())
    expect(b).toEqual({ obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'DZ0101', deviz_nume: 'X', nr: '001', cod: 'TSX01A1', denumire: 'D', um: 'BUC.', cantitate: 6, pret_unitar: null, valoare: 1313.46, tip_rand: 'articol' })
  })
})

describe('regexurile F3 — pozitiv și negativ (L13, ancorate)', () => {
  it('RE_ART: liniile de articol din formatul real; nu: UM cu litere mici, cantitate cu 2 zecimale, poziție cu 4 cifre, două numere', () => {
    const m = '002 M1X42A1 [ 2] BUC. 19.000 6.75 128.25'.match(RE_ART)
    expect([m[1], m[2], m[3], m[4], m[5], m[6]]).toEqual(['002', 'M1X42A1', 'BUC.', '19.000', '6.75', '128.25'])
    expect('004 TSG03B1 [ 1] 100 MP. 9.800 0.00 0.00'.match(RE_ART)[3]).toBe('100 MP.')
    expect('023 6426594 BUC. 6.000 250.00 1500.00'.match(RE_ART)[2]).toBe('6426594')
    expect('001 GD17A1% M 2617.000 0.81 2114.54'.match(RE_ART)[2]).toBe('GD17A1%')
    expect('017 CP29E1 M.C. 3.000 0.05 0.15'.match(RE_ART)[3]).toBe('M.C.')
    expect('023 TRI1AF08A6 TONA 7.500 0.00 0.00'.match(RE_ART)[3]).toBe('TONA')
    expect('003 TSA24A1 ORA -8.000 0.00 0.00'.match(RE_ART)[4]).toBe('-8.000')
    expect('001 CAB01 KM.CABL. 1.200 0.00 0.00'.match(RE_ART)[3]).toBe('KM.CABL.')
    for (const rau of ['001 TSX01A1 buc. 6.000 3.91 23.46', '001 TSX01A1 BUC. 6.00 3.91 23.46', '1001 TSX01A1 BUC. 6.000 3.91 23.46', '001 TSX01A1 BUC. 6.000 3.91', '150 MM 0.00 0.00', 'MONTARE STALPI 215.00 1290.00', '001 TSX01A1 BUC. 6.000 3.91 23.46 extra']) expect(rau, rau).not.toMatch(RE_ART)
  })
  it('RE_ART_INCEPUT: orice paragraf „nr + simbol + … + trei numere” (și cu UM nerecunoscută); nu: rândurile de denumire cu două numere, calculele CAM', () => {
    for (const bun of ['001 TSX01A1 buc. 6.000 3.91 23.46', '001 TSX01A1 BUC. 6.00 3.91 23.46', '001 TSX01A1 SET 6.000 3.91 23.46', '002 M1X42A1 [ 2] BUC. 19.000 6.75 128.25']) expect(bun, bun).toMatch(RE_ART_INCEPUT)
    for (const rau of ['150 MM 0.00 0.00', '0.00 * 0.000) * 0.02250 = 29.02', '135926.23 * 0.08000 = 10 874.10', '0.001 0 Total= 6697.50', '1001 TSX01A1 BUC. 6.000 3.91 23.46']) expect(rau, rau).not.toMatch(RE_ART_INCEPUT)
  })
  it('RE_TOTAL_ART: „0.001 0 Total= 6697.50”, „Total= -50.00”, denumire lipită; nu: „Total deviz 100.00”, „Total = 20”, „TOTAL GENERAL DEVIZ: 3 223.38”', () => {
    expect('0.001 0 Total= 6697.50'.match(RE_TOTAL_ART)[2]).toBe('6697.50')
    expect('Total= -50.00'.match(RE_TOTAL_ART)[2]).toBe('-50.00')
    const m = 'suprapunere 50% Total= 5703.69'.match(RE_TOTAL_ART)
    expect([m[1], m[2]]).toEqual(['suprapunere 50%', '5703.69'])
    for (const rau of ['Total deviz 100.00', 'Total = 20', 'TOTAL GENERAL DEVIZ: 3 223.38', 'Total= abc']) expect(rau, rau).not.toMatch(RE_TOTAL_ART)
  })
  it('antetul: Obiectivul / Obiectul (cu sau fără al doilea număr) / Situatie / Deviz (și „Deviz oferta”); nu: „DEVIZ CADRU …” în MAJUSCULE, „Devizul”, „Situatia …”', () => {
    expect('Obiectivul: 0123 774918734 COND. DE TEST -'.match(RE_OBIECTIV)[1]).toBe('0123 774918734 COND. DE TEST -')
    let m = 'Obiectul: 0001 45000000 TRONSON 1'.match(RE_OBIECT); expect([m[1], m[2]]).toEqual(['0001', 'TRONSON 1'])
    m = 'Obiectul: 01 Tronson A'.match(RE_OBIECT); expect([m[1], m[2]]).toEqual(['01', 'Tronson A'])
    m = 'Situatie de plata in luna 9 anul 2025'.match(RE_SITUATIE); expect([m[1], m[2]]).toEqual(['9', '2025'])
    m = 'Deviz BJ0103 4.1.1/1 Firul conductei - tronson 1'.match(RE_DEVIZ); expect([m[1], m[2]]).toEqual(['BJ0103', '4.1.1/1 Firul conductei - tronson 1'])
    m = 'Deviz oferta 0101 CONDUCTA'.match(RE_DEVIZ); expect([m[1], m[2]]).toEqual(['0101', 'CONDUCTA'])
    for (const rau of ['DEVIZ CADRU 1.00 2.00', 'Devizul 0101', 'deviz BJ0103 x', 'Obiectul 0001 TRONSON', 'Situatia de plata in luna 9 anul 2025', 'Situatie de plata in luna 13 anul 25']) {
      expect(rau, rau).not.toMatch(RE_DEVIZ); expect(rau, rau).not.toMatch(RE_OBIECT); expect(rau, rau).not.toMatch(RE_SITUATIE)
    }
  })
  it('zgomotul de paginare și rândurile informative: „BJ0503 pag 2”, „=====”, „= NR. SIMBOL … =”, „0.015 0”, „** SPORURI **”; nu: articole, totaluri', () => {
    expect('BJ0503 pag 2').toMatch(RE_PAG); expect('pag 2').not.toMatch(RE_PAG); expect('BJ0503 pag 2 extra').not.toMatch(RE_PAG)
    expect(SEP).toMatch(RE_SEP); expect('== x').not.toMatch(RE_SEP)
    for (const a of ANTET_TABEL) expect(a).toMatch(RE_ANTET_TABEL)
    expect('= 1 =').toMatch(RE_ANTET_TABEL); expect('=1=').not.toMatch(RE_ANTET_TABEL); expect('0.001 0 Total= 6697.50').not.toMatch(RE_ANTET_TABEL)
    expect('0.015 0').toMatch(RE_GREUTATE); expect('0.015 0 Total= 5').not.toMatch(RE_GREUTATE); expect('150 MM').not.toMatch(RE_GREUTATE)
    expect('** SPORURI ** MAT.: 100.0% MAN.: 100.0% UTI.: 100.0%').toMatch(RE_SPORURI); expect('SPORURI').not.toMatch(RE_SPORURI)
  })
  it('controlul și totalul devizului: „Cheltuieli directe din articole:”, „GREUTATE … TOTAL”, 6 numere (nu 5 / 7), „TOTAL GENERAL DEVIZ: 3 223.38” (nu „TOTAL cu TVA”)', () => {
    expect('Cheltuieli directe din articole:').toMatch(RE_CHELT_DIRECTE); expect('Total cheltuieli directe:').not.toMatch(RE_CHELT_DIRECTE); expect('Cheltuieli directe din articole: 5').not.toMatch(RE_CHELT_DIRECTE)
    expect('GREUTATE MATERIALE MANOPERA UTILAJ TRANSPORT TOTAL').toMatch(RE_CONTROL_ANTET); expect('GREUTATE MATERIALE MANOPERA UTILAJ TRANSPORT').not.toMatch(RE_CONTROL_ANTET)
    expect('0.800 5148.39 65787.00 63510.63 0.00 134446.02').toMatch(RE_CONTROL_NUMERE); expect('0.800 -5148.39 0.00 0.00 0.00 -5148.39').toMatch(RE_CONTROL_NUMERE)
    expect('0.800 5148.39 65787.00 63510.63 134446.02').not.toMatch(RE_CONTROL_NUMERE); expect('0.800 5148.39 65787.00 63510.63 0.00 1.00 134446.02').not.toMatch(RE_CONTROL_NUMERE)
    expect('TOTAL GENERAL DEVIZ: 3 223.38'.match(RE_TOTAL_GENERAL)[1]).toBe('3 223.38')
    expect('TOTAL GENERAL DEVIZ: -154 140.34'.match(RE_TOTAL_GENERAL)[1]).toBe('-154 140.34')
    for (const rau of ['TOTAL cu TVA 3 900.29', 'TOTAL GENERAL DEVIZ:', 'TOTAL GENERAL 140.00', 'total general deviz: 3 223.38']) expect(rau, rau).not.toMatch(RE_TOTAL_GENERAL)
  })
  it('tipRand: OS / diverse / articol din denumire sau cod', () => {
    expect(tipRand('ORGANIZARE DE SANTIER', 'OS01')).toBe('os'); expect(tipRand('Cheltuieli', 'OS')).toBe('os')
    expect(tipRand('Diverse si neprevazute', '')).toBe('diverse'); expect(tipRand('Lucrari neprevăzute', '')).toBe('diverse')
    expect(tipRand('SAPATURA', 'TSA01A1')).toBe('articol'); expect(tipRand('Oscilatii diverse', 'X')).toBe('diverse'); expect(tipRand('Osie', 'X')).toBe('articol')
  })
})

describe('deviz F3 reconciliat (D1: 7 articole în formele reale)', () => {
  it('situatieDinParagrafe: antet, obiect / deviz, liniile cu UM brut, denumirile fără prețuri, controlul = suma, TOTAL GENERAL cu spațiu la mii → complet', () => {
    const r = situatieDinParagrafe(D1())
    expect(r.complet).toBe(true)
    expect(r.probleme).toEqual([]); expect(r.ignorate).toEqual([]); expect(r.avertismente).toEqual([])
    expect(r.antet).toEqual({ luna: 10, an: 2026 })
    expect(r.obiectiv).toBe('0999 700000001 CONDUCTA DE TEST A-B (INCL. PROTECTIE SI FIBRA) - LOT T')
    expect(r.devize).toHaveLength(1)
    const d = r.devize[0]
    expect(d).toMatchObject({ obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'DZ0101', deviz_nume: '4.1.1/1 Firul conductei - tronson 1', luna: 10, an: 2026, suma_articole: 12333.09, control_cheltuieli_directe: 12333.09, diferenta: 0, reconciliat: true, total_general: 14123.45, toleranta: 0.07 })
    expect(d.paragraf).toBe(6) // „Deviz …” e al 6-lea paragraf (3 de Obiectivul + Obiectul + Situatie + Deviz)
    expect(r.linii).toHaveLength(7)
    expect(r.linii.map(l => [l.nr, l.cod, l.um, l.cantitate, l.valoare])).toEqual([
      ['001', 'TSX01A1', 'BUC.', 6, 1313.46], ['002', '6420001', 'BUC.', 6, 1500], ['003', 'GX04J2', 'HM.', 6.6, 1705.55], ['004', 'TSC04B1', '100 MC.', 5, 5945],
      ['005', 'AUT0001', 'ORA', 1, 350], ['006', 'GD17A1%', 'M', 2617, 520.99], ['007', 'CP29E1', 'M.C.', 3, 998.09],
    ])
    expect(r.linii[0]).toMatchObject({ obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'DZ0101', deviz_nume: '4.1.1/1 Firul conductei - tronson 1', tip_rand: 'articol', paragraf: 16, denumire: 'MONTARE STALPI DE TEST CU VOL PANA LA 2 MC CU MACARA DE 10-12 TF.' })
    expect(r.linii[1].denumire).toBe('Borne de test - calculatie de pret nr.2')
    expect(r.linii[6].denumire).toBe('CONTROL DE TEST LA COND.TEHNOLOGICE(TEHNICA A)CONDUCTA DN 150 MM') // rândul „150 MM 0.00 0.00” e denumire, nu articol
    expect(r.linii.every(l => !('incomplet' in l))).toBe(true)
    expect(r.total_citit).toBe(12333.09); expect(r.total_control).toBe(12333.09); expect(r.total_document).toBe(14123.45)
    expect(r.paragrafe).toBe(D1().length)
  })
  it('parseSituatieF3 pe un .docx real (JSZip) = același rezultat; parseSituatie / parseDevizModificare pe { name, arrayBuffer } la fel (negative: 0)', async () => {
    const buf = await docx(D1())
    const r = await parseSituatieF3(buf)
    expect(r).toEqual(situatieDinParagrafe(D1()))
    expect(await parseSituatie(fisier('F3 lucrari.docx', D1()))).toEqual(r)
    expect(await parseDevizModificare(fisier('F3 NCS.DOCX', D1()))).toEqual({ ...r, negative: 0 })
    // paragrafele vin din paragrafeDinDocXml (exportată din devizParser): entitățile XML și spațiile multiple normalizate
    const zip = await JSZip.loadAsync(buf)
    expect(paragrafeDinDocXml(await zip.file('word/document.xml').async('string'))).toEqual(D1())
  })
  it('cantitățile și valorile vin prin parseNumar (helperul existent): „2617.000” = 2617, „6.600” = 6.6, „-8.000” = −8, „154 140.34” = 154140.34', () => {
    const r = situatieDinParagrafe([...antetDeviz(), ...art({ nr: '001', cod: 'A1', um: 'M', cant: -8, total: -154140.34 }), ...sfarsitDeviz({ total: -154140.34, tg: -160000 })])
    expect(r.linii[0]).toMatchObject({ cantitate: -8, valoare: -154140.34 })
    expect(r.devize[0]).toMatchObject({ control_cheltuieli_directe: -154140.34, total_general: -160000, reconciliat: true })
  })
})

describe('controlul pe deviz → complet: false cu devizul și motivul', () => {
  it('articol lipsă (paragrafele articolului 005 scoase, controlul neschimbat): diferența = valoarea lui, 1 problemă, complet false', () => {
    const paras = D1().filter(p => !ART_D1[4].includes(p))
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(false)
    expect(r.linii).toHaveLength(6)
    expect(r.devize[0]).toMatchObject({ suma_articole: 11983.09, control_cheltuieli_directe: 12333.09, diferenta: 350, reconciliat: false, toleranta: 0.06 })
    expect(r.probleme).toHaveLength(1)
    expect(r.probleme[0]).toMatchObject({ paragraf: 6, diferenta: 350 })
    expect(r.probleme[0].motiv).toMatch(/devizul „DZ0101” \(obiectul „0001”\): suma „Total=” ale articolelor citite \(11983\.09 lei, 6 articole\) ≠ controlul „Cheltuieli directe din articole” \(12333\.09 lei\) — diferență 350 lei, toleranță 0\.06 lei/)
    expect(r.total_citit).toBe(11983.09); expect(r.total_control).toBe(12333.09)
  })
  it('articol în plus (controlul mai mic cu valoarea unui articol): diferența negativă, complet false', () => {
    const r = situatieDinParagrafe(D1(sfarsitDeviz({ total: SUMA_D1 - 1500, tg: TG_D1 })))
    expect(r.complet).toBe(false)
    expect(r.devize[0]).toMatchObject({ diferenta: -1500, reconciliat: false })
    expect(r.probleme.map(p => p.diferenta)).toEqual([-1500])
  })
  it('controlul lipsă (cele 3 paragrafe scoase): control null, problemă „nu a fost găsit”, total_control null, TOTAL GENERAL tot citit', () => {
    const paras = D1().filter(p => !/^Cheltuieli directe din articole:$/.test(p) && !/^GREUTATE/.test(p) && p !== `0.021 ${f2(SUMA_D1 / 2)} ${f2(SUMA_D1 / 2)} 0.00 0.00 ${f2(SUMA_D1)}`)
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(false)
    expect(r.devize[0]).toMatchObject({ control_cheltuieli_directe: null, diferenta: null, reconciliat: false, total_general: 14123.45, suma_articole: 12333.09 })
    expect(r.probleme).toHaveLength(1)
    expect(r.probleme[0].motiv).toMatch(/devizul „DZ0101”.*controlul „Cheltuieli directe din articole … TOTAL” nu a fost găsit — suma articolelor \(12333\.09 lei\) nu poate fi verificată/)
    expect(r.total_control).toBeNull(); expect(r.total_document).toBe(14123.45)
  })
  it('controlul fără rândul de cifre (text în locul lor) / fără rândul GREUTATE: problemă explicită, control null', () => {
    const fara = D1().map(p => (p.startsWith(`0.021 ${f2(SUMA_D1 / 2)} ${f2(SUMA_D1 / 2)} 0.00 0.00 ${f2(SUMA_D1)}`) ? 'Din care: text' : p))
    const r1 = situatieDinParagrafe(fara)
    expect(r1.complet).toBe(false); expect(r1.devize[0].control_cheltuieli_directe).toBeNull()
    expect(r1.probleme.map(p => p.motiv).join('\n')).toMatch(/după rândul GREUTATE … TOTAL nu urmează cele 6 cifre ale controlului, ci „Din care: text”/)
    expect(r1.probleme.map(p => p.motiv).join('\n')).toMatch(/controlul „Cheltuieli directe din articole … TOTAL” nu a fost găsit/)
    const faraAntet = D1().filter((p, i, a) => !(p.startsWith('GREUTATE') && a[i - 1] === 'Cheltuieli directe din articole:')).map(p => (p.startsWith('0.021 ') && p.endsWith(f2(SUMA_D1)) ? 'Din care:' : p))
    const r2 = situatieDinParagrafe(faraAntet)
    expect(r2.complet).toBe(false)
    expect(r2.probleme.map(p => p.motiv).join('\n')).toMatch(/după „Cheltuieli directe din articole” nu urmează rândul GREUTATE … TOTAL, ci „Din care:”/)
    // controlul direct după „Cheltuieli directe din articole:” (fără rândul GREUTATE) e acceptat (toleranță la formă, nu la valoare)
    const direct = D1().filter((p, i, a) => !(p.startsWith('GREUTATE') && a[i - 1] === 'Cheltuieli directe din articole:'))
    expect(situatieDinParagrafe(direct).complet).toBe(true)
  })
  it('TOTAL GENERAL DEVIZ lipsă (scos) / fișier terminat după control: total_general null, problemă, total_document null; restul reconciliat', () => {
    const r = situatieDinParagrafe(D1().filter(p => !p.startsWith('TOTAL GENERAL DEVIZ')))
    expect(r.complet).toBe(false)
    expect(r.devize[0]).toMatchObject({ total_general: null, reconciliat: true })
    expect(r.probleme).toHaveLength(1)
    expect(r.probleme[0].motiv).toMatch(/devizul „DZ0101”.*„TOTAL GENERAL DEVIZ” nu a fost găsit/)
    expect(r.total_document).toBeNull(); expect(r.total_control).toBe(12333.09)
    const d1 = D1(), taiat = d1.slice(0, d1.findIndex(p => p === 'Din care:'))
    const r2 = situatieDinParagrafe(taiat)
    expect(r2.complet).toBe(false); expect(r2.devize[0].reconciliat).toBe(true); expect(r2.probleme.map(p => p.motiv).join()).toMatch(/„TOTAL GENERAL DEVIZ” nu a fost găsit/)
  })
  it('articol fără „Total=” înaintea următorului: linia rămâne cu valoare null + incomplet, problemă; suma îl exclude → și controlul cade', () => {
    const paras = D1().filter(p => p !== '0.001 0 Total= 1500.00')
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(false)
    expect(r.linii).toHaveLength(7)
    expect(r.linii[1]).toMatchObject({ cod: '6420001', valoare: null, incomplet: 'fără „Total=” până la articolul următor' })
    expect(r.devize[0]).toMatchObject({ suma_articole: 10833.09, diferenta: 1500, reconciliat: false, toleranta: 0.06 })
    expect(r.probleme.map(p => p.motiv)).toEqual([
      expect.stringMatching(/articolul 002 „6420001” fără „Total=” până la articolul următor — valoarea lipsește din sumă/),
      expect.stringMatching(/diferență 1500 lei/),
    ])
    expect(r.probleme[0]).toMatchObject({ paragraf: 21, nr: '002', cod: '6420001' })
    // ultimul articol fără „Total=” → se oprește la „Cheltuieli directe din articole”
    const r2 = situatieDinParagrafe(D1().filter(p => p !== '0.001 0 Total= 998.09'))
    expect(r2.linii[6]).toMatchObject({ cod: 'CP29E1', valoare: null, incomplet: 'fără „Total=” până la „Cheltuieli directe din articole”' })
    expect(r2.complet).toBe(false)
  })
  it('deviz fără niciun articol: problemă (chiar dacă controlul e 0 și reconciliat)', () => {
    const r = situatieDinParagrafe([...antetDeviz(), ...sfarsitDeviz({ total: 0, tg: 0 })])
    expect(r.complet).toBe(false)
    expect(r.devize[0]).toMatchObject({ suma_articole: 0, control_cheltuieli_directe: 0, reconciliat: true })
    expect(r.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/devizul „DZ0101”.*niciun articol citit/)])
  })
})

describe('paragrafe de articol neconsumate și „Total=” orfane → probleme (nimic nu dispare tăcut)', () => {
  it('UM cu litere mici („buc.”): linia nu e articol F3 → problemă „neconsumat”; denumirile ei → ignorate; „Total=” al ei → problemă; controlul cade', () => {
    const paras = D1().map(p => (p.startsWith('005 AUT0001 ORA') ? '005 AUT0001 ora 1.000 0.00 0.00' : p))
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(false)
    expect(r.linii).toHaveLength(6)
    expect(r.probleme.map(p => [p.paragraf, p.motiv])).toEqual([
      [36, expect.stringMatching(/paragraf care arată a început de articol, dar nu are forma F3 așteptată .* — neconsumat: „005 AUT0001 ora 1\.000 0\.00 0\.00”/)],
      [40, expect.stringMatching(/„Total=” fără linie de articol înaintea lui — valoarea 350\.00 nu e a niciunui articol citit/)],
      [6, expect.stringMatching(/diferență 350 lei/)],
    ])
    expect(r.ignorate.map(i => i.text)).toEqual(['AUTOLAB.MOBIL PT.VERIFICARI DE TEST PE 10.00 10.00', 'AUTO 3T 0.00 0.00', '0.00 0.00'])
  })
  it('linia care arată a articol în MIJLOCUL unui articol deschis: problemă, nu rând de denumire (denumirea rămâne neschimbată)', () => {
    const paras = D1().flatMap(p => (p === 'LA 2 MC CU MACARA DE 10-12 TF. 0.00 0.00' ? [p, '008 XYZ01 set 2.000 1.00 2.00'] : [p]))
    const r = situatieDinParagrafe(paras)
    expect(r.linii[0].denumire).toBe('MONTARE STALPI DE TEST CU VOL PANA LA 2 MC CU MACARA DE 10-12 TF.')
    expect(r.linii).toHaveLength(7)
    expect(r.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/neconsumat: „008 XYZ01 set 2\.000 1\.00 2\.00”/)])
    expect(r.complet).toBe(false)
  })
  it('articol după controlul devizului / după TOTAL GENERAL / înaintea primului deviz: problemă cu locul, nu intră în niciun deviz', () => {
    const dupaControl = D1().flatMap(p => (p === 'Din care:' ? [p, ...art({ nr: '009', cod: 'TSX09A1', um: 'M', cant: 1, total: 5 })] : [p]))
    const r1 = situatieDinParagrafe(dupaControl)
    expect(r1.linii).toHaveLength(7); expect(r1.complet).toBe(false)
    expect(r1.probleme.map(p => p.motiv)).toEqual([
      expect.stringMatching(/linie de articol după controlul devizul „DZ0101” \(obiectul „0001”\) — nu intră în niciun deviz: „009 TSX09A1 M 1\.000/),
      expect.stringMatching(/„Total=” după controlul devizul „DZ0101”/),
    ])
    const dupaTotal = [...D1(), ...art({ nr: '009', cod: 'TSX09A1', um: 'M', cant: 1, total: 5 })]
    const r2 = situatieDinParagrafe(dupaTotal)
    expect(r2.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/linie de articol în afara devizelor \(după devizul „DZ0101”/), expect.stringMatching(/„Total=” în afara devizelor/)])
    const inainte = [...art({ nr: '009', cod: 'TSX09A1', um: 'M', cant: 1, total: 5 }), ...D1()]
    const r3 = situatieDinParagrafe(inainte)
    expect(r3.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/linie de articol înaintea primului deviz/), expect.stringMatching(/„Total=” înaintea primului deviz/)])
    expect(r3.devize[0].reconciliat).toBe(true); expect(r3.complet).toBe(false)
    // în antetul obiectului / devizului (între „Obiectul:” și „Deviz”, sau după „Deviz” înainte de „Categoria”) o linie de articol nu devine nume
    const inAntet = D1().flatMap(p => (p === 'Situatie de plata in luna 10 anul 2026' ? [p, '009 TSX09A1 M 1.000 0.00 0.00'] : [p]))
    const r4 = situatieDinParagrafe(inAntet)
    expect(r4.devize[0].obiect_nume).toBe('TRONSON 1'); expect(r4.complet).toBe(false)
    expect(r4.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/linie de articol înaintea primului deviz/)])
  })
  it('„Total=” orfan în zona articolelor (fără linie de articol deschisă): problemă cu valoarea', () => {
    const paras = D1().flatMap(p => (p === '0.001 0 Total= 1500.00' ? [p, '0.002 0 Total= 77.00'] : [p]))
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(false)
    expect(r.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/„Total=” fără linie de articol înaintea lui — valoarea 77\.00 nu e a niciunui articol citit/)])
    expect(r.devize[0].reconciliat).toBe(true) // suma nu-l conține
  })
  it('paragraf necunoscut în zona articolelor (notă liberă): intră în `ignorate` cu paragraful, nu e problemă — controlul pe sumă decide', () => {
    const paras = D1().flatMap(p => (p === '0.001 0 Total= 1500.00' ? [p, 'NOTA: text liber de test'] : [p]))
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(true)
    expect(r.ignorate).toEqual([{ paragraf: 26, deviz_cod: 'DZ0101', text: 'NOTA: text liber de test' }])
  })
  it('rândurile informative reale: „** SPORURI **” după un articol și greutățile „0.015 0” rămase după un „Total=” lipit de denumire — nici ignorate, nici probleme', () => {
    const paras = D1().flatMap(p => {
      if (p === '0.001 0 Total= 1500.00') return [p, '** SPORURI ** MAT.: 100.0% MAN.: 100.0% UTI.: 100.0%']
      if (p === '0.001 0 Total= 1705.55') return ['suprapunere 50% Total= 1705.55', '0.015 0']
      return [p]
    })
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(true); expect(r.ignorate).toEqual([])
    expect(r.linii[2].denumire).toBe('TEAVA DE TEST CU EXECUTIE MECANIZATA A LANSARII DN=600MM TEREN GREU suprapunere 50%')
    expect(r.linii[2].valoare).toBe(1705.55)
  })
})

describe('mai multe devize, obiecte diferite, paginare, antet', () => {
  it('D1 (obiect 0001) + D2 (obiect 0005), cu „pag” + „=====” între devize ȘI în mijlocul unui articol: 2 devize, 9 linii cu obiect / deviz, totalurile adunate', () => {
    const d2 = D2().flatMap(p => (p === 'IZOLATIE DE TEST 10.00 89.60' ? [p, 'DZ0507 pag 2', SEP] : [p]))
    const paras = [...D1(), 'DZ0101 pag 2', SEP, ...d2]
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(true); expect(r.probleme).toEqual([]); expect(r.ignorate).toEqual([])
    expect(r.devize.map(d => [d.obiect_cod, d.obiect_nume, d.deviz_cod, d.deviz_nume, d.linii.length, d.suma_articole, d.control_cheltuieli_directe, d.total_general, d.reconciliat])).toEqual([
      ['0001', 'TRONSON 1', 'DZ0101', '4.1.1/1 Firul conductei - tronson 1', 7, 12333.09, 12333.09, 14123.45, true],
      ['0005', 'NCS-CONTROL DE TEST CAP- CAP - Act aditional nr.1', 'DZ0507', '1.2.5/1 Pregatire culoar de lucru - tronson 5', 2, 140.5, 140.5, 161.22, true],
    ])
    expect(r.linii).toHaveLength(9)
    expect(r.linii.slice(7).map(l => [l.obiect_cod, l.deviz_cod, l.cod, l.um, l.cantitate, l.valoare, l.denumire])).toEqual([
      ['0005', 'DZ0507', 'TSA01A1', 'M.C.', 10, 100, 'SAPATURA DE TEST'], ['0005', 'DZ0507', 'IZFBTT', 'MP.', 8.96, 40.5, 'IZOLATIE DE TEST CU BANDA'],
    ])
    expect(r.antet).toEqual({ luna: 10, an: 2026 })
    expect(r.total_citit).toBe(12473.59); expect(r.total_control).toBe(12473.59); expect(r.total_document).toBe(14284.67)
  })
  it('al doilea deviz sub ACELAȘI obiect (fără „Obiectivul” / „Obiectul” repetate) moștenește obiectul și situația', () => {
    const paras = [...D1(), 'Deviz DZ0102 4.1.1/2 Subtraversare de test', 'Categoria de lucrari: 0999', SEP, ...ANTET_TABEL, SEP, ...ART_D2.flat(), ...sfarsitDeviz({ total: SUMA_D2, tg: TG_D2 })]
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(true)
    expect(r.devize[1]).toMatchObject({ obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'DZ0102', deviz_nume: '4.1.1/2 Subtraversare de test', luna: 10, an: 2026, reconciliat: true })
  })
  it('devizul fără „TOTAL GENERAL DEVIZ” urmat de alt deviz: primul e închis cu problema lui, al doilea se citește întreg', () => {
    const paras = [...D1().filter(p => !p.startsWith('TOTAL GENERAL DEVIZ')), ...D2()]
    const r = situatieDinParagrafe(paras)
    expect(r.devize).toHaveLength(2)
    expect(r.devize[0]).toMatchObject({ deviz_cod: 'DZ0101', total_general: null, reconciliat: true })
    expect(r.devize[1]).toMatchObject({ deviz_cod: 'DZ0507', total_general: 161.22, reconciliat: true })
    expect(r.probleme.map(p => p.motiv)).toEqual([expect.stringMatching(/devizul „DZ0101”.*„TOTAL GENERAL DEVIZ” nu a fost găsit/)])
    expect(r.complet).toBe(false)
  })
  it('antetul fișierului: an diferit între devize → an null + avertisment cu devizele; luna comună rămâne; fără „Situatie de plata” → ambele null + avertismente', () => {
    const r = situatieDinParagrafe([...D1(), ...antetDeviz({ obiectCod: '0005', devizCod: 'DZ0507', an: 2025 }), ...ART_D2.flat(), ...sfarsitDeviz({ total: SUMA_D2, tg: TG_D2 })])
    expect(r.complet).toBe(true)
    expect(r.antet).toEqual({ luna: 10, an: null })
    expect(r.devize.map(d => [d.luna, d.an])).toEqual([[10, 2026], [10, 2025]])
    expect(r.avertismente).toEqual([{ camp: 'an', motiv: 'devizele dau valori diferite pentru an (DZ0101: 2026; DZ0507: 2025) — câmpul rămâne de completat de om' }])
    const r2 = situatieDinParagrafe([...antetDeviz({ situatie: false }), ...ART_D1.flat(), ...sfarsitDeviz({ total: SUMA_D1, tg: TG_D1 })])
    expect(r2.antet).toEqual({ luna: null, an: null }); expect(r2.devize[0]).toMatchObject({ luna: null, an: null })
    expect(r2.avertismente.map(a => a.camp)).toEqual(['luna', 'an']); expect(r2.complet).toBe(true)
  })
  it('„Deviz oferta 0101 …” (forma ofertei) și „Obiectul: 01 Tronson A” (fără al doilea număr) se citesc', () => {
    const paras = D1().map(p => (p.startsWith('Obiectul:') ? 'Obiectul: 01 Tronson A' : p.startsWith('Deviz ') ? 'Deviz oferta 0101 CONDUCTA' : p))
    const r = situatieDinParagrafe(paras)
    expect(r.complet).toBe(true)
    expect(r.devize[0]).toMatchObject({ obiect_cod: '01', obiect_nume: 'Tronson A', deviz_cod: '0101', deviz_nume: 'CONDUCTA' })
  })
})

describe('cantități negative (NR / AA) — semnul păstrat, control cu semn', () => {
  it('articol cu −19.000 și „Total= -6697.50” lângă unul pozitiv: suma cu semn = controlul; parseDevizModificare → negative: 1', async () => {
    const paras = [...antetDeviz({ devizCod: 'NR0101' }),
      ...art({ nr: '001', cod: 'M1X42A1', faza: 2, um: 'BUC.', cant: -19, puMat: 6.75, denumire: ['CONTROL DE TEST CU ULTRASUNETE LA', 'COND.TEHNOLOGICE(TEHNICA A)CONDUCTA DN', '150 MM'], total: -6697.5 }),
      ...art({ nr: '002', cod: 'M1X42C1', faza: 3, um: 'BUC.', cant: 186, puMat: 26.99, denumire: ['CONTROL DE TEST CU ULTRASUNETE LA', 'COND TEHN.(TEHNICA A) CONDUCTA Dn 600 MM'], total: 127748.52 }),
      ...sfarsitDeviz({ total: 121051.02, tg: 138000.5 })]
    const r = await parseDevizModificare(fisier('F3 NR.docx', paras))
    expect(r.complet).toBe(true); expect(r.negative).toBe(1)
    expect(r.linii.map(l => [l.cod, l.cantitate, l.valoare])).toEqual([['M1X42A1', -19, -6697.5], ['M1X42C1', 186, 127748.52]])
    expect(r.devize[0]).toMatchObject({ suma_articole: 121051.02, control_cheltuieli_directe: 121051.02, reconciliat: true, total_general: 138000.5 })
    // semnul pierdut (|q|) ar da aceeași sumă doar dacă și controlul ar fi greșit: controlul negativ singur
    const r2 = situatieDinParagrafe([...antetDeviz(), ...art({ nr: '001', cod: 'A1', um: 'M', cant: -2, total: -20 }), ...sfarsitDeviz({ total: -20, tg: -25 })])
    expect(r2.linii[0]).toMatchObject({ cantitate: -2, valoare: -20 }); expect(r2.complet).toBe(true)
  })
})

describe('toleranța de rotunjire (0,01 lei × articole, cel mult 1 leu) — o singură definiție', () => {
  it('toleranta(n)', () => {
    expect(TOLERANTA_PE_LINIE_LEI).toBe(0.01); expect(TOLERANTA_MAX_LEI).toBe(1)
    expect(toleranta(0)).toBe(0.01); expect(toleranta(1)).toBe(0.01); expect(toleranta(2)).toBe(0.02); expect(toleranta(7)).toBe(0.07)
    expect(toleranta(100)).toBe(1); expect(toleranta(150)).toBe(1); expect(toleranta(1000)).toBe(1)
  })
  it('2 articole: control = suma + 0,01 / − 0,02 → reconciliat; + 0,03 → nu; 1 articol: + 0,01 da, + 0,02 nu', () => {
    const cu = (arts, total) => situatieDinParagrafe([...antetDeviz(), ...arts.flat(), ...sfarsitDeviz({ total, tg: 999 })])
    const doua = [art({ nr: '001', cod: 'A1', um: 'M', cant: 1, total: 10.11 }), art({ nr: '002', cod: 'A2', um: 'M', cant: 1, total: 20.22 })]
    expect(cu(doua, 30.34).complet).toBe(true); expect(cu(doua, 30.34).devize[0]).toMatchObject({ diferenta: 0.01, reconciliat: true, toleranta: 0.02 })
    expect(cu(doua, 30.31).complet).toBe(true); expect(cu(doua, 30.31).devize[0].diferenta).toBe(-0.02)
    expect(cu(doua, 30.36).complet).toBe(false); expect(cu(doua, 30.36).devize[0]).toMatchObject({ diferenta: 0.03, reconciliat: false })
    expect(cu(doua, 30.36).probleme[0].motiv).toMatch(/diferență 0\.03 lei, toleranță 0\.02 lei/)
    const una = [art({ nr: '001', cod: 'A1', um: 'M', cant: 1, total: 10.11 })]
    expect(cu(una, 10.12).complet).toBe(true); expect(cu(una, 10.13).complet).toBe(false)
  })
  it('150 de articole: plafonul de 1 leu (diferență 0,99 trece, 1,01 nu)', () => {
    const arts = Array.from({ length: 150 }, (_, i) => art({ nr: String(i + 1).padStart(3, '0'), cod: `A${i + 1}`, um: 'M', cant: 1, total: 1.01 }))
    const cu = total => situatieDinParagrafe([...antetDeviz(), ...arts.flat(), ...sfarsitDeviz({ total, tg: 999 })])
    expect(cu(151.5).devize[0]).toMatchObject({ suma_articole: 151.5, toleranta: 1, reconciliat: true })
    expect(cu(152.49).complet).toBe(true); expect(cu(152.51).complet).toBe(false)
  })
})

describe('refuzuri clare (L12 / L18: eroare, nu rezultat gol)', () => {
  it('Excel nu e format de situație Transgaz: parseSituatieExcel, parseSituatie(.xls / .xlsx / .xlsb), parseDevizModificare(.xlsx) → eroare cu motivul', async () => {
    await expect(parseSituatieExcel(new ArrayBuffer(8))).rejects.toThrow(/^format nerecunoscut: situațiile de plată Transgaz se încarcă ca F3 \.docx .*registru Excel/)
    for (const n of ['Borderou sit.3.xls', 'Centralizator.xlsx', 'extrase.xlsb']) await expect(parseSituatie({ name: n, arrayBuffer: async () => new ArrayBuffer(8) })).rejects.toThrow(/e un registru Excel \(borderoul \/ centralizatorul \/ extrasele nu sunt detaliul pe articole\)/)
    await expect(parseDevizModificare({ name: 'AA2.xlsx', arrayBuffer: async () => new ArrayBuffer(8) })).rejects.toThrow(MOTIV_FORMAT_F3)
    await expect(parseSituatie({ name: 'scan.pdf', arrayBuffer: async () => new ArrayBuffer(8) })).rejects.toThrow(/„scan\.pdf” nu e \.docx/)
    await expect(parseSituatie({ arrayBuffer: async () => new ArrayBuffer(8) })).rejects.toThrow(/„fără nume” nu e \.docx/)
  })
  it('.docx care nu e zip / fără document.xml / fără niciun „Deviz” → eroare', async () => {
    await expect(parseSituatieF3(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow(/fișierul nu e un \.docx/)
    const zip = new JSZip(); zip.file('altceva.xml', '<x/>')
    await expect(parseSituatieF3(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(/document\.xml lipsă/)
    await expect(parseSituatieF3(await docx(['Centralizator', 'Obiectul: 01 X', 'TOTAL 100.00']))).rejects.toThrow(/niciun paragraf „Deviz …” în 3 paragrafe/)
    expect(() => situatieDinParagrafe([])).toThrow(/niciun paragraf „Deviz …” în 0 paragrafe/)
    // articole fără niciun deviz: eroarea spune și problemele
    expect(() => situatieDinParagrafe(art({ nr: '001', cod: 'A1', um: 'M', cant: 1, total: 5 }))).toThrow(/2 probleme; prima: linie de articol înaintea primului deviz/)
  })
})

describe('proprietate: ștergerea oricărui articol din orice deviz cade pe controlul devizului lui, cu diferența = valoarea lui', () => {
  const lcg = s => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  it('40 de registre sintetice (1–4 devize × 1–6 articole): curate = complete; un articol șters oriunde = exact o problemă, pe devizul lui', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = lcg(seed)
      const nDev = 1 + Math.floor(rnd() * 4)
      const devize = [], valori = []
      for (let d = 0; d < nDev; d++) {
        const n = 1 + Math.floor(rnd() * 6)
        const arts = Array.from({ length: n }, (_, i) => {
          const total = Math.round((rnd() * 5000 - 500) * 100) / 100
          valori.push({ d, i, total })
          return art({ nr: String(i + 1).padStart(3, '0'), cod: `C${d}X${i}`, faza: rnd() < 0.3 ? 1 + Math.floor(rnd() * 4) : null, um: ['BUC.', 'M', '100 MC.', 'ORA', 'M.C.'][Math.floor(rnd() * 5)], cant: Math.round(rnd() * 100000) / 1000, total })
        })
        const suma = Math.round(arts.reduce((s, _, i) => s + valori.find(v => v.d === d && v.i === i).total, 0) * 100) / 100
        devize.push({ paras: [...antetDeviz({ obiectCod: `000${d + 1}`, devizCod: `DZ0${d + 1}0${d + 1}` }), ...arts.flat(), ...sfarsitDeviz({ total: suma, tg: suma * 1.2 })], arts, suma })
      }
      const curat = devize.flatMap(x => x.paras)
      const rc = situatieDinParagrafe(curat)
      expect(rc.complet, `seed ${seed} curat`).toBe(true)
      expect(rc.devize.map(x => x.linii.length)).toEqual(devize.map(x => x.arts.length))
      const tinta = valori[Math.floor(rnd() * valori.length)]
      const sters = devize[tinta.d].arts[tinta.i]
      const paras = devize.flatMap((x, d) => (d === tinta.d ? x.paras.filter(p => !sters.includes(p)) : x.paras))
      const r = situatieDinParagrafe(paras)
      expect(r.complet, `seed ${seed} șters d${tinta.d} i${tinta.i}`).toBe(false)
      // exact o problemă de reconciliere; dacă era singurul articol al devizului, în plus „niciun articol citit”
      const singur = devize[tinta.d].arts.length === 1
      expect(r.probleme.length, `seed ${seed}: ${JSON.stringify(r.probleme)}`).toBe(singur ? 2 : 1)
      const pDif = r.probleme.filter(p => p.diferenta != null)
      expect(pDif).toHaveLength(1)
      expect(pDif[0].diferenta).toBe(tinta.total)
      expect(pDif[0].motiv).toContain(`devizul „DZ0${tinta.d + 1}0${tinta.d + 1}”`)
      if (singur) expect(r.probleme[0].motiv).toMatch(/niciun articol citit/)
      expect(r.devize[tinta.d].reconciliat).toBe(false)
      expect(r.devize.filter((x, d) => d !== tinta.d).every(x => x.reconciliat)).toBe(true)
    }
  })
})

describe('devizParser (catalogul) rămâne pe calea de pe main — Rest de decontat folosește doar paragrafeDinDocXml', () => {
  it('articoleDinParagrafe implicit: linia negativă e sărită (regula veche a catalogului), rezultatul e array', () => {
    const AA_MIXT = ['Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA', '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', 'Total= 100.00', '002 TSD01B1 MC -5.000', 'UMPLUTURA COMPACTATA', 'Total= -50.00']
    const arts = articoleDinParagrafe(AA_MIXT)
    expect(Array.isArray(arts)).toBe(true)
    expect(arts.map(a => [a.cod, a.um, a.cantitate, a.valoare])).toEqual([['TSA01A1', 'mc', 10, 100]])
  })
})
