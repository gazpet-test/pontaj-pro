// Unități protejate (20261229a): textul mailului, logica edge-ului cu BD / Resend SIMULATE, logica ecranului.
// Valorile așteptate sunt scrise de mână (nu din codul testat). Comportamentul real al BD-ului (pragul, o alertă pe zi, închiderea idempotentă)
// e probat pe migrarea reală în scripts/pglite/test_upa_alerta_local.mjs; aici BD-ul simulat întoarce ce ar întoarce rezervarea în fiecare caz.
import { describe, it, expect } from 'vitest'
import { lei, lunaText, zileText, mailUpa, cheieIdempotenta, ruleazaAlertaUpa } from '../supabase/functions/_shared/upaAlerta.mjs'
import { validaPlafon, avertismenteAchizitie, starePlafonLuna, lunaDinZi, luniInapoi, ziRO,
         stareSalvare, citireDupaSalvare, conflictCheie, pdfExistaDeja, caleaPdf, ordineFurnizori } from './upaLogica.js'

const ZILNIC = { id: 7, cheie: 'zilnic:2031-01-25', fel: 'zilnic', luna: '2031-01-01', plafon: 7000, consumat: 1500, ramas: 5500, zile_ramase: 7, stare: 'rezervat', destinatari: ['ana@gazpet.ro', 'ion@gazpet.ro'] }
const INCHIDERE = { id: 8, cheie: 'inchidere:2030-12', fel: 'inchidere', luna: '2030-12-01', plafon: 6000, consumat: 2000, ramas: 4000, zile_ramase: null, stare: 'rezervat', destinatari: ['ana@gazpet.ro'] }
const rez = (randuri, extra = {}) => ({ activ: true, zi: '2031-01-25', inchis: null, reconciliate: 0, furnizori_upa: ['UPA Unu SRL'], erori_config: [], n: randuri.length, randuri, ...extra })

// BD simulat: întoarce rezervările date, pe rând (o rulare = un apel), și înregistrează marcările
function bdSimulat(rezervari, { marcare = 1, eroareRezervare = null } = {}) {
  const apeluri = [], marcari = []
  return {
    apeluri, marcari,
    rpc: async (nume, args) => {
      apeluri.push(nume)
      if (nume === 'fn_upa_alerta_rezerva') return eroareRezervare ? { data: null, error: eroareRezervare } : { data: rezervari.shift() ?? rez([]), error: null }
      if (nume === 'fn_upa_alerta_marcheaza') { marcari.push(args); return { data: marcare, error: null } }
      if (nume === 'fn_upa_alerta_proba') return { data: { zi: '2031-01-25', in_alerta: true, destinatari: ['ana@gazpet.ro'] }, error: null }
      return { data: null, error: { code: 'PGRST202' } }
    },
  }
}
function resendSimulat(raspunsuri = []) {
  const trimise = []
  const fetchFn = async (url, o) => {
    trimise.push({ url, headers: o.headers, body: JSON.parse(o.body) })
    const x = raspunsuri.length ? raspunsuri.shift() : { status: 200, id: 're_' + trimise.length }
    if (x.arunca) throw new TypeError('fetch failed')
    return { ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => (x.id ? { id: x.id } : {}) }
  }
  return { fetchFn, trimise }
}

describe('textele (aceleași forme ca în BD: fn_upa_lei / fn_upa_luna_text / fn_upa_zile_text)', () => {
  it('lei, luna, zile', () => {
    expect(lei(7000)).toBe('7.000,00')
    expect(lei(1234567.5)).toBe('1.234.567,50')
    expect(lei(0)).toBe('0,00')
    expect(lunaText('2026-11-01')).toBe('noiembrie 2026')
    expect(lunaText('2031-01-25')).toBe('ianuarie 2031')
    expect(lunaText('nu')).toBe('—')
    expect(zileText(1)).toBe('mai este 1 zi')
    expect(zileText(7)).toBe('mai sunt 7 zile')
    expect(zileText(19)).toBe('mai sunt 19 zile')
    expect(zileText(20)).toBe('mai sunt 20 de zile')
    expect(zileText(31)).toBe('mai sunt 31 de zile')
  })
})

describe('mailul', () => {
  it('alerta zilei: subiectul din decizie, sumele, furnizorii, linkul', () => {
    const { subiect, html } = mailUpa(ZILNIC, { furnizori: ['UPA <Unu> SRL'] })
    expect(subiect).toBe('Fond handicap ianuarie 2031: cheltuit 1.500,00 din 7.000,00 lei, rămân 5.500,00 lei, mai sunt 7 zile')
    expect(html).toContain('5.500,00 lei')
    expect(html).toContain('UPA &lt;Unu&gt; SRL')
    expect(html).not.toContain('<Unu>')
    expect(html).toContain('https://pontaj-pro-sooty.vercel.app/administrativ?tab=upa')
    expect(html).toContain('bugetul de stat')
  })
  it('închiderea lunii: necheltuit, de plătit la stat', () => {
    const { subiect, html } = mailUpa(INCHIDERE)
    expect(subiect).toBe('Fond handicap decembrie 2030: necheltuit 4.000,00 lei - se plătește la bugetul de stat')
    expect(html).toContain('6.000,00 lei')
    expect(html).toContain('2.000,00 lei')
  })
  it('fără mențiuni de unelte automate și fără date personale (doar sume / furnizori)', () => {
    for (const r of [ZILNIC, INCHIDERE]) {
      const { subiect, html } = mailUpa(r, { furnizori: ['UPA Unu SRL'] })
      for (const t of [subiect, html]) {
        expect(t).not.toMatch(/\bAI\b|Claude|Rocky|generat automat|paw-data/i)
        expect(t).not.toMatch(/@/)
      }
    }
  })
  it('ultima zi: „mai este 1 zi”', () => {
    expect(mailUpa({ ...ZILNIC, zile_ramase: 1 }).subiect).toMatch(/, mai este 1 zi$/)
  })
  it('cheia de idempotență: aceeași cheie = același antet, alta = altul', async () => {
    const a = await cheieIdempotenta('zilnic:2031-01-25'), b = await cheieIdempotenta('zilnic:2031-01-25'), c = await cheieIdempotenta('zilnic:2031-01-26')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^upa-[0-9a-f]{48}$/)
  })
})

describe('edge-ul (ruleazaAlertaUpa) cu BD și Resend simulate', () => {
  it('zi < prag: BD-ul nu rezervă nimic -> niciun mail', async () => {
    const sb = bdSimulat([rez([])]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, rezervate: 0, trimis: 0 })
    expect(rs.trimise).toHaveLength(0)
  })
  it('zi >= prag și sub plafon -> 1 mail, marcat trimis cu id-ul Resend', async () => {
    const sb = bdSimulat([rez([ZILNIC])]), rs = resendSimulat([{ status: 200, id: 're_abc' }])
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(rs.trimise).toHaveLength(1)
    const m = rs.trimise[0]
    expect(m.url).toBe('https://api.resend.com/emails')
    expect(m.body.to).toEqual(['ana@gazpet.ro', 'ion@gazpet.ro'])
    expect(m.body.from).toBe('PontajPRO <rapoarte@gazpet.ro>')
    expect(m.body.subject).toBe('Fond handicap ianuarie 2031: cheltuit 1.500,00 din 7.000,00 lei, rămân 5.500,00 lei, mai sunt 7 zile')
    expect(m.headers['Idempotency-Key']).toBe(await cheieIdempotenta('zilnic:2031-01-25'))
    expect(m.headers.Authorization).toBe('Bearer k')
    expect(sb.marcari).toEqual([{ p_id: 7, p_stare: 'trimis', p_resend_id: 're_abc', p_eroare: null }])
    expect(r.body).toMatchObject({ ok: true, rezervate: 1, trimis: 1, nemarcat: 0 })
    expect(JSON.stringify(r.body)).not.toMatch(/@/)
  })
  it('a doua rulare în aceeași zi: BD-ul nu mai rezervă -> niciun mail', async () => {
    const sb = bdSimulat([rez([ZILNIC]), rez([])]), rs = resendSimulat()
    await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    const r2 = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(rs.trimise).toHaveLength(1)
    expect(r2.body).toMatchObject({ ok: true, rezervate: 0 })
  })
  it('1 ale lunii: închiderea -> mailul „necheltuit … se plătește la bugetul de stat”', async () => {
    const sb = bdSimulat([rez([INCHIDERE], { zi: '2031-01-01', inchis: { luna: '2030-12-01', plafon: 6000, consumat: 2000, ramas: 4000 } })]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(rs.trimise.map(t => t.body.subject)).toEqual(['Fond handicap decembrie 2030: necheltuit 4.000,00 lei - se plătește la bugetul de stat'])
    expect(r.body).toMatchObject({ ok: true, luna_inchisa: '2030-12-01', trimis: 1 })
  })
  it('5xx și rețea = necunoscut (fără retrimitere), 4xx = eroare', async () => {
    for (const [raspuns, stare, cod] of [[{ status: 503 }, 'necunoscut', 'resend_5xx'], [{ arunca: true }, 'necunoscut', 'retea_sau_timeout'],
      [{ status: 422 }, 'eroare', 'resend_4xx'], [{ status: 429 }, 'eroare', 'resend_429']]) {
      const sb = bdSimulat([rez([ZILNIC])]), rs = resendSimulat([raspuns])
      const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
      expect(rs.trimise).toHaveLength(1)
      expect(sb.marcari).toEqual([{ p_id: 7, p_stare: stare, p_resend_id: null, p_eroare: cod }])
      expect(r.body[stare]).toBe(1)
    }
  })
  it('fără cheia Resend: nimic rezervat (BD-ul nici nu e chemat)', async () => {
    const sb = bdSimulat([rez([ZILNIC])]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: '' })
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'resend_neconfigurat' } })
    expect(sb.apeluri).toEqual([])
  })
  it('rezervarea eșuată / incompletă = 500, niciun mail (L18)', async () => {
    const rs = resendSimulat()
    expect((await ruleazaAlertaUpa({ sb: bdSimulat([], { eroareRezervare: { code: '42501' } }), fetchFn: rs.fetchFn, resendKey: 'k' })).body.error).toBe('rezervare_indisponibila')
    expect((await ruleazaAlertaUpa({ sb: bdSimulat([{ ...rez([ZILNIC]), n: 2 }]), fetchFn: rs.fetchFn, resendKey: 'k' })).body.error).toBe('rezervare_incompleta')
    expect((await ruleazaAlertaUpa({ sb: bdSimulat([{ activ: true, n: 0 }]), fetchFn: rs.fetchFn, resendKey: 'k' })).body.error).toBe('rezervare_incompleta')
    // contractul runda 2: erori_config lipsă / nu e listă / coduri ciudate = rezervare incompletă (nu „ziua fără alertă”)
    for (const ec of [undefined, null, 'fara_plafon', [1], ['Fara Plafon'], ['x'.repeat(41)]]) {
      const raspuns = await ruleazaAlertaUpa({ sb: bdSimulat([rez([], { erori_config: ec })]), fetchFn: rs.fetchFn, resendKey: 'k' })
      expect(raspuns).toEqual({ status: 500, body: { ok: false, error: 'rezervare_incompleta' } })
    }
    expect(rs.trimise).toHaveLength(0)
  })
  it('configurarea defectă: ok:false + configurare_invalida + codurile, la fiecare rulare (L18)', async () => {
    const sb = bdSimulat([rez([], { erori_config: ['setare_zi_invalida'] }), rez([], { erori_config: ['setare_zi_invalida'] }),
      rez([INCHIDERE], { erori_config: ['setare_zi_invalida', 'fara_plafon'] })]), rs = resendSimulat()
    const r1 = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    const r2 = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    for (const r of [r1, r2]) {
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ ok: false, error: 'configurare_invalida', erori_config: ['setare_zi_invalida'], rezervate: 0 })
    }
    // închiderea lunii trecute pleacă și când configurarea lunii curente e defectă; răspunsul spune ambele lucruri
    const r3 = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(rs.trimise).toHaveLength(1)
    expect(r3.body).toMatchObject({ ok: false, error: 'configurare_invalida', erori_config: ['setare_zi_invalida', 'fara_plafon'], trimis: 1 })
  })
  it('configurarea în regulă: ok:true, erori_config [] , fără error', async () => {
    const r = await ruleazaAlertaUpa({ sb: bdSimulat([rez([])]), fetchFn: resendSimulat().fetchFn, resendKey: 'k' })
    expect(r.body.ok).toBe(true)
    expect(r.body.erori_config).toEqual([])
    expect(r.body).not.toHaveProperty('error')
  })
  it('alerta oprită: skip, niciun mail', async () => {
    const sb = bdSimulat([{ activ: false, zi: '2031-01-25', inchis: null, erori_config: [], n: 0, randuri: [] }]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(r.body).toMatchObject({ ok: true, skip: 'alerta_oprita' })
    expect(rs.trimise).toHaveLength(0)
  })
  it('rânduri fără mail (destinatari invalizi în BD) nu pleacă; destinatari stricați în rezervare = eroare marcată, nimic trimis', async () => {
    const faraMail = { ...ZILNIC, stare: 'fara_mail', eroare: 'destinatari_invalizi', destinatari: [] }
    const stricat = { ...ZILNIC, id: 9, destinatari: ['cineva@yahoo.com'] }
    const sb = bdSimulat([rez([faraMail, stricat])]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(rs.trimise).toHaveLength(0)
    expect(sb.marcari).toEqual([{ p_id: 9, p_stare: 'eroare', p_resend_id: null, p_eroare: 'rezervare_invalida' }])
    expect(r.body).toMatchObject({ fara_mail: 1, eroare: 1 })
  })
  it('marcarea neconfirmată (0 rânduri) = ok:false + 500', async () => {
    const sb = bdSimulat([rez([ZILNIC])], { marcare: 0 }), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(r.status).toBe(500)
    expect(r.body).toMatchObject({ ok: false, nemarcat: 1 })
  })
  it('proba (dry): doar fn_upa_alerta_proba, niciun mail', async () => {
    const sb = bdSimulat([]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k', dry: true })
    expect(sb.apeluri).toEqual(['fn_upa_alerta_proba'])
    expect(r.body).toMatchObject({ ok: true, dry: true, in_alerta: true })
    expect(rs.trimise).toHaveLength(0)
  })
})

describe('ecranul (upaLogica)', () => {
  it('zile / luni', () => {
    expect(lunaDinZi('2026-11-19')).toBe('2026-11-01')
    expect(lunaDinZi('2026-13-01')).toBe(null)
    expect(luniInapoi('2026-11-19', 11)).toBe('2025-12-01')
    expect(luniInapoi('2026-01-05', 1)).toBe('2025-12-01')
    expect(luniInapoi('2026-03-31', 0)).toBe('2026-03-01')
    // 23:30 UTC pe 30.11 = 01:30 pe 01.12 în România
    expect(ziRO(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01')
  })
  it('plafonul scris în ecran', () => {
    expect(validaPlafon('7000')).toEqual({ valoare: 7000 })
    expect(validaPlafon(' 7500.5 ')).toEqual({ valoare: 7500.5 })
    for (const t of ['0', '7000.555', '-5', 'abc', '', '7.000,00', '1e5', '12345678']) expect(validaPlafon(t).eroare).toBeTruthy()
  })
  it('avertismentele la adăugare: fără PDF, factură din altă lună (nu blocări)', () => {
    expect(avertismenteAchizitie({ dataFactura: '2026-11-03', luna: '2026-11-01', arePdf: true })).toEqual([])
    expect(avertismenteAchizitie({ dataFactura: '2026-11-03', luna: '2026-11-01', arePdf: false }).map(a => a.cod)).toEqual(['fara_pdf'])
    const a = avertismenteAchizitie({ dataFactura: '2026-10-28', luna: '2026-11-01', arePdf: true })
    expect(a.map(x => x.cod)).toEqual(['luna_diferita'])
    expect(a[0].text).toBe('Factura e din octombrie 2026, dar se scade din noiembrie 2026.')
  })
  it('istoricul: plafonul lunii, necheltuitul de la închidere, diferențele de după', () => {
    expect(starePlafonLuna({ e_curenta: true, plafon: 7000, consumat: 1500, in_alerta: true })).toEqual({ text: 'în curs · rămân 5.500,00 lei', ton: 'rosu' })
    expect(starePlafonLuna({ e_curenta: true, plafon: null, consumat: 0 }).ton).toBe('galben')
    expect(starePlafonLuna({ inchisa: true, plafon: 6000, consumat: 2000, plafon_inchis: 6000, consumat_inchis: 2000, ramas_necheltuit: 4000 }))
      .toEqual({ text: 'necheltuit 4.000,00 lei (de plătit la bugetul de stat, plafon 6.000,00)', ton: 'rosu' })
    expect(starePlafonLuna({ inchisa: true, plafon: 7000, consumat: 7100, plafon_inchis: 7000, consumat_inchis: 7000, ramas_necheltuit: 0 }))
      .toEqual({ text: 'plafon consumat ✓ · după închidere +100,00 lei', ton: 'verde' })
    expect(starePlafonLuna({ inchisa: false, plafon: null, consumat: 300 }).text).toBe('plafon neînregistrat pentru luna asta')
    expect(starePlafonLuna({ inchisa: false, plafon: 7000, consumat: 3000 })).toEqual({ text: 'neînchisă · estimat necheltuit 4.000,00 lei', ton: 'galben' })
  })
})

// runda 2 (L04 / L05): răspunsurile ca de la postgrest-js (status HTTP păstrat; o excepție de rețea = fără status)
describe('salvarea din formular: cheia de intenție, PDF-ul doar după refuz sigur', () => {
  const P = { furnizor_id: 1, numar_factura: 'F-9', luna: '2026-11-01', valoare: 120.5, document_path: 'manual/2026-11/k-1.pdf' }
  const RAND = { id: 44, furnizor_id: 1, numar_factura: 'F-9', luna: '2026-11-01', valoare: '120.50', document_path: 'manual/2026-11/k-1.pdf' }
  const CHEIE = { error: { code: '23505', message: 'duplicate key value violates unique constraint "upa_achizitii_cheie_intentie_uidx"' }, status: 409 }
  it('rândul întors = salvat (fără citire)', () => {
    const res = { data: [{ id: 44 }], error: null, status: 201 }
    expect(citireDupaSalvare(res)).toBe(false)
    expect(stareSalvare(res, null, P)).toBe('salvat')
  })
  it('refuz sigur 4xx (drept, constrângere, cerere invalidă) = refuzat: PDF-ul se poate scoate', () => {
    for (const res of [{ error: { code: '42501', message: 'new row violates row-level security' }, status: 403 },
      { error: { code: '23514', message: 'check' }, status: 400 }, { error: { code: 'PGRST204', message: 'col' }, status: 400 },
      { error: { code: '23505', message: 'duplicate key value violates unique constraint "alt_index"' }, status: 409 }]) {
      expect(citireDupaSalvare(res)).toBe(false)
      expect(stareSalvare(res, null, P)).toBe('refuzat')
    }
  })
  it('un cod de eroare NU ajunge: 5xx / rețea / fără status = necunoscut (nimic șters), chiar cu cod', () => {
    for (const res of [{ error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 },
      { error: { code: 'X', message: 'Bad gateway' }, status: 502 }, { error: { message: 'Failed to fetch' }, status: 0 },
      { error: new TypeError('fetch failed') }, { error: { code: '42501' } }, undefined, { data: [], error: null, status: 201 }]) {
      expect(citireDupaSalvare(res)).toBe(true)
      expect(stareSalvare(res, null, P)).toBe('necunoscut')
      expect(stareSalvare(res, { data: null, error: null }, P)).toBe('necunoscut')        // rândul nu se vede: nedovedit
      expect(stareSalvare(res, { data: null, error: { message: 'x' } }, P)).toBe('necunoscut')
      expect(stareSalvare(res, { data: RAND, error: null }, P)).toBe('salvat')          // rândul cu cheia noastră se vede: intrase
    }
  })
  it('conflictul pe CHEIA noastră = reîncercare după o salvare intrată: se citește rândul, nu e refuz', () => {
    expect(conflictCheie(CHEIE)).toBe(true)
    expect(conflictCheie({ error: { code: '23505', message: 'duplicate key ... "alt_index"' }, status: 409 })).toBe(false)
    expect(citireDupaSalvare(CHEIE)).toBe(true)
    expect(stareSalvare(CHEIE, { data: RAND, error: null }, P)).toBe('salvat')
    expect(stareSalvare(CHEIE, { data: null, error: null }, P)).toBe('necunoscut')
    // aceeași cheie cu alte valori = nu e „salvat”
    expect(stareSalvare(CHEIE, { data: { ...RAND, valoare: '99' }, error: null }, P)).toBe('diferit')
    expect(stareSalvare(CHEIE, { data: { ...RAND, numar_factura: 'F-10' }, error: null }, P)).toBe('diferit')
    expect(stareSalvare(CHEIE, { data: { ...RAND, document_path: null }, error: null }, P)).toBe('diferit')
  })
  it('PDF-ul: „există deja” la calea intenției, calea cu cheia și versiunea fișierului', () => {
    expect(pdfExistaDeja({ statusCode: '409', message: 'The resource already exists' })).toBe(true)
    expect(pdfExistaDeja({ status: 409, message: 'x' })).toBe(true)
    expect(pdfExistaDeja({ statusCode: '400', message: 'Duplicate' })).toBe(true)
    expect(pdfExistaDeja({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe(false)
    expect(pdfExistaDeja(null)).toBe(false)
    expect(caleaPdf('2026-11-01', 'abc', 2)).toBe('manual/2026-11/abc-2.pdf')
  })
  it('furnizorii: ordonați după nume (alfabet românesc), id la egalitate', () => {
    const l = [{ id: 3, nume: 'Ţesătoria' }, { id: 1, nume: 'Beta' }, { id: 2, nume: 'Alfa' }, { id: 9, nume: 'Alfa' }, { id: 5, nume: 'Șase' }]
    expect([...l].sort(ordineFurnizori).map(x => x.id)).toEqual([2, 9, 1, 5, 3])
  })
})
