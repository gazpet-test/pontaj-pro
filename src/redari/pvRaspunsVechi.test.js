// PV tip B pentru un răspuns VECHI cu opțiunea retrasă „nu_particip_cu_obiectii” (decizia Răzvan 17.11.2026, juridic#046: nu se mai
// oferă la răspunsuri noi, dar răspunsurile vechi rămân valabile). Documentul real din public/redari/sabloane/pv_b.docx, date fictive.
// Rândul așteptat e scris din textul șablonului (paragraful „{{bifa_fara_raspuns}} fără răspuns … alt răspuns: {{raspuns_alt_text}}”),
// nu din pv.js.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { genereazaPvB, BIFA_DA, BIFA_NU } from './pv.js'

const RX_P = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
const RX_T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const decodeaza = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const OBIECTII = 'Gard nerefăcut pe latura de nord (text fictiv)'
const date = raspunsuri => ({
  proiect: { contract_nr: 'TEST-1', contract_data: '2026-11-02', denumire: 'Test', reprezentant_gazpet_nume: 'FICTIV G', reprezentant_tgz_nume: 'FICTIV T' },
  uat: { nume: 'UAT TEST', reprezentant_uat_nume: 'FICTIV U', sesiune_zi1: '2026-12-10', afisare_data_start: '2026-11-20', afisare_data_end: '2026-12-12' },
  parcela: { tronson: 3, categoria_folosinta: 'Arabil', verificare_data: '2026-12-11', verificare_de_gazpet: 'G', verificare_de_tgz: 'T' },
  pv: { nr_pv: 'PVB-ZZZ-0001', data_pv: '2026-12-13', locul: 'Test', motiv_pv_b: 'neprezentat', lucrari: { nivelare: true }, stare_teren: { nivelat: true } },
  detinatori: [{ id: 'd1', nume: 'FICTIV UNU', calitate: 'proprietar' }],
  convocari: [{ id: 'c1', detinator_id: 'd1', stare: 'activ', sters_la: null, canal: 'posta', created_at: '2026-11-20', data_expediere: '2026-11-20', data_confirmare_primire: '2026-11-23', nr_document: 'C-0001' }],
  raspunsuri, pvs: [],
  templateArrayBuffer: readFileSync('public/redari/sabloane/pv_b.docx'),
})
const paragrafe = async r => {
  const xml = await (await JSZip.loadAsync(await r.blob.arrayBuffer())).file('word/document.xml').async('string')
  return [...xml.matchAll(RX_P)].map(m => decodeaza([...m[0].matchAll(RX_T)].map(t => t[1]).join(''))).filter(Boolean)
}

describe('PV B cu răspunsul vechi „nu particip, cu obiecții”', () => {
  it('bifa „alt răspuns” și textul obiecțiilor apar în document; „fără răspuns” / „fără obiecții” nebifate', async () => {
    const r = await genereazaPvB(date([{ id: 'r1', detinator_id: 'd1', canal: 'telefon', data: '2026-11-25', seq: 1, optiune: 'nu_particip_cu_obiectii', obiectii_text: OBIECTII }]))
    expect(r.campuri).toMatchObject({ bifa_fara_raspuns: BIFA_NU, bifa_raspuns_fara_obiectii: BIFA_NU, bifa_alt_raspuns: BIFA_DA, raspuns_alt_text: OBIECTII })
    const p = await paragrafe(r)
    expect(p).toContain(`${BIFA_NU} fără răspuns  ${BIFA_NU} nu particip, fără obiecții  ${BIFA_DA} alt răspuns: ${OBIECTII}`)
  })
  it('martor: răspunsul nou „nu particip, fără obiecții” bifează rubrica lui, nu „alt răspuns”', async () => {
    const r = await genereazaPvB(date([{ id: 'r1', detinator_id: 'd1', canal: 'online', data: '2026-11-25', seq: 1, optiune: 'nu_particip_fara_obiectii', obiectii_text: null }]))
    expect(r.campuri).toMatchObject({ bifa_fara_raspuns: BIFA_NU, bifa_raspuns_fara_obiectii: BIFA_DA, bifa_alt_raspuns: BIFA_NU })
  })
})
