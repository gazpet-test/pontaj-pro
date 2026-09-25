// Bucla butonului „🤖 Extrage din documentație" (📋 Cantități). Bugul se arată din codul vechi (copiat mai jos,
// din 8a6fbbb:src/OfertareCantitati.jsx): la o eroare făcea `break` și afișa imediat toast-ul OK „Extragere
// terminată", care îl înlocuia pe cel de eroare. Răspunsurile de mai jos imită corpul real al funcției (handler.ts);
// licitatie_id 93 (Jilava) e doar o valoare de test — nu reproduce un incident observat.
import { describe, it, expect } from 'vitest'
import { ruleazaExtragere, mesajExtragere, reluareDupa } from './ofertareExtragereCantitati.js'
import { mesajInvoke, statusInvoke } from './lib/mesajInvoke.js'

// FunctionsHttpError din supabase-js: mesaj generic + corpul în context (Response)
const httpErr = (status, body) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
})
// invoke scriptat: întoarce pe rând răspunsurile, ține minte body-urile
const scriptat = (raspunsuri) => {
  const apeluri = []
  const invoke = async (body) => { apeluri.push(body); return raspunsuri[Math.min(apeluri.length - 1, raspunsuri.length - 1)] }
  return { invoke, apeluri }
}
const pas = (o) => ({ data: { ok: true, felii_total: 52, raport: [], ...o }, error: null })

describe('ruleazaExtragere', () => {
  it('403 de la poarta pe cheltuială: eroare cu motivul real, NU „terminată"', async () => {
    const { invoke, apeluri } = scriptat([{ data: null, error: httpErr(403, { error: 'Extragerea F3 costă — o pornește doar ownerul sau responsabilul licitației.' }) }])
    const r = await ruleazaExtragere(invoke, 93)
    expect(r.stare).toBe('eroare')
    expect(r.mesaj).toContain('doar ownerul sau responsabilul')
    expect(r.mesaj).toContain('HTTP 403')
    expect(apeluri).toEqual([{ licitatie_id: 93, de_la: 0 }])
    const m = mesajExtragere(r)
    expect(m.tip).toBe('err')
    expect(m.text).not.toMatch(/terminat/i)
  })

  it('eroare de business în corp 200 (data.error) → eroare, cu rândurile scrise până atunci', async () => {
    const { invoke } = scriptat([pas({ continua: true, urmatorul: 3, scrise: 40 }), { data: { error: 'OPENAI_API_KEY lipsă din secretele funcției' }, error: null }])
    const r = await ruleazaExtragere(invoke, 93)
    expect(r.stare).toBe('eroare')
    expect(r.mesaj).toBe('OPENAI_API_KEY lipsă din secretele funcției')
    expect(mesajExtragere(r).text).toContain('40 rânduri noi scrise înainte de eroare')
  })

  it('reia cu urmatorul până la continua=false și adună rândurile scrise', async () => {
    const { invoke, apeluri } = scriptat([
      pas({ continua: true, urmatorul: 2, scrise: 10 }),
      pas({ continua: true, urmatorul: 5, scrise: 7 }),
      pas({ continua: false, urmatorul: null, scrise: 3 }),
    ])
    const r = await ruleazaExtragere(invoke, 93)
    expect(apeluri.map(a => a.de_la)).toEqual([0, 2, 5])
    expect(r).toMatchObject({ stare: 'ok', scrise: 20, deLa: null })
    expect(mesajExtragere(r)).toEqual({ tip: 'ok', text: 'Extragere terminată: 20 rânduri noi' })
  })

  it('plafonul de apeluri NU mai raportează „terminată": stare neterminat + de unde se reia', async () => {
    const { invoke } = scriptat([pas({ continua: true, urmatorul: 1, scrise: 1 }), pas({ continua: true, urmatorul: 2, scrise: 1 }), pas({ continua: true, urmatorul: 3, scrise: 1 })])
    const r = await ruleazaExtragere(invoke, 93, { maxApeluri: 3 })
    expect(r).toMatchObject({ stare: 'neterminat', deLa: 3, scrise: 3, feliiTotal: 52 })
    const m = mesajExtragere(r)
    expect(m.tip).toBe('warn')
    expect(m.text).toContain('oprită la felia 4 din 52')
  })

  it('reluarea pornește de la deLa primit, nu de la zero (feliile plătite nu se replătesc)', async () => {
    const { invoke, apeluri } = scriptat([pas({ continua: false, scrise: 2 })])
    await ruleazaExtragere(invoke, 93, { deLa: 17 })
    expect(apeluri).toEqual([{ licitatie_id: 93, de_la: 17 }])
  })

  it('felii cu eroare în raport (răspuns neinterpretabil) → partial, cu exemplul primei erori', async () => {
    const { invoke } = scriptat([pas({ continua: false, scrise: 0, raport: [
      { doc: 'Cantitati de lucrari.pdf', bucata: '2/3', eroare: 'raspuns neinterpretabil', out: 16000, stop: 'max_output_tokens' },
      { doc: 'Cantitati de lucrari.pdf', bucata: '3/3', pozitii: 120 },
    ] })])
    const r = await ruleazaExtragere(invoke, 93)
    expect(r.stare).toBe('partial')
    expect(r.erori).toHaveLength(1)
    const m = mesajExtragere(r)
    expect(m.tip).toBe('warn')
    expect(m.text).toContain('1 felii nereușite')
    expect(m.text).toContain('2/3: raspuns neinterpretabil')
  })

  it('onPas primește indexul feliei de la care pornește fiecare apel', async () => {
    const vazute = []
    const { invoke } = scriptat([pas({ continua: true, urmatorul: 4 }), pas({ continua: false })])
    await ruleazaExtragere(invoke, 93, { onPas: i => vazute.push(i) })
    expect(vazute).toEqual([0, 4])
  })
})

// Copia buclei VECHI (înainte de fix), cu showToast înregistrat — ca bugul să fie demonstrat, nu doar descris.
async function buclaVeche(invoke, licId, showToast) {
  let deLa = 0, pas = 0, scrise = 0
  while (pas < 40) {
    pas++
    const { data, error } = await invoke({ licitatie_id: licId, de_la: deLa })
    if (error || data?.error) { showToast('Extragere: ' + (data?.error || error.message), 'err'); break }
    scrise += data?.scrise || 0
    if (!data?.continua) break
    deLa = data?.urmatorul ?? deLa + 1
  }
  showToast(`Extragere terminată: ${scrise} rânduri noi`, 'ok')
}

describe('bucla veche vs nouă (același 403)', () => {
  const raspuns403 = () => [{ data: null, error: httpErr(403, { error: 'Extragerea F3 costă — o pornește doar ownerul sau responsabilul licitației.' }) }]
  it('VECHE: eroarea generică e urmată imediat de „terminată" OK — ultimul toast vizibil e un fals succes', async () => {
    const toasturi = []
    await buclaVeche(scriptat(raspuns403()).invoke, 93, (t, tip) => toasturi.push([tip, t]))
    expect(toasturi).toEqual([
      ['err', 'Extragere: Edge Function returned a non-2xx status code'],
      ['ok', 'Extragere terminată: 0 rânduri noi'],
    ])
  })
  it('NOUĂ: un singur mesaj, de eroare, cu motivul real', async () => {
    const m = mesajExtragere(await ruleazaExtragere(scriptat(raspuns403()).invoke, 93))
    expect(m.tip).toBe('err')
    expect(m.text).toContain('doar ownerul sau responsabilul')
    expect(m.text).not.toMatch(/terminat/i)
  })
})

describe('reluareDupa (de unde continuă următorul clic)', () => {
  it('eroare trecătoare la mijloc (504 după felii scrise) → reia de la felia apelului eșuat', async () => {
    const { invoke, apeluri } = scriptat([
      pas({ continua: true, urmatorul: 4, scrise: 30 }),
      { data: null, error: httpErr(504, { message: 'gateway timeout' }) },
    ])
    const r = await ruleazaExtragere(invoke, 93)
    expect(apeluri.map(a => a.de_la)).toEqual([0, 4])
    expect(r).toMatchObject({ stare: 'eroare', status: 504, deLa: 4, scrise: 30 })
    expect(reluareDupa(r, 93)).toEqual({ licId: 93, deLa: 4 })
    expect(mesajExtragere(r).text).toContain('continui de la felia 5')
    // următorul clic pornește de la 4, nu de la 0
    const urm = scriptat([pas({ continua: false, scrise: 5 })])
    await ruleazaExtragere(urm.invoke, 93, { deLa: reluareDupa(r, 93).deLa })
    expect(urm.apeluri).toEqual([{ licitatie_id: 93, de_la: 4 }])
  })
  it('eroare de business în corp 200 la mijloc (status null) → reluare permisă', async () => {
    const { invoke } = scriptat([pas({ continua: true, urmatorul: 2, scrise: 3 }), { data: { error: 'citire documente: timeout' }, error: null }])
    const r = await ruleazaExtragere(invoke, 93)
    expect(r.status).toBe(null)
    expect(reluareDupa(r, 93)).toEqual({ licId: 93, deLa: 2 })
  })
  it('401/403 la mijloc → FĂRĂ reluare (nu e trecătoare)', async () => {
    for (const st of [401, 403]) {
      const { invoke } = scriptat([pas({ continua: true, urmatorul: 3, scrise: 1 }), { data: null, error: httpErr(st, { error: 'fără drept' }) }])
      const r = await ruleazaExtragere(invoke, 93)
      expect(r).toMatchObject({ stare: 'eroare', status: st, deLa: 3 })
      expect(reluareDupa(r, 93)).toBe(null)
      expect(mesajExtragere(r).text).not.toContain('continui')
    }
  })
  it('401/403 pe o rulare care era deja reluare → păstrează punctul anterior, fără „apasă din nou"', async () => {
    for (const st of [401, 403]) {
      const anterioara = { licId: 93, deLa: 17 }
      // refuzat chiar la primul apel al reluării (ex. sesiune expirată cât pagina a stat deschisă)
      const { invoke, apeluri } = scriptat([{ data: null, error: httpErr(st, { error: 'token invalid' }) }])
      const r = await ruleazaExtragere(invoke, 93, { deLa: anterioara.deLa })
      expect(apeluri).toEqual([{ licitatie_id: 93, de_la: 17 }])
      expect(r).toMatchObject({ stare: 'eroare', status: st, deLa: 17 })
      expect(reluareDupa(r, 93, anterioara)).toEqual({ licId: 93, deLa: 17 })
      const m = mesajExtragere(r)
      expect(m.tip).toBe('err')
      expect(m.text).not.toContain('apasă din nou')
      expect(m.text).not.toContain('continui')
    }
  })
  it('401/403 la mijlocul unei reluări → punctul avansează la felia refuzată (17–18 nu se replătesc)', async () => {
    const { invoke } = scriptat([pas({ continua: true, urmatorul: 19, scrise: 12 }), { data: null, error: httpErr(401, { error: 'token invalid' }) }])
    const r = await ruleazaExtragere(invoke, 93, { deLa: 17 })
    expect(r).toMatchObject({ stare: 'eroare', status: 401, deLa: 19 })
    expect(reluareDupa(r, 93, { licId: 93, deLa: 17 })).toEqual({ licId: 93, deLa: 19 })
    expect(mesajExtragere(r).text).not.toContain('apasă din nou')
  })
  it('401/403 pe altă licitație → reluarea celeilalte rămâne neatinsă', async () => {
    const r = await ruleazaExtragere(scriptat([{ data: null, error: httpErr(403, { error: 'fără drept' }) }]).invoke, 93)
    expect(reluareDupa(r, 93, { licId: 5, deLa: 8 })).toEqual({ licId: 5, deLa: 8 })
  })
  it('reluarea anterioară NU supraviețuiește unei rulări reușite; eroarea trecătoare folosește punctul nou', async () => {
    const anterioara = { licId: 93, deLa: 17 }
    expect(reluareDupa({ stare: 'ok', deLa: null }, 93, anterioara)).toBe(null)
    expect(reluareDupa({ stare: 'partial', deLa: null }, 93, anterioara)).toBe(null)
    expect(reluareDupa({ stare: 'eroare', status: 504, deLa: 20 }, 93, anterioara)).toEqual({ licId: 93, deLa: 20 })
  })
  it('eroare la prima felie (deLa 0) → fără reluare (nu e nimic plătit de ocolit)', async () => {
    const r = await ruleazaExtragere(scriptat([{ data: null, error: httpErr(500, { error: 'OPENAI_API_KEY lipsă din secretele funcției' }) }]).invoke, 93)
    expect(reluareDupa(r, 93)).toBe(null)
  })
  it('neterminat → reluare; ok / partial → null', async () => {
    expect(reluareDupa({ stare: 'neterminat', deLa: 7 }, 93)).toEqual({ licId: 93, deLa: 7 })
    expect(reluareDupa({ stare: 'ok', deLa: null }, 93)).toBe(null)
    expect(reluareDupa({ stare: 'partial', deLa: null }, 93)).toBe(null)
  })
})

describe('mesajInvoke', () => {
  it('corp non-JSON → textul corpului + status', async () => {
    const error = { message: 'Edge Function returned a non-2xx status code', context: new Response('gateway timeout', { status: 504 }) }
    expect(await mesajInvoke(error, null)).toBe('gateway timeout (HTTP 504)')
  })
  it('fără context → mesajul erorii', async () => {
    expect(await mesajInvoke({ message: 'Failed to fetch' }, null)).toBe('Failed to fetch')
  })
  it('statusInvoke: status din context, null fără context', () => {
    expect(statusInvoke(httpErr(403, {}))).toBe(403)
    expect(statusInvoke({ message: 'Failed to fetch' })).toBe(null)
    expect(statusInvoke(null)).toBe(null)
  })
})
