// Teste de componentă pentru ExecutieSemnale („🔔 Semnale”, 20270106a): componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS
// ale cărui răspunsuri se pot ține și elibera manual (harness-ul comun: ExecutieSemnale.testutil.jsx, folosit și de mutanții din
// ExecutieSemnaleMutanti.test.jsx). Fără rețea, fără librării noi. Fără jsdom (nu e dependență a proiectului), suita e SĂRITĂ VIZIBIL.
import { afterEach, describe, it, expect, vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import ExecutieSemnale, { SemnaleOwnerPanel } from './ExecutieSemnale.jsx'
import { JSDOM, MOTIV_SARIT, amana, SEM, clientFals, monteaza as monteazaCu, curataTot } from './ExecutieSemnale.testutil.jsx'

if (!JSDOM) console.warn(`[ExecutieSemnale.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)
afterEach(curataTot)
const monteaza = (client, props) => monteazaCu({ ExecutieSemnale, SemnaleOwnerPanel }, client, props)

dom(numeDom('ExecutieSemnale (jsdom + react-dom)'), () => {
  it('lista: sortată după termen, deschisele implicit; filtrele pe gravitate / stare și textul; „arată și rezolvate”', async () => {
    const { client, st } = clientFals({ randuri: [
      SEM(1, { termen: '2026-12-11' }), SEM(2, { termen: '2026-11-30', gravitate: 'critic', titlu: 'Polița CAR expiră' }),
      SEM(3, { termen: null, gravitate: 'info', stare: 'in_lucru' }), SEM(4, { termen: '2026-11-25', stare: 'respins', stare_motiv: 'nu e cazul' }),
      SEM(9, { proiect_id: 2, proiect_cod: 'P2' }),
    ] })
    const u = await monteaza(client)
    expect(u.semnale()).toEqual([2, 1, 3])                          // fără respinsul 4 și fără P2 (filtrat pe proiect)
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale')[0].eq.proiect_id).toBe(1)
    expect(u.d.body.textContent).toContain('3 deschise din 4')
    expect(u.d.body.textContent).toContain('termen 30.11.2026 · 9 z')
    await u.bifa([...u.d.querySelectorAll('input[type="checkbox"]')][0])   // arată și rezolvate / respinse
    expect(u.semnale()).toEqual([4, 2, 1, 3])
    await u.apasa(u.buton('critic'))
    expect(u.semnale()).toEqual([2])
    await u.apasa(u.buton('critic'))
    await u.scrie(u.camp('caută'), 'polita car')
    expect(u.semnale()).toEqual([2])
    await u.scrie(u.camp('caută'), '')
    await u.apasa(u.buton('în lucru'))
    expect(u.semnale()).toEqual([3])
  })

  it('eroarea de citire se arată (nu listă goală); „Reîncearcă” cere din nou (L18)', async () => {
    const { client, st } = clientFals({ erori: { v_executie_semnale: { message: 'relation "public.v_executie_semnale" does not exist' } } })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Nu am putut încărca semnalele')
    expect(u.d.body.textContent).toContain('migrarea 20270106a')
    expect(u.d.body.textContent).not.toContain('Niciun semnal')
    const n = st.cereri.length
    await u.apasa(u.buton('Reîncearcă'))
    expect(st.cereri.length).toBeGreaterThan(n)
  })

  it('detaliile: constatarea, dovada, propunerea, istoricul; schimbarea stării cu motiv → RPC cu id + versiune (CAS), rândul se actualizează', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1, { responsabil_employee_id: 10, responsabil_sursa: 'agent' })],
      jurnal: { 1: [{ id: 1, semnal_id: 1, actiune: 'creat', actor: 'agent', stare_veche: null, stare_noua: 'nou', motiv: null, valori: {}, creat_la: '2026-11-21T20:00:00+00:00' }] } })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('POPESCU ION')
    expect(u.d.body.textContent).toContain('(propus de agent)')
    await u.bifa([...u.d.querySelectorAll('input[type="checkbox"]')][0])   // arată și rezolvate / respinse (ca rândul să rămână după respingere)
    await u.apasa(u.buton('Semnal 1'))
    expect(u.d.body.textContent).toContain('constatat (cu dovadă)')
    expect(u.d.body.textContent).toContain('câmp ERP · 21.11.2026 · data_termen = 2026-12-11')
    expect(u.d.body.textContent).toContain('Verificați AA.')
    expect(u.d.body.textContent).toContain('creat · agent')
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'respins')
    expect(u.d.body.textContent).toContain('Motiv (obligatoriu)')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(0)
    expect(u.d.body.textContent).toContain('Motivul e obligatoriu')
    await u.scrie(u.camp('motiv'), ' Termenul e prelungit prin AA 2. ')
    await u.scrie(u.camp('acțiune'), 'TKT-2026-9999')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].fn).toBe('fn_executie_semnal_stare')
    expect(st.rpc[0].a).toEqual({ p_id: 1, p_versiune: 1, p_stare: 'respins', p_motiv: 'Termenul e prelungit prin AA 2.', p_dovada: null, p_actiune_ref: 'TKT-2026-9999', p_responsabil: null, p_schimba_responsabil: false })
    expect(u.d.body.textContent).toContain('Se salvează…')
    await u.elibereaza(st.rpc[0], 'ok')
    expect(server.get(1).stare).toBe('respins')
    expect(u.d.body.textContent).toContain('Salvat: respins.')
    expect(u.d.body.textContent).toContain('decizia: respins · Termenul e prelungit prin AA 2.')
    expect(u.d.body.textContent).toContain('acțiune: TKT-2026-9999')
    // fără bifa „arată și rezolvate / respinse” respinsul dispare din listă
    await u.bifa([...u.d.querySelectorAll('input[type="checkbox"]')][0])
    expect(u.semnale()).toEqual([])
  })

  it('conflictul (versiune veche) reîncarcă lista și spune de ce; eroarea serverului se arată; responsabilul se schimbă doar cu bifa', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1, { stare: 'in_lucru', versiune: 3, stare_de: 'u1', stare_la: '2026-11-21T21:00:00+00:00' })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    expect(u.camp('responsabil')).toBeTruthy()
    expect([...u.camp('responsabil').querySelectorAll('option')].map(o => o.textContent)).toEqual(['— fără responsabil —', 'IONESCU ANA', 'POPESCU ION'])   // activii, sortați
    await u.scrie(u.camp('responsabil'), '11')
    server.get(1).versiune = 4                                      // altcineva a salvat între timp
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[0].a).toMatchObject({ p_id: 1, p_versiune: 3, p_stare: null, p_responsabil: 11, p_schimba_responsabil: true })
    const cereriInainte = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
    await u.elibereaza(st.rpc[0], 'auto')
    expect(u.d.body.textContent).toContain('s-a schimbat între timp')
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale').length).toBeGreaterThan(cereriInainte)
    expect(u.d.body.textContent).toContain('versiunea rândului 4')
    // a doua încercare, pe versiunea nouă: refuzul SIGUR al serverului (4xx) se arată ca eroare, fără reîncărcare, formularul rămâne
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    await u.scrie(u.camp('responsabil'), '11')
    await u.apasa(u.buton('Salvează'))
    const cereriRefuz = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
    await u.elibereaza(st.rpc[1], 'refuz')
    expect(u.d.body.textContent).toContain('Schimbarea nu s-a salvat')
    expect(u.d.body.textContent).toContain('nu ai drept')
    expect(u.d.body.textContent).not.toContain('Rezultat necunoscut')
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale').length).toBe(cereriRefuz)
    // a treia, reușită: numele noului responsabil apare, ca decizie a omului
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[2], 'ok')
    expect(server.get(1).responsabil_employee_id).toBe(11)
    expect(u.d.body.textContent).toContain('IONESCU ANA (stabilit de om)')
    expect(u.d.body.textContent).not.toContain('(propus de agent)')
  })

  it('rezultat NECUNOSCUT (eroare de rețea după COMMIT, 5xx): nu „nu s-a salvat”; formularul se închide, lista se reîncarcă și arată starea reală (L05)', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1), SEM(2, { titlu: 'Semnal 2' })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'in_lucru')
    await u.apasa(u.buton('Salvează'))
    const cereri = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
    await u.elibereaza(st.rpc[0], 'retea')                            // serverul a comis, răspunsul s-a pierdut (status 0)
    expect(server.get(1).stare).toBe('in_lucru')
    expect(u.d.body.textContent).toContain('Rezultat necunoscut')
    expect(u.d.body.textContent).not.toContain('Schimbarea nu s-a salvat')
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale').length).toBeGreaterThan(cereri)   // reîncărcat
    expect(u.d.querySelector('[data-semnal="1"]').textContent).toContain('în lucru')                 // starea reală, de pe server
    expect(u.d.querySelector('[data-semnal="1"]').textContent).toContain('versiunea rândului 2')
    expect(u.d.querySelector('[role="form"]')).toBeNull()                                            // formularul închis: omul verifică, nu retrimite orb
    expect(st.rpc).toHaveLength(1)                                                                   // nicio retrimitere automată
    // 5xx = tot necunoscut
    await u.apasa(u.buton('Semnal 2'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'asteapta_informatii')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[1], '5xx')
    expect(u.d.body.textContent).toContain('Rezultat necunoscut')
    expect(u.d.body.textContent).toContain('status 504')
    expect(u.d.querySelector('[data-semnal="2"]').textContent).toContain('așteaptă informații')
  })

  it('confirmarea responsabilului propus de agent (același angajat) și „fără responsabil” pleacă la server și se arată ca decizii ale omului', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1, { responsabil_employee_id: 10, responsabil_sursa: 'agent' })] })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('POPESCU ION (propus de agent)')
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    expect(u.camp('responsabil').value).toBe('10')                     // propunerea agentului, preselectată
    expect(u.d.body.textContent).toContain('devine decizia ta')
    await u.apasa(u.buton('Salvează'))                                 // fără nicio altă schimbare: confirmarea E o schimbare
    expect(st.rpc[0].a).toMatchObject({ p_id: 1, p_versiune: 1, p_stare: null, p_responsabil: 10, p_schimba_responsabil: true })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(server.get(1).responsabil_sursa).toBe('om')
    expect(u.d.body.textContent).toContain('POPESCU ION (stabilit de om)')
    expect(u.d.body.textContent).not.toContain('(propus de agent)')
    // „fără responsabil”
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    await u.scrie(u.camp('responsabil'), '')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a).toMatchObject({ p_versiune: 2, p_responsabil: null, p_schimba_responsabil: true })
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.d.body.textContent).toContain('fără responsabil (stabilit de om)')
  })

  it('rezolvarea cere dovada SAU acțiunea (oprit local, fără RPC); „negăsit” arată obligația care cere documentul', async () => {
    const { client, st } = clientFals({ randuri: [SEM(1, { stare: 'in_lucru', versiune: 2, stare_de: 'u1', stare_la: '2026-11-21T21:00:00+00:00' }),
      SEM(2, { titlu: 'Polița GBE negăsită', constatare: 'negasit_in_surse', surse_consultate: ['ERP: polițe', 'NAS: dosar'], dovada_sursa: 'document', dovada_data: '2026-09-18',
        dovada_fragment: 'art. 8: GBE 10% în max. 15 zile', dovada_ref: 'NAS: contract.pdf', termen: null, termen_baza: null, termen_confirmat: null })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Polița GBE negăsită'))
    expect(u.d.body.textContent).toContain('Negăsit în sursele consultate: ERP: polițe, NAS: dosar · obligația: document · 18.09.2026 · art. 8: GBE 10% în max. 15 zile')
    expect(u.d.body.textContent).toContain('NAS: contract.pdf')
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'rezolvat')
    expect(u.d.body.textContent).toContain('la rezolvare: dovada SAU acțiunea, obligatoriu')
    await u.scrie(u.camp('motiv'), 'gata')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(0)
    expect(u.d.body.textContent).toContain('dovada rezolvării')
    await u.scrie(u.camp('acțiune'), 'TKT-2026-0001')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].a).toMatchObject({ p_stare: 'rezolvat', p_motiv: 'gata', p_dovada: null, p_actiune_ref: 'TKT-2026-0001' })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('Salvat: rezolvat.')
  })

  it('schimbarea proiectului: răspunsul întârziat al proiectului vechi nu se aplică (L24)', async () => {
    const { client, st } = clientFals({ randuri: [SEM(1), SEM(2, { proiect_id: 2, proiect_cod: 'P2', titlu: 'Semnal P2' })] })
    st.poarta = amana()
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Se încarcă semnalele')
    const poartaVeche = st.poarta
    st.poarta = null
    await u.randeaza({ proiectId: 2 })
    expect(u.semnale()).toEqual([2])
    await u.elibereaza(poartaVeche, undefined)                      // răspunsul vechi (P1) sosește târziu
    expect(u.semnale()).toEqual([2])
    expect(u.d.body.textContent).not.toContain('Semnal 1')
  })

  it('panoul owner-ului: închis implicit (nicio cerere), la deschidere lista tuturor proiectelor cu codul proiectului, fără filtru pe proiect', async () => {
    const { client, st } = clientFals({ randuri: [SEM(1), SEM(2, { proiect_id: 2, proiect_cod: 'P2', titlu: 'Semnal P2', gravitate: 'critic' })] })
    const u = await monteaza(client, { owner: true })
    expect(st.cereri).toHaveLength(0)
    await u.apasa(u.buton('Semnale — toate proiectele'))
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale')[0].eq.proiect_id).toBeUndefined()
    expect(u.semnale()).toEqual([2, 1])
    expect(u.d.body.textContent).toContain('P2')
    expect(u.d.body.textContent).toContain('P1')
  })
})
