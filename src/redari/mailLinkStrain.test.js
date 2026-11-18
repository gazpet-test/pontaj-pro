// Redări e-mail — linkul personal STRĂIN, runda 3 (Jakarinos #1138 P1 pe b6f0f85b: tokenul procent-codificat „%54…” trecea de detector, iar routerul
// îl decodează și deschide formularul altui destinatar). Partea JS a probelor:
//  * linkStrain / areLinkLiteral (redariMailF2.mjs) pe tabelul COMUN src/redari/__tests__/link_strain_cazuri.json — același tabel îl primește
//    fn_red_mail_f2_link_strain în PGlite (scripts/pglite/test_redari_mail_link_local.mjs), pe aceleași tokenuri fictive (L19);
//  * tabelele de caractere (INVIZIBILE / LINIUTE / ENTITATI), expresiile %XX / entități, limita de treceri și calea = cele din textul migrării;
//  * mutanți pe normalizare (fără decodare %XX, fără entități, fără invizibile, fără NFKC, fără ferestre): fiecare TREBUIE să pice pe tabel;
//  * dovada pe b6f0f85b (head-ul runzii 2, SHA fix): helperul de atunci lasă să treacă formele codificate.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { linkStrain, areLinkLiteral, formaCautareLink, areCaleRaspuns, INVIZIBILE_LINK, LINIUTE_LINK, ENTITATI_LINK, TRECERI_LINK, PREFIX_LINK_RASPUNS } from './mailLoturi.js'
import { linkRaspuns } from './docx.js'

const citeste = cale => readFileSync(cale, 'utf8').replace(/\r\n/g, '\n')
const MIG = citeste('supabase/migrations/20261131i_redari_mail_link_personal.sql')
const TAB = JSON.parse(citeste('src/redari/__tests__/link_strain_cazuri.json'))
const CAZ = TAB.cazuri
const tok = c => c.token == null ? null : TAB.tokeni[c.token]
const caz = id => { const c = CAZ.find(x => x.id === id); if (!c) throw new Error('lipsește cazul ' + id); return c }
// head-ul runzii 2 (NO-GO Jakarinos r2): dovada nu depinde de ce mai intră pe branch
const SHA_R2 = 'b6f0f85b'

describe('tabelul comun de cazuri (același în PGlite)', () => {
  it('tokenurile fictive = cele din proba PGlite (T1…, T2…, toți deținătorii cu token)', () => {
    expect(TAB.tokeni.A).toBe('T1' + 'a'.repeat(41)); expect(TAB.tokeni.B).toBe('T2' + 'b'.repeat(41))
    expect(TAB.tokeni_existenti).toHaveLength(9); expect(TAB.tokeni_existenti).toContain(TAB.tokeni.A); expect(TAB.tokeni_existenti).toContain(TAB.tokeni.B)
    for (const t of TAB.tokeni_existenti) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
  it('acoperă cazurile cerute de review: %54 + rest, tot codificat, dublu, rupt (spațiu / linie / zero-width), entitate, majuscule; pozitive cu „20%” și URL străin', () => {
    for (const id of ['n01_pct54_rest_literal', 'n02_token_tot_codificat_in_cale', 'n03_dublu_codificat', 'n05_token_rupt_spatiu', 'n06_token_rupt_linie',
      'n07_token_rupt_zero_width', 'n08_entitate_zecimala', 'n11_cale_majuscule', 'n25_pct54_fara_cale', 'n27_tot_dublu_codificat_fara_cale']) expect(caz(id).asteptat).toBe(true)
    for (const id of ['p01_procent_text', 'p02_url_strain_codificat', 'p04_text_normal']) expect(caz(id).asteptat).toBe(false)
    expect(caz('n07_token_rupt_zero_width').text).toContain(String.fromCharCode(0x200B))
    expect(CAZ.filter(c => c.token).length).toBeGreaterThanOrEqual(8)
    expect(new Set(CAZ.map(c => c.id)).size).toBe(CAZ.length)
  })
  it.each(CAZ.map(c => [c.id, c]))('%s', (_, c) => {
    expect(linkStrain(c.text, tok(c), TAB.tokeni_existenti)).toBe(c.asteptat)
  })
  it('ecranul (fără tokenuri, doar calea) e o submulțime a serverului: nu refuză nimic din ce serverul acceptă și prinde calea oricum scrisă', () => {
    for (const c of CAZ.filter(x => x.token == null)) if (areLinkLiteral(c.text)) expect(c.asteptat).toBe(true)
    for (const id of ['n01_pct54_rest_literal', 'n02_token_tot_codificat_in_cale', 'n03_dublu_codificat', 'n08_entitate_zecimala', 'n11_cale_majuscule', 'n12_cale_singura',
      'n13_cale_codificata', 'n14_cale_backslash', 'n15_cale_segmente_punct', 'n16_cale_rupta_spatii', 'n21_percnt', 'n24_tab_in_cale']) expect(areLinkLiteral(caz(id).text)).toBe(true)
    expect(areLinkLiteral(null)).toBe(false); expect(areLinkLiteral(undefined)).toBe(false); expect(linkStrain(null, null, TAB.tokeni_existenti)).toBe(false)
  })
  it('forma de căutare: decodare până la punct fix, sensibilitatea la majuscule a tokenului păstrată', () => {
    expect(formaCautareLink('a %2554 b')).toBe('aTb')
    expect(formaCautareLink('&#x54;&#84;&amp;#84;')).toBe('TTT')
    expect(formaCautareLink(`x${String.fromCharCode(0x200B)}y${String.fromCharCode(0xAD)}z\n w`)).toBe('xyzw')
    expect(formaCautareLink('%252525')).toBe('%')                                   // %252525 → %2525 → %25 → %: stabil
    expect(formaCautareLink('%' + '25'.repeat(TRECERI_LINK + 2) + '54')).toBeNull()
    expect(formaCautareLink('AbC')).toBe('AbC')                                     // literele NU se schimbă (tokenul e sensibil la caz)
    expect(linkStrain('cod: t1' + 'a'.repeat(41), null, TAB.tokeni_existenti)).toBe(false)   // „t1…” nu e tokenul „T1…”
    expect(areCaleRaspuns('/REDARI//x/../RASPUNS')).toBe(true); expect(areCaleRaspuns('/redari_raspuns')).toBe(false)
  })
})

describe('o singură definiție: tabelele și expresiile JS = cele din migrare', () => {
  const bloc = MIG.slice(MIG.indexOf('-- >>> TABEL-LINK 20261131i'), MIG.indexOf('-- <<< TABEL-LINK 20261131i'))
  const jsonDin = nume => JSON.parse(new RegExp(` ${nume} constant jsonb:='([^']+)';`).exec(bloc)[1])
  it('INVIZIBILE / LINIUTE / ENTITATI', () => {
    expect(bloc.length).toBeGreaterThan(100)
    expect(jsonDin('inviz')).toEqual(INVIZIBILE_LINK)
    expect(jsonDin('liniute')).toEqual(LINIUTE_LINK)
    expect(jsonDin('entitati')).toEqual({ ...ENTITATI_LINK })
  })
  it('expresiile %XX și entități, limita de treceri, calea, prefixul linkului', () => {
    // r4: expresiile stau o singură dată în constantele rx_pct / rx_ent ale formei de căutare, folosite și la despărțire, și la potriviri
    expect(MIG).toContain(" rx_pct constant text:='%[0-9A-Fa-f]{2}';")
    expect(MIG).toContain('regexp_split_to_array(v,rx_pct)'); expect(MIG).toContain("regexp_matches(v,rx_pct,'g')")
    const ent = '&#[0-9]{1,7};?|&#[xX][0-9A-Fa-f]{1,6};?|&[A-Za-z][A-Za-z0-9]{1,31};'
    expect(MIG).toContain(` rx_ent constant text:='${ent}';`)
    expect(MIG).toContain('regexp_split_to_array(v,rx_ent)'); expect(MIG).toContain("regexp_matches(v,rx_ent,'g')")
    const sursa = citeste('supabase/functions/_shared/redariMailF2.mjs')
    expect(sursa).toContain(`const RX_ENTITATE = /${ent}/g`); expect(sursa).toContain('const RX_PROCENT = /%[0-9A-Fa-f]{2}/g')
    expect(MIG.split('FOR k IN 1..12 LOOP').length - 1).toBe(2); expect(TRECERI_LINK).toBe(12)
    expect(MIG).toContain("position('redari/raspuns' IN pc)>0"); expect(sursa).toContain("c.includes('redari/raspuns')")
    expect(MIG).toContain("regexp_matches(v,'[A-Za-z0-9_-]{43,}','g')"); expect(sursa).toContain('f.matchAll(/[A-Za-z0-9_-]{43,}/g)')
    expect(MIG).toContain('v:=normalize(p_text,NFKC);'); expect(sursa).toContain(".normalize('NFKC')")
    for (const t of [TAB.tokeni.A, TAB.tokeni.B]) expect(PREFIX_LINK_RASPUNS + t).toBe(linkRaspuns(t))
  })
})

// ── MUTANȚI pe normalizare: modulul copiat cu O linie schimbată (text unic), apoi tabelul — fiecare mutant TREBUIE să pice cel puțin un caz ──
describe('mutanți pe normalizare (fiecare pică pe tabel)', () => {
  const SURSA = citeste('supabase/functions/_shared/redariMailF2.mjs')
  const MUTANTI = [
    ['fără decodarea %XX', '    v = v.replace(RX_PROCENT, p => asciiTiparibil(parseInt(p.slice(1), 16)))', '', ['n25_pct54_fara_cale', 'n13_cale_codificata', 'n04_token_codificat_fara_cale']],
    ['fără entitățile HTML', '    v = v.replace(RX_ENTITATE, decodeazaEntitate)', '', ['n09_entitate_hexa_fara_cale', 'n10_entitate_amp_imbricata']],
    ['fără invizibile (spații, linii, zero-width)', "    v = v.replace(RX_INVIZIBILE, '').replace(RX_LINIUTE, '-')", "    v = v.replace(RX_LINIUTE, '-')", ['n05_token_rupt_spatiu', 'n06_token_rupt_linie', 'n07_token_rupt_zero_width']],
    ['fără NFKC', "  let v = String(text ?? '').normalize('NFKC')", "  let v = String(text ?? '')", ['n17_litera_lata_nfkc']],
    ['doar tokenul delimitat (fără ferestre)', '  for (const m of f.matchAll(/[A-Za-z0-9_-]{43,}/g)) for (let i = 0; i + 43 <= m[0].length; i++) if (alti.has(m[0].slice(i, i + 43))) return true',
      '  for (const m of f.matchAll(/[A-Za-z0-9_-]{43,}/g)) if (alti.has(m[0])) return true', ['n18_token_lipit_de_text']],
    ['un singur pas de decodare (fără punct fix)', '    if (v === ant) return v', '    return v', ['n26_dublu_fara_cale', 'n27_tot_dublu_codificat_fara_cale']],
  ]
  it.each(MUTANTI.map(m => [m[0], m]))('%s', async (_, [, din, in_, picate]) => {
    expect(SURSA.split(din).length).toBe(2)   // textul mutat e unic în modul
    const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
    const dir = mkdtempSync(join(TMP, 'mail_mutant_'))
    try {
      writeFileSync(join(dir, 'redariMailF2.mjs'), SURSA.split(din).join(in_))
      const mod = await import(pathToFileURL(join(dir, 'redariMailF2.mjs')).href + `?v=${Date.now()}`)
      const gresite = CAZ.filter(c => mod.linkStrain(c.text, tok(c), TAB.tokeni_existenti) !== c.asteptat).map(c => c.id)
      for (const id of picate) expect(gresite).toContain(id)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('dovada pe b6f0f85b (runda 2): formele codificate treceau', () => {
  it('helperul de atunci acceptă %54 + rest, calea codificată și calea cu majuscule fără token de 43; cel nou le refuză', async () => {
    const vechi = (() => { try { return execFileSync('git', ['show', `${SHA_R2}:supabase/functions/_shared/redariMailF2.mjs`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n') } catch { return null } })()
    if (!vechi) return   // fără istoric local (clonă superficială): se sare, nu se simulează
    const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
    const dir = mkdtempSync(join(TMP, 'mail_r2_'))
    try {
      writeFileSync(join(dir, 'redariMailF2.mjs'), vechi)
      const mod = await import(pathToFileURL(join(dir, 'redariMailF2.mjs')).href + `?v=${Date.now()}`)
      expect(mod.linkStrain).toBeUndefined()
      for (const id of ['n01_pct54_rest_literal', 'n02_token_tot_codificat_in_cale', 'n03_dublu_codificat', 'n13_cale_codificata', 'n12_cale_singura']) {
        expect(mod.areLinkLiteral(caz(id).text)).toBe(false)   // runda 2: trecea
        expect(areLinkLiteral(caz(id).text)).toBe(true)        // acum: refuzat
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
