// Mutanți pe codul JS al ecranului „🔔 Semnale” (20270106a), ceruți de review-ul Jakarinos (PR #1164, r2): pentru fiecare remediere din runda 1
// un mutant care o anulează → verificarea TREBUIE să pice pe codul mutat și să treacă pe codul real; altfel testul nu păzește regula.
//   * clasificarea răspunsului RPC (L05, executieSemnaleLogica.js): orice eroare = refuz; 408 = refuz; 5xx = refuz; status lipsă = refuz;
//     corp „ok” fără semnal = ok;
//   * afișarea dovezii (executieSemnaleLogica.js): „negăsit” fără obligația care cere documentul; câmp lipsă fără data / fragmentul citit;
//     constatat fără data sursei;
//   * ecranul (ExecutieSemnale.jsx): rezultatul necunoscut arătat ca „nu s-a salvat”; necunoscut fără închiderea formularului și reîncărcare;
//     excepția clientului (fetch picat după trimitere) tratată ca refuz; dovada afișată fără dovadaText (doar fragmentul).
// Modulele se copiază în .tmp/ (ignorat de git; %TEMP% cu cale scurtă nu se încarcă prin vite), cu mutația aplicată EXACT o dată, și se importă de
// acolo; importurile relative ale copiei ecranului sunt rescrise spre fișierele reale din src/ (client Supabase = stub, componenta primește
// clientul fals prin props). Mutanții de ecran cer jsdom (ca ExecutieSemnale.test.jsx); fără el sunt SĂRIȚI VIZIBIL. Cei de logică rulează mereu.
import { afterAll, afterEach, describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM, MOTIV_SARIT, SEM, clientFals, monteaza, curataTot } from './ExecutieSemnale.testutil.jsx'

const LOGICA = 'src/executieSemnaleLogica.js'
const ECRAN = 'src/ExecutieSemnale.jsx'
// finalurile de rând normalizate (fișierele au CRLF la checkout pe Windows): mutațiile pot cuprinde „\n”
const citeste = cale => readFileSync(cale, 'utf8').replace(/\r\n/g, '\n')
const SURSE = { logica: citeste(LOGICA), ecran: citeste(ECRAN) }
const url = rel => pathToFileURL(resolve(rel)).href
const TMP = join(process.cwd(), '.tmp')
mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
afterEach(curataTot)

function muta(text, mutatie, fisier) {
  if (!mutatie || mutatie.fisier !== fisier) return text
  if (text.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${fisier}: ${mutatie.din.slice(0, 80)}`)
  return text.replace(mutatie.din, mutatie.in)
}
/** copiază logica (+ ecranul, dacă e cerut) cu mutația dată și le importă din .tmp/ */
async function incarca(mutatie, { cuEcran = false } = {}) {
  const dir = mkdtempSync(join(TMP, 'semnale_mutant_'))
  foldere.push(dir)
  writeFileSync(join(dir, 'executieSemnaleLogica.js'), muta(SURSE.logica, mutatie, 'logica'))
  const logica = await import(pathToFileURL(join(dir, 'executieSemnaleLogica.js')).href)
  if (!cuEcran) return { logica }
  writeFileSync(join(dir, 'supabase_stub.js'), 'export const supabase = null\n')
  const ecranText = muta(SURSE.ecran, mutatie, 'ecran')
    .replace("from './lib/supabase.js'", "from './supabase_stub.js'")
    .replace("from './hrDeciziiUtil.js'", `from '${url('src/hrDeciziiUtil.js')}'`)
    .replace("from './lib/izoTeren.js'", `from '${url('src/lib/izoTeren.js')}'`)
    .replace("from './NodCuplareVizualizare.jsx'", `from '${url('src/NodCuplareVizualizare.jsx')}'`)
  for (const imp of ['./supabase_stub.js', 'src/hrDeciziiUtil.js', 'src/lib/izoTeren.js', 'src/NodCuplareVizualizare.jsx', "from './executieSemnaleLogica.js'"])
    if (!ecranText.includes(imp)) throw new Error('importul ecranului nu a fost rescris: ' + imp)
  writeFileSync(join(dir, 'ExecutieSemnale.jsx'), ecranText)
  const ecran = await import(pathToFileURL(join(dir, 'ExecutieSemnale.jsx')).href)
  return { logica, ecran: { ExecutieSemnale: ecran.default, SemnaleOwnerPanel: ecran.SemnaleOwnerPanel } }
}

// ── verificările: liste de abateri (goale pe codul real); fiecare mutant trebuie să producă cel puțin una ──
const sem = { id: 7, stare: 'in_lucru', versiune: 4 }
function abateriClasificare({ clasificaRaspunsStare: c }) {
  const ab = []
  const vrea = (ce, res, tip) => { const r = c(res); if (r.tip !== tip) ab.push(`${ce}: ${r.tip} (aștepta ${tip})`); return r }
  vrea('403 = refuz sigur', { data: null, error: { code: '42501', message: 'nu ai drept' }, status: 403 }, 'refuz')
  vrea('400 = refuz sigur', { data: null, error: { code: '22023', message: 'cere un motiv' }, status: 400 }, 'refuz')
  vrea('408 = necunoscut', { data: null, error: { code: '42501', message: 'x' }, status: 408 }, 'necunoscut')
  vrea('status 0 (rețea) = necunoscut', { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }, 'necunoscut')
  vrea('503 = necunoscut', { data: null, error: { message: 'gateway' }, status: 503 }, 'necunoscut')
  vrea('504 = necunoscut', { data: null, error: { message: 'gateway timeout' }, status: 504 }, 'necunoscut')
  vrea('status lipsă = necunoscut', { data: null, error: { code: '42501', message: 'x' } }, 'necunoscut')
  vrea('ok fără semnal = necunoscut', { data: { ok: true }, error: null, status: 200 }, 'necunoscut')
  vrea('ok cu semnal fără id = necunoscut', { data: { ok: true, semnal: {} }, error: null, status: 200 }, 'necunoscut')
  vrea('corp străin = necunoscut', { data: { ceva: 1 }, error: null, status: 200 }, 'necunoscut')
  const okR = vrea('ok = ok', { data: { ok: true, semnal: sem }, error: null, status: 200 }, 'ok')
  if (okR.semnal !== sem) ab.push('ok nu întoarce semnalul')
  vrea('conflict = conflict', { data: { ok: false, motiv: 'conflict', semnal: sem }, error: null, status: 200 }, 'conflict')
  return ab
}
const S = (extra = {}) => ({ id: 1, constatare: 'constatat', surse_consultate: [], dovada_sursa: 'camp_erp', dovada_data: '2026-11-21', dovada_fragment: 'data_termen = 2026-12-11', dovada_ref: 'executie_proiecte.data_termen', ...extra })
function abateriDovada({ dovadaText: d }) {
  const ab = []
  const vrea = (ce, r, text) => { const t = d(r); if (t !== text) ab.push(`${ce}: „${t}” (aștepta „${text}”)`) }
  vrea('negăsit = sursele consultate + OBLIGAȚIA (sursă · dată · fragment)',
    S({ constatare: 'negasit_in_surse', surse_consultate: ['NAS', 'mail'], dovada_sursa: 'document', dovada_data: '2026-09-18', dovada_fragment: 'art. 8: GBE în max. 15 zile' }),
    'Negăsit în sursele consultate: NAS, mail · obligația: document · 18.09.2026 · art. 8: GBE în max. 15 zile')
  vrea('negăsit fără obligație arată lipsa', S({ constatare: 'negasit_in_surse', surse_consultate: ['NAS'], dovada_sursa: null, dovada_data: null, dovada_fragment: null }), 'Negăsit în sursele consultate: NAS · obligația: —')
  vrea('câmp lipsă = câmpul + data · ce s-a citit', S({ constatare: 'camp_lipsa', dovada_ref: 'sites.proiect_id', dovada_data: '2026-11-22', dovada_fragment: 'niciun șantier legat' }), 'Câmp gol în ERP: sites.proiect_id · 22.11.2026 · niciun șantier legat')
  vrea('câmp lipsă doar cu câmpul', S({ constatare: 'camp_lipsa', dovada_ref: 'executie_proiecte.nr_contract', dovada_data: null, dovada_fragment: null }), 'Câmp gol în ERP: executie_proiecte.nr_contract')
  vrea('constatat = sursă · dată · fragment', S(), 'câmp ERP · 21.11.2026 · data_termen = 2026-12-11')
  return ab
}
// ecranul: rezultatul NECUNOSCUT (status 0 / 5xx / excepție a clientului) nu e „nu s-a salvat”; formularul se închide, lista se reîncarcă, starea
// reală de pe server e vizibilă, nicio retrimitere
async function abateriEcranNecunoscut(ecran, mod) {
  const ab = []
  const { client, st, server } = clientFals({ randuri: [SEM(1)] })
  const u = await monteaza(ecran, client)
  await u.apasa(u.buton('Semnal 1'))
  await u.apasa(u.buton('Schimbă starea'))
  await u.scrie(u.camp('stare nouă'), 'in_lucru')
  await u.apasa(u.buton('Salvează'))
  const cereri = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
  await u.elibereaza(st.rpc[0], mod)
  if (server.get(1).stare !== 'in_lucru') ab.push(`${mod}: serverul fals nu a comis`)
  const text = u.d.body.textContent
  if (!text.includes('Rezultat necunoscut')) ab.push(`${mod}: lipsește „Rezultat necunoscut”`)
  if (text.includes('Schimbarea nu s-a salvat')) ab.push(`${mod}: arată „Schimbarea nu s-a salvat” (rezultatul nu e sigur)`)
  if (st.cereri.filter(c => c.tabel === 'v_executie_semnale').length <= cereri) ab.push(`${mod}: lista nu s-a reîncărcat`)
  if (!(u.d.querySelector('[data-semnal="1"]')?.textContent || '').includes('în lucru')) ab.push(`${mod}: starea reală (în lucru) nu e vizibilă`)
  if (u.d.querySelector('[role="form"]')) ab.push(`${mod}: formularul a rămas deschis`)
  if (st.rpc.length !== 1) ab.push(`${mod}: ${st.rpc.length} apeluri RPC (retrimitere)`)
  return ab
}
// ecranul: „negăsit” arată sursele consultate ȘI obligația (sursă · dată · fragment) + calea
async function abateriEcranObligatie(ecran) {
  const ab = []
  const { client } = clientFals({ randuri: [SEM(2, { titlu: 'Polița GBE negăsită', constatare: 'negasit_in_surse', surse_consultate: ['ERP: polițe', 'NAS: dosar'], dovada_sursa: 'document',
    dovada_data: '2026-09-18', dovada_fragment: 'art. 8: GBE 10% în max. 15 zile', dovada_ref: 'NAS: contract.pdf', termen: null, termen_baza: null, termen_confirmat: null })] })
  const u = await monteaza(ecran, client)
  await u.apasa(u.buton('Polița GBE negăsită'))
  const text = u.d.body.textContent
  if (!text.includes('Negăsit în sursele consultate: ERP: polițe, NAS: dosar · obligația: document · 18.09.2026 · art. 8: GBE 10% în max. 15 zile')) ab.push('obligația nu e afișată cu sursele: ' + text.slice(0, 400))
  if (!text.includes('NAS: contract.pdf')) ab.push('calea nu e afișată')
  return ab
}

// ── mutanții: [nume, { fisier, din, in }, verificarea] ──
const MUTANTI_LOGICA = [
  ['L1 orice eroare = refuz sigur (rețea / 5xx ar fi „nu s-a salvat”)', { fisier: 'logica', din: 'const sigur = Number.isInteger(status) && status >= 400 && status < 500 && status !== 408', in: 'const sigur = true' }, abateriClasificare],
  ['L2 408 (timeout) = refuz sigur', { fisier: 'logica', din: ' && status !== 408', in: '' }, abateriClasificare],
  ['L3 5xx = refuz sigur', { fisier: 'logica', din: ' && status < 500 && status !== 408', in: ' && status !== 408' }, abateriClasificare],
  ['L4 status lipsă = refuz sigur', { fisier: 'logica', din: 'const sigur = Number.isInteger(status) && status >= 400 && status < 500 && status !== 408', in: 'const sigur = !Number.isInteger(status) || (status >= 400 && status < 500 && status !== 408)' }, abateriClasificare],
  ['L5 corp „ok” fără semnal = ok', { fisier: 'logica', din: 'if (data && data.ok === true && data.semnal && data.semnal.id != null) return', in: 'if (data && data.ok === true) return' }, abateriClasificare],
  ['L6 „negăsit” fără obligația care cere documentul', { fisier: 'logica', din: "return `Negăsit în sursele consultate: ${(r.surse_consultate || []).join(', ') || '—'} · obligația: ${ob || '—'}`", in: "return `Negăsit în sursele consultate: ${(r.surse_consultate || []).join(', ') || '—'}`" }, abateriDovada],
  ['L7 câmp lipsă fără data / fragmentul citit', { fisier: 'logica', din: "return `Câmp gol în ERP: ${r.dovada_ref || '—'}${citit ? ' · ' + citit : ''}`", in: "return `Câmp gol în ERP: ${r.dovada_ref || '—'}`" }, abateriDovada],
  ['L8 constatat fără data sursei', { fisier: 'logica', din: 'const dovadaPiese = r => [SURSA_INFO[r.dovada_sursa] || r.dovada_sursa, r.dovada_data ? fmtZi(r.dovada_data) : null, r.dovada_fragment]', in: 'const dovadaPiese = r => [SURSA_INFO[r.dovada_sursa] || r.dovada_sursa, r.dovada_fragment]' }, abateriDovada],
]
const MUTANTI_ECRAN = [
  ['C1 rezultatul necunoscut arătat ca „nu s-a salvat” (fără reîncărcare)', { fisier: 'ecran',
    din: "if (c.tip === 'necunoscut') { necunoscut(c.eroare ? textEroare(c.eroare) + (c.detaliu ? ` (${c.detaliu})` : '') : c.detaliu || ''); return }",
    in: "if (c.tip === 'necunoscut') { setMesaj({ tip: 'eroare', text: 'Schimbarea nu s-a salvat: ' + (c.detaliu || '') }); return }" }, e => abateriEcranNecunoscut(e, 'retea')],
  ['C2 necunoscut cu mesaj corect, dar fără închiderea formularului și reîncărcare', { fisier: 'ecran', din: '      setForm(null); incarca()\n    }', in: '    }' }, e => abateriEcranNecunoscut(e, '5xx')],
  ['C3 excepția clientului (fetch picat după trimitere) tratată ca refuz sigur', { fisier: 'ecran', din: '      necunoscut(textEroare(e))', in: "      setMesaj({ tip: 'eroare', text: 'Schimbarea nu s-a salvat: ' + textEroare(e) })" }, e => abateriEcranNecunoscut(e, 'arunca')],
  ['C4 dovada afișată doar ca fragment (fără sursele consultate și obligația)', { fisier: 'ecran', din: "{dovadaText(r) || '—'}", in: "{r.dovada_fragment || '—'}" }, abateriEcranObligatie],
  ['C5 ecranul cu logica mutată: „negăsit” fără obligația (același text ajunge în pagină)', MUTANTI_LOGICA[5][1], abateriEcranObligatie],
]

describe('mutanții logicii (clasificarea răspunsului RPC, afișarea dovezii) — fiecare TREBUIE să pice', () => {
  it('codul real trece toate verificările', async () => {
    const { logica } = await incarca(null)
    expect(abateriClasificare(logica)).toEqual([])
    expect(abateriDovada(logica)).toEqual([])
  })
  for (const [nume, mutatie, verificare] of MUTANTI_LOGICA) {
    it(nume, async () => {
      const { logica } = await incarca(mutatie)
      const ab = verificare(logica)
      expect(ab.length, 'mutantul NU a picat').toBeGreaterThan(0)
    })
  }
})

const dom = JSDOM ? describe : describe.skip
dom(JSDOM ? 'mutanții ecranului (jsdom + react-dom) — fiecare TREBUIE să pice' : `mutanții ecranului — ${MOTIV_SARIT}`, () => {
  it('ecranul real trece verificările (necunoscut: rețea / 5xx / excepție; obligația)', async () => {
    const { ecran } = await incarca(null, { cuEcran: true })
    for (const mod of ['retea', '5xx', 'arunca']) expect(await abateriEcranNecunoscut(ecran, mod)).toEqual([])
    expect(await abateriEcranObligatie(ecran)).toEqual([])
  })
  for (const [nume, mutatie, verificare] of MUTANTI_ECRAN) {
    it(nume, async () => {
      const { ecran } = await incarca(mutatie, { cuEcran: true })
      const ab = await verificare(ecran)
      expect(ab.length, 'mutantul NU a picat').toBeGreaterThan(0)
    })
  }
})
