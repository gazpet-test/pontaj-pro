// Unități protejate (20261229a): textul mailului, logica edge-ului cu BD / Resend SIMULATE, logica ecranului.
// Valorile așteptate sunt scrise de mână (nu din codul testat). Comportamentul real al BD-ului (pragul, o alertă pe zi, închiderea idempotentă)
// e probat pe migrarea reală în scripts/pglite/test_upa_alerta_local.mjs; aici BD-ul simulat întoarce ce ar întoarce rezervarea în fiecare caz.
import { describe, it, expect } from 'vitest'
import { lei, lunaText, zileText, mailUpa, cheieIdempotenta, ruleazaAlertaUpa, ADRESA_INTERNA, DOMENIU_INTERN, destinatariValizi, areCalcul, ziText } from '../supabase/functions/_shared/upaAlerta.mjs'
import { validaSuma, validaFaraTva, stareCalculLuna, etichetaStare, textCod, leiSauLipsa, validaParametru, valoareVazuta, mesajParametru,
         avertismenteAchizitie, lunaDinZi, luniInapoi, ziRO,
         stareSalvare, rezultatNesigur, poateScoatePdf, mesajRefuzAchizitie, CAMPURI_INTENTIE, numarFacturaUpa, refuzNumarFactura, mesajInsertUpa,
         pdfExistaDeja, caleaPdf, ordineFurnizori, paginaCuGarda, validaPlata, textPlata, validaPerioada, mesajPerioada, mesajInchidere } from './upaLogica.js'
import { paginareKeyset } from './hrDeciziiUtil.js'

const ZILNIC = { id: 7, cheie: 'zilnic:2031-01-25', fel: 'zilnic', luna: '2031-01-01', plafon: 7000, consumat: 1500, ramas: 5500, zile_ramase: 7, stare: 'rezervat', destinatari: ['ana@gazpet.ro', 'ion@gazpet.ro'] }
const INCHIDERE = { id: 8, cheie: 'inchidere:2030-12', fel: 'inchidere', luna: '2030-12-01', plafon: 6000, consumat: 2000, ramas: 4000, zile_ramase: null, stare: 'rezervat', destinatari: ['ana@gazpet.ro'] }
const rez = (randuri, extra = {}) => ({ activ: true, zi: '2031-01-25', inchis: null, reconciliate: 0, furnizori_upa: ['UPA Unu SRL'], erori_config: [],
  destinatari_ignorati: 0, n: randuri.length, randuri, ...extra })

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
  it('runda 3: destinatari_ignorati lipsă / negativ / nenumăr = rezervare incompletă; altfel numărul ajunge în răspuns (fără adrese)', async () => {
    const rs = resendSimulat()
    for (const di of [undefined, null, -1, 1.5, '2']) {
      const raspuns = await ruleazaAlertaUpa({ sb: bdSimulat([rez([], { destinatari_ignorati: di })]), fetchFn: rs.fetchFn, resendKey: 'k' })
      expect(raspuns).toEqual({ status: 500, body: { ok: false, error: 'rezervare_incompleta' } })
    }
    const r = await ruleazaAlertaUpa({ sb: bdSimulat([rez([ZILNIC], { destinatari_ignorati: 2 })]), fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(r.body).toMatchObject({ ok: true, trimis: 1, destinatari_ignorati: 2 })
    expect(rs.trimise[0].body.to).toEqual(['ana@gazpet.ro', 'ion@gazpet.ro'])
    expect(JSON.stringify(r.body)).not.toMatch(/@/)
  })
  it('runda 3: domeniul intern (o singură constantă) — doar adrese @gazpet.ro, ancorat (nici subdomenii, nici sufixe)', () => {
    expect(DOMENIU_INTERN).toBe('gazpet.ro')
    for (const a of ['ana@gazpet.ro', 'a.b-c_d+e%f@gazpet.ro']) expect(ADRESA_INTERNA.test(a)).toBe(true)
    for (const a of ['ana@gazpet.ro.ro', 'ana@sub.gazpet.ro', 'ana@gazpetxro', 'ana@yahoo.com', 'Ana@gazpet.ro', ' ana@gazpet.ro', 'ana@gazpet.ro\n', '@gazpet.ro'])
      expect(ADRESA_INTERNA.test(a)).toBe(false)
    expect(destinatariValizi(['ana@gazpet.ro'])).toBe(true)
    expect(destinatariValizi(['ana@gazpet.ro', 'x@yahoo.com'])).toBe(false)   // una din afară = rândul nu pleacă deloc
    expect(destinatariValizi([])).toBe(false)
    expect(destinatariValizi(Array.from({ length: 11 }, (_, i) => `a${i}@gazpet.ro`))).toBe(false)
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
    const sb = bdSimulat([{ activ: false, zi: '2031-01-25', inchis: null, erori_config: [], destinatari_ignorati: 0, n: 0, randuri: [] }]), rs = resendSimulat()
    const r = await ruleazaAlertaUpa({ sb, fetchFn: rs.fetchFn, resendKey: 'k' })
    expect(r.body).toMatchObject({ ok: true, skip: 'alerta_oprita' })
    expect(rs.trimise).toHaveLength(0)
  })
  it('rânduri fără mail (doar adrese externe în setări) nu pleacă; o adresă externă în rezervare = eroare marcată, nimic trimis NIMĂNUI', async () => {
    const faraMail = { ...ZILNIC, stare: 'fara_mail', eroare: 'doar_destinatari_externi', destinatari: [] }
    const stricat = { ...ZILNIC, id: 9, destinatari: ['ana@gazpet.ro', 'cineva@yahoo.com'] }
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
  it('sumele scrise în ecran; valoarea fără TVA (obligatorie, cel mult cea cu TVA)', () => {
    expect(validaSuma('7000')).toEqual({ valoare: 7000 })
    expect(validaSuma(' 7500.5 ')).toEqual({ valoare: 7500.5 })
    for (const t of ['0', '7000.555', '-5', 'abc', '', '7.000,00', '1e5', '12345678']) expect(validaSuma(t).eroare).toBeTruthy()
    expect(validaSuma('0', { zero: true })).toEqual({ valoare: 0 })
    expect(validaFaraTva('100', 119)).toEqual({ valoare: 100 })
    expect(validaFaraTva('119', 119)).toEqual({ valoare: 119 })
    expect(validaFaraTva('119.01', 119).eroare).toMatch(/nu poate fi mai mare/)
    expect(validaFaraTva('', 119).eroare).toMatch(/Valoarea fără TVA/)
    expect(validaFaraTva('0', 119).eroare).toBeTruthy()
  })
  it('avertismentele la adăugare: fără PDF, factură din altă lună (nu blocări)', () => {
    expect(avertismenteAchizitie({ dataFactura: '2026-11-03', luna: '2026-11-01', arePdf: true })).toEqual([])
    expect(avertismenteAchizitie({ dataFactura: '2026-11-03', luna: '2026-11-01', arePdf: false }).map(a => a.cod)).toEqual(['fara_pdf'])
    const a = avertismenteAchizitie({ dataFactura: '2026-10-28', luna: '2026-11-01', arePdf: true })
    expect(a.map(x => x.cod)).toEqual(['luna_diferita'])
    expect(a[0].text).toBe('Factura e din octombrie 2026, dar se scade din noiembrie 2026.')
  })
  it('istoricul (20270101a): previziune / de completat / gata de închis / închis, din rândul calculat de BD', () => {
    // cazul expertului „peste jumătate”: D 4.325, achiziții 3.000 -> de plată 2.162,50, report 837,50
    const prev = { stare: 'previziune', pontaj_inchis: false, poate_inchide: false, de_plata: 2162.5, report_iesit: 837.5, blocaje: [] }
    expect(stareCalculLuna(prev)).toEqual({ text: 'previziune · de plată estimat 2.162,50 lei · report estimat 837,50 lei', ton: 'galben' })
    expect(etichetaStare(prev)).toBe('PREVIZIUNE')
    expect(stareCalculLuna({ ...prev, pontaj_inchis: true, poate_inchide: true })).toEqual({ text: 'gata de închis · de plată 2.162,50 lei · report 837,50 lei', ton: 'verde' })
    expect(stareCalculLuna({ ...prev, pontaj_inchis: true, blocaje: ['achizitii_fara_tva:2'] }).text).toMatch(/^de completat înainte de închidere/)
    expect(etichetaStare({ ...prev, pontaj_inchis: true })).toBe('DE ÎNCHIS')
    // cazul „sub jumătate”: de plată 3.325, nimic reportat
    expect(stareCalculLuna({ stare: 'definitiv', de_plata: 3325, report_iesit: 0, termen_stat: '2026-11-25' }))
      .toEqual({ text: 'închis · de plată la stat 3.325,00 lei până pe 25.11.2026', ton: 'rosu' })
    expect(stareCalculLuna({ stare: 'definitiv', de_plata: 0, report_iesit: 100, termen_stat: '2026-11-25' }))
      .toEqual({ text: 'închis · de plată la stat 0,00 lei până pe 25.11.2026 · se reportează 100,00 lei', ton: 'verde' })
    expect(etichetaStare({ stare: 'definitiv' })).toBe('EXACT (închis)')
    // necunoscut != 0 (L18): fără salariul minim nu se arată nicio sumă de plată
    expect(stareCalculLuna({ stare: 'previziune', de_plata: null, blocaje: ['fara_salariu_minim', 'fara_nr_handicap'] }))
      .toEqual({ text: 'calcul incomplet: salariul minim al lunii nu e înregistrat (Parametri); numărul angajaților cu handicap nu e înregistrat (Parametri)', ton: 'galben' })
    expect(stareCalculLuna({ stare: 'in_afara_calculului' }).ton).toBe('gri')
    expect(stareCalculLuna(null).text).toBe('—')
    expect(leiSauLipsa(null)).toBe('—')
    expect(leiSauLipsa(0)).toBe('0,00')
  })
  it('codurile calculului -> text pentru oameni (cu număr, singular / plural, cod necunoscut lizibil)', () => {
    expect(textCod('achizitii_fara_tva:1')).toBe('1 factură fără valoarea fără TVA')
    expect(textCod('achizitii_fara_tva:3')).toBe('3 facturi fără valoarea fără TVA')
    expect(textCod('achizitii_fara_data_platii:2')).toBe('2 facturi fără data plății')
    expect(textCod('achizitii_platite_dupa_termen:1')).toBe('1 factură plătită după sfârșitul lunii (nu intră în deducere)')
    expect(textCod('inactivi_fara_data_incetarii_cu_pontaj:2')).toBe('2 angajați inactivi fără data încetării, cu pontaj în lună (se completează data în HR)')
    expect(textCod('pontaj_neinchis')).toMatch(/pontajul lunii nu e încă închis/)
    expect(textCod('cod_nou_necunoscut')).toBe('cod nou necunoscut')
    expect(textCod('<b>x</b>')).toBe('<b>x</b>')
  })
  it('parametrii pe perioade: validarea, valoarea văzută (CAS), mesajele refuzului', () => {
    expect(validaParametru('salariu_minim', '2026-07', '4325')).toEqual({ de_la: '2026-07-01', valoare: 4325 })
    expect(validaParametru('salariu_minim', '2026-07', '0').eroare).toBeTruthy()
    expect(validaParametru('angajati_handicap', '2026-10', '0')).toEqual({ de_la: '2026-10-01', valoare: 0 })
    expect(validaParametru('angajati_handicap', '2026-10', '1.5').eroare).toMatch(/întreg/)
    expect(validaParametru('report_initial', '2026-10', '0')).toEqual({ de_la: '2026-10-01', valoare: 0 })
    expect(validaParametru('alt', '2026-10', '1').eroare).toBeTruthy()
    expect(validaParametru('salariu_minim', '2026-13', '1').eroare).toBeTruthy()
    expect(validaParametru('salariu_minim', '', '1').eroare).toBeTruthy()
    const p = [{ cheie: 'salariu_minim', de_la: '2026-07-01', valoare: '4325.00' }, { cheie: 'report_initial', de_la: '2026-10-01', valoare: '0.00' }]
    expect(valoareVazuta(p, 'salariu_minim', '2026-07-01')).toBe(4325)
    expect(valoareVazuta(p, 'report_initial', '2026-10-01')).toBe(0)
    expect(valoareVazuta(p, 'salariu_minim', '2027-01-01')).toBe(null)
    expect(valoareVazuta(null, 'salariu_minim', '2026-07-01')).toBe(null)
    expect(mesajParametru({ code: '42501' })).toMatch(/Nu ai drept/)
    expect(mesajParametru({ code: '40001' })).toMatch(/schimbat între timp/)
    expect(mesajParametru({ code: 'UPA03' })).toMatch(/lună deja închisă/)
  })
})

describe('mailul pe calculul expertului (20270101a, rândul are `calcul`)', () => {
  // exemplul din review: NMA 75 -> 3 posturi, contribuția integrală 3 x 4.325 = 12.975; 8.000 achiziții -> de plată 6.487,50, report 1.512,50
  const CALC_OCT = { stare: 'definitiv', luna: '2026-10-01', nma: 75, posturi: 3, locuri: 3, salariu_minim: 4325, suma_datorata: 12975, achizitii_fara_tva: 8000,
    report_intrat: 0, deducere: 6487.5, de_plata: 6487.5, report_iesit: 1512.5, termen_stat: '2026-11-25', termen_upa: '2026-10-31', jumatate: 6487.5 }
  // NMA 64 -> 2,56 posturi, contribuția 11.072, deducerea maximă 5.536; report 1.512,50 -> mai sunt 4.023,50 de cumpărat; termenul 21.12
  const CALC_NOV = { stare: 'previziune', luna: '2026-11-01', suma_datorata: 11072, jumatate: 5536, report_intrat: 1512.5, achizitii_fara_tva: 0,
    termen_stat: '2026-12-21', termen_upa: '2026-11-30' }
  const EXACT = { id: 1, cheie: 'calcul:2026-10', fel: 'calcul', luna: '2026-10-01', plafon: 12975, consumat: 8000, ramas: 6487.5, calcul: CALC_OCT }
  const PREV = { id: 2, cheie: 'zilnic:2026-11-25', fel: 'zilnic', luna: '2026-11-01', plafon: 4023.5, consumat: 0, ramas: 4023.5, zile_ramase: 6, calcul: CALC_NOV }
  it('alerta exactă (felul calcul): de plată la stat până la termen, contribuția integrală, posturile cu 2 zecimale, reportul', () => {
    expect(areCalcul(EXACT)).toBe(true)
    const m = mailUpa(EXACT)
    expect(m.subiect).toBe('Fond handicap octombrie 2026: de plată la bugetul de stat 6.487,50 lei până pe 25.11.2026')
    expect(m.html).toContain('12.975,00 lei')
    expect(m.html).toContain('1.512,50 lei')
    expect(m.html).toContain('75,00')
    expect(m.html).toContain('Contribuția integrală')
    expect(m.html).not.toMatch(/necheltuit/)
    expect(mailUpa({ ...EXACT, calcul: { ...CALC_OCT, nma: 64.08, posturi: 2.56, locuri: 2.56 } }).html).toMatch(/64,08[\s\S]*2,56/)
  })
  it('alerta zilei: PREVIZIUNE, rămas de cumpărat, termenele (21.12 pentru noiembrie)', () => {
    const m = mailUpa(PREV, { furnizori: ['UPA <Unu>'] })
    expect(m.subiect).toBe('Fond handicap noiembrie 2026 (previziune): mai sunt 4.023,50 lei de cumpărat de la unități protejate, mai sunt 6 zile')
    expect(m.html).toContain('30.11.2026')
    expect(m.html).toContain('21.12.2026')
    expect(m.html).not.toContain('25.12.2026')
    expect(m.html).toContain('UPA &lt;Unu&gt;')
    expect(m.html).toMatch(/Previziune/)
  })
  it('P2: rândul NOU (are cheia calcul) cu calcul invalid -> niciun mail (null), fără forma veche', () => {
    for (const r of [{ ...EXACT, calcul: null }, { ...EXACT, calcul: { ...CALC_OCT, de_plata: null } }, { ...EXACT, calcul: { ...CALC_OCT, stare: 'previziune' } },
      { ...EXACT, calcul: { ...CALC_OCT, termen_stat: '25.11.2026' } }, { ...EXACT, calcul: { ...CALC_OCT, posturi: 'x' } }, { ...EXACT, calcul: [] },
      { ...PREV, calcul: { ...CALC_NOV, jumatate: null } }, { ...PREV, ramas: null }, { ...PREV, calcul: { ...CALC_NOV, stare: 'definitiv' } },
      { ...EXACT, fel: 'inchidere' }, { ...EXACT, fel: 'eroare' }]) {
      expect(areCalcul(r)).toBe(true)
      expect(mailUpa(r)).toBe(null)
    }
  })
  it('rezervarea veche (fără cheia calcul) -> forma v10 doar pentru felurile vechi; felul calcul fără calcul -> null', () => {
    expect(areCalcul(ZILNIC)).toBe(false)
    expect(mailUpa(ZILNIC).subiect).toMatch(/^Fond handicap ianuarie 2031: cheltuit/)
    expect(mailUpa(INCHIDERE).subiect).toMatch(/necheltuit/)
    const { calcul, ...faraCalcul } = EXACT
    expect(calcul).toBeTruthy()
    expect(mailUpa(faraCalcul)).toBe(null)
    expect(ziText('2026-11-25')).toBe('25.11.2026')
    expect(ziText(null)).toBe('—')
  })
  it('edge-ul: un rând nou cu calcul invalid se marchează eroare calcul_invalid, fără niciun apel la Resend', async () => {
    const bd = bdSimulat([rez([{ ...EXACT, stare: 'rezervat', destinatari: ['ana@gazpet.ro'], calcul: { ...CALC_OCT, de_plata: null } },
      { ...PREV, id: 3, stare: 'rezervat', destinatari: ['ana@gazpet.ro'] }])])
    const trimise = []
    const fetchFn = async (url, o) => { trimise.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: 're_1' }) } }
    const r = await ruleazaAlertaUpa({ sb: bd, fetchFn, resendKey: 'k' })
    expect(trimise.length).toBe(1)
    expect(trimise[0].subject).toMatch(/previziune/)
    expect(bd.marcari).toEqual([{ p_id: 1, p_stare: 'eroare', p_resend_id: null, p_eroare: 'calcul_invalid' }, { p_id: 3, p_stare: 'trimis', p_resend_id: 're_1', p_eroare: null }])
    expect(r.body.eroare).toBe(1)
    expect(r.body.trimis).toBe(1)
  })
})

describe('plata facturii, corecțiile HR și închiderea (20270101a runda 2)', () => {
  it('starea plății: plătită cere data; neplătită / necompletat fără dată (ca CHECK-ul din BD)', () => {
    expect(validaPlata('platita', '2026-10-28')).toEqual({ stare_plata: 'platita', data_plata: '2026-10-28' })
    expect(validaPlata('platita', '').eroare).toMatch(/data plății/)
    expect(validaPlata('neplatita', '2026-10-28')).toEqual({ stare_plata: 'neplatita', data_plata: null })
    expect(validaPlata('', '2026-10-28')).toEqual({ stare_plata: null, data_plata: null })
    expect(validaPlata('altceva', '').eroare).toBeTruthy()
    expect(textPlata({ stare_plata: 'platita', data_plata: '2026-11-03', luna: '2026-10-01' }).text).toMatch(/după sfârșitul lunii: nu se deduce/)
    expect(textPlata({ stare_plata: 'platita', data_plata: '2026-10-28', luna: '2026-10-01' })).toEqual({ text: 'plătită 28.10.2026', ton: 'gri' })
    expect(textPlata({ stare_plata: 'neplatita', luna: '2026-10-01' }).text).toMatch(/^neplătită/)
    expect(textPlata({ stare_plata: null, luna: '2026-10-01' }).text).toMatch(/luna nu se poate închide/)
  })
  it('codurile noi (pontaj lipsă, calendar, plata necompletată, neplătite excluse, corecții)', () => {
    expect(textCod('pontaj_lipsa:1')).toBe('1 zi lucrătoare fără pontaj (angajat × zi): se completează pontajul înainte de închidere')
    expect(textCod('pontaj_lipsa:4')).toMatch(/^4 zile lucrătoare fără pontaj/)
    expect(textCod('calendar_incomplet:2026')).toMatch(/pe 2026 nu e încărcat/)
    expect(textCod('achizitii_fara_stare_plata:2')).toBe('2 facturi cu plata necompletată (plătită / neplătită)')
    expect(textCod('achizitii_neplatite_excluse:1')).toBe('1 factură neplătită în lună (nu intră în deducere)')
    expect(textCod('angajati_cu_corectii:3')).toMatch(/^3 angajați cu corecții HR/)
    expect(textCod('angajati_fara_data_angajarii:1')).toMatch(/se completează în HR/)
  })
  it('corecția HR: validarea (normă în (0, 1], cel puțin o schimbare, motivul) și mesajele refuzului', () => {
    const baza = { employee_id: '72', de_la: '2026-10-01', pana_la: '2026-10-15', norma: '1', administrator: '', suspendat: false, nota: ' act adițional 12 ' }
    expect(validaPerioada(baza)).toEqual({ p_employee_id: 72, p_de_la: '2026-10-01', p_pana_la: '2026-10-15', p_norma: 1, p_administrator: null, p_suspendat: false, p_nota: 'act adițional 12' })
    expect(validaPerioada({ ...baza, norma: '0.5' }).p_norma).toBe(0.5)
    expect(validaPerioada({ ...baza, norma: '', administrator: 'da' }).p_administrator).toBe(true)
    expect(validaPerioada({ ...baza, norma: '', suspendat: true }).p_suspendat).toBe(true)
    for (const gresit of [{ norma: '0' }, { norma: '1.5' }, { norma: '50' }, { norma: '', administrator: '' }, { nota: '  ' }, { pana_la: '2026-09-30' },
      { employee_id: '' }, { de_la: '1.10.2026' }])
      expect(validaPerioada({ ...baza, ...gresit }).eroare).toBeTruthy()
    expect(mesajPerioada({ code: 'UPA05' })).toMatch(/suprapune/)
    expect(mesajPerioada({ code: 'UPA03' })).toMatch(/închisă/)
    expect(mesajPerioada({ code: '42501' })).toMatch(/owner/)
    expect(mesajInchidere({ code: '40001' })).toMatch(/s-au schimbat de la afișare/)
    expect(mesajInchidere({ code: '42501' })).toMatch(/owner/)
  })
})

// runda 3 (L04 / L05): salvarea prin RPC-ul fn_upa_achizitie_adauga; răspunsurile ca de la postgrest-js (status HTTP păstrat;
//   o excepție de rețea = fără status). Comportamentul RPC-ului pe BD-ul real: scripts/pglite/test_upa_alerta_local.mjs.
describe('salvarea din formular: RPC idempotent, PDF-ul doar după refuz sigur fără încercări nesigure', () => {
  const NOU = { data: { stare: 'nou', id: 44 }, error: null, status: 200 }
  const EXISTENT = { data: { stare: 'existent', id: 44 }, error: null, status: 200 }
  const DREPT = { error: { code: '42501', message: 'new row violates row-level security policy for table "upa_achizitii"' }, status: 403 }
  const PIERDUT = { error: { message: 'TypeError: Failed to fetch' }, status: 0 }
  it('nou / existent = salvat; contractul răspunsului verificat (id, stare)', () => {
    expect(stareSalvare(NOU)).toBe('salvat')
    expect(stareSalvare(EXISTENT)).toBe('salvat')
    expect(stareSalvare(EXISTENT, true)).toBe('salvat')
    for (const d of [null, {}, { stare: 'nou' }, { stare: 'nou', id: 0 }, { stare: 'nou', id: 'x' }, { stare: 'alt', id: 4 }, [{ id: 44 }]])
      expect(stareSalvare({ data: d, error: null, status: 200 })).toBe('necunoscut')
  })
  it('refuz sigur 4xx (drept, numărul facturii, cerere invalidă), fără încercări nesigure = refuzat: PDF-ul se poate scoate', () => {
    for (const res of [DREPT, { error: { code: '23514', message: 'upa: numarul facturii e obligatoriu (numar_factura)' }, status: 400 },
      { error: { code: '22023', message: 'upa: camp nepermis' }, status: 400 }, { error: { code: 'PGRST202', message: 'fn' }, status: 404 }]) {
      expect(stareSalvare(res)).toBe('refuzat')
      expect(poateScoatePdf(stareSalvare(res))).toBe(true)
      expect(rezultatNesigur(stareSalvare(res))).toBe(false)
    }
  })
  it('P1 (review r2): după o încercare NESIGURĂ, un refuz al reîncercării nu dovedește nimic — refuzat_nesigur, PDF-ul rămâne', () => {
    // pasul 1: răspunsul s-a pierdut (rândul poate fi intrat) -> necunoscut, intenția devine nesigură
    const st1 = stareSalvare(PIERDUT, false)
    expect(st1).toBe('necunoscut')
    expect(rezultatNesigur(st1)).toBe(true)
    // pasul 2: între timp i s-a retras dreptul; reîncercarea primește 403 -> NU e refuzat
    const st2 = stareSalvare(DREPT, true)
    expect(st2).toBe('refuzat_nesigur')
    expect(poateScoatePdf(st2)).toBe(false)
    expect(rezultatNesigur(st2)).toBe(true)
    // (pe BD-ul real RPC-ul întoarce chiar 'existent' în cazul ăsta: cheia e căutată înaintea dreptului — proba PGlite)
    expect(stareSalvare(EXISTENT, true)).toBe('salvat')
  })
  it('UPA02 = aceeași cheie cu alte valori: diferit (nimic șters), chiar dacă statusul e 4xx', () => {
    const res = { error: { code: 'UPA02', message: 'upa: cheia intentiei exista deja cu alte valori; nimic scris' }, status: 400 }
    expect(stareSalvare(res)).toBe('diferit')
    expect(poateScoatePdf(stareSalvare(res))).toBe(false)
    expect(rezultatNesigur('diferit')).toBe(true)
  })
  it('un cod de eroare NU ajunge: 5xx / rețea / fără status / conflict tranzitoriu = necunoscut (nimic șters)', () => {
    for (const res of [{ error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 },
      { error: { code: 'X', message: 'Bad gateway' }, status: 502 }, PIERDUT, { error: new TypeError('fetch failed') }, { error: { code: '42501' } },
      undefined, { error: { code: '40001', message: 'upa: cheia intentiei in conflict' }, status: 409 }, { error: { code: '55P03' }, status: 409 },
      { error: { code: 'X' }, status: 408 }]) {
      expect(stareSalvare(res)).toBe('necunoscut')
      expect(poateScoatePdf(stareSalvare(res))).toBe(false)
    }
  })
  it('câmpurile intenției = lista din BD (fn_upa_campuri_intentie_v2), mesajele refuzului', () => {
    // 20270101a: + valoare_fara_tva, data_plata, stare_plata (funcție NOUĂ: fn_upa_campuri_intentie din 20261229a rămâne neatinsă)
    expect(CAMPURI_INTENTIE).toEqual(['furnizor_id', 'furnizor_nume', 'numar_factura', 'data_factura', 'luna', 'valoare', 'descriere', 'document_path',
      'valoare_fara_tva', 'data_plata', 'stare_plata'])
    expect(mesajRefuzAchizitie(DREPT.error)).toMatch(/Nu ai drept/)
    expect(mesajRefuzAchizitie({ code: '23514', message: 'upa: numarul facturii e obligatoriu (numar_factura)' })).toBe('Completează numărul facturii (e obligatoriu).')
    expect(mesajRefuzAchizitie({ code: '23514', message: 'new row for relation "upa_achizitii" violates check constraint "alt_check"' })).toMatch(/^Eroare: /)
  })
})

describe('numărul facturii (20261229b) în Citește Orice și refuzul gărzii din BD', () => {
  it('numărul de pe card: editat > citit de AI, fără spații; gol = lipsă', () => {
    expect(numarFacturaUpa(undefined, ' GZ 12 ')).toBe('GZ 12')
    expect(numarFacturaUpa('F-9', 'GZ 12')).toBe('F-9')
    expect(numarFacturaUpa('', 'GZ 12')).toBe('')              // omul l-a șters: lipsă (nu revine la cel citit)
    expect(numarFacturaUpa('   ', undefined)).toBe('')
    expect(numarFacturaUpa(undefined, null)).toBe('')
  })
  it('refuzul 23514 al triggerului / CHECK-ului se recunoaște; alt 23514 / alt cod nu', () => {
    const trig = { code: '23514', message: 'upa: numarul facturii e obligatoriu (numar_factura)', hint: 'Completeaza numarul facturii.' }
    const chk = { code: '23514', message: 'new row for relation "upa_achizitii" violates check constraint "upa_achizitii_numar_factura_nevid"' }
    expect(refuzNumarFactura(trig)).toBe(true)
    expect(refuzNumarFactura(chk)).toBe(true)
    expect(refuzNumarFactura({ code: '23514', message: 'violates check constraint "upa_valoare"' })).toBe(false)
    expect(refuzNumarFactura({ code: '42501', message: 'numar_factura' })).toBe(false)
    expect(refuzNumarFactura(null)).toBe(false)
    expect(mesajInsertUpa(chk)).toMatch(/^Completează numărul facturii/)
    expect(mesajInsertUpa({ code: '23502', message: 'null value' })).toBe('Insert achiziție UPA: null value')
  })
})

describe('L24: paginarea se oprește la invalidarea generației', () => {
  it('pagina următoare NU mai pleacă după ce generația s-a schimbat; eroarea e „oprit”, nu o listă parțială', async () => {
    let gen = 1, cereri = 0
    const curent = ((g) => () => g === gen)(1)
    const cerePagina = async (ultim) => { cereri++; if (cereri === 1) gen = 2; return { data: [{ id: (ultim || 0) + 1 }], error: null } }
    await expect(paginareKeyset(paginaCuGarda(curent, cerePagina), 1)).rejects.toMatchObject({ oprit: true })
    expect(cereri).toBe(1)
  })
  it('generația neschimbată: paginarea merge până la pagina goală', async () => {
    const date = [[{ id: 1 }, { id: 2 }], [{ id: 3 }], []]
    let i = 0
    const r = await paginareKeyset(paginaCuGarda(() => true, async () => ({ data: date[i++], error: null })), 2)
    expect(r.map(x => x.id)).toEqual([1, 2, 3])
  })
})

describe('PDF-ul și furnizorii', () => {
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
