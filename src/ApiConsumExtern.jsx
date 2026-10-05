// ════════════════════════════════════════════════════════════════
// ApiConsumExtern.jsx — consumul abonamentelor externe (Administrativ › Costuri AI, doar owner).
// Temă Răzvan 05.10.2026 (claude_docs tema_firecrawl_consum): un card per furnizor, din public.v_api_consum_curent +
// ultimele 30 de zile din public.api_consum_extern (migrarea 20261014a). Scriu: edge-ul api-consum-extern (cron zilnic
// 07:05 sau butonul „Citește acum”) și rutina zilnică Claude (Desktop Commander). Fără intrări de mână.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import { carduri, consumZilnic, procentRamas, epuizare, fmtZi, fmtOra, fmtNr, plusZile } from './apiConsum.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  orange:'#F0883E', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149' }
const card = { background:G.card, borderRadius:12, border:`1px solid ${G.border}`, padding:'14px 16px' }
const btn = { padding:'5px 10px', borderRadius:6, border:`1px solid ${G.border}`, background:'transparent', color:G.text, fontSize:11.5, fontWeight:700, cursor:'pointer' }

export default function ApiConsumExtern() {
  const [view, setView] = useState(null)        // null = se încarcă
  const [istoric, setIstoric] = useState([])
  const [eroare, setEroare] = useState(null)
  const [citesc, setCitesc] = useState(null)     // furnizorul în curs de citire
  const [mesaj, setMesaj] = useState(null)

  const incarca = useCallback(async () => {
    const azi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' })
    const [{ data: v, error: eV }, { data: h, error: eH }] = await Promise.all([
      supabase.from('v_api_consum_curent').select('*'),
      supabase.from('api_consum_extern').select('furnizor, zi, credite_plan, credite_ramase, credite_consumate, perioada_start, eroare, citit_la')
        .gte('zi', plusZile(azi, -30)).order('zi', { ascending: true }).limit(2000),
    ])
    const e = eV || eH
    setEroare(e ? (/does not exist|schema cache/i.test(e.message) ? 'Tabelul de consum nu există încă (migrarea 20261014a nu e aplicată).' : e.message) : null)
    setView(e ? [] : (v || []))
    setIstoric(e ? [] : (h || []))
  }, [])
  useEffect(() => { incarca() }, [incarca])

  const citesteAcum = async (furnizor) => {
    setCitesc(furnizor); setMesaj(null)
    const { data, error } = await supabase.functions.invoke('api-consum-extern', { body: { furnizor } })
    setCitesc(null)
    if (error) setMesaj({ tip: 'err', text: `Citirea a eșuat: ${error.message}` })
    else {
      const r = (data?.rezultate || [])[0]
      setMesaj(r?.ok ? { tip: 'ok', text: 'Citit acum.' } : { tip: 'err', text: r?.eroare || data?.error || 'eroare necunoscută' })
    }
    await incarca()
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize:15, fontWeight:700, color:G.text, marginBottom:10, display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:20 }}>🔌</span> Abonamente externe · consum zilnic
        <span style={{ fontSize:11, fontWeight:400, color:G.dim }}>citit automat zilnic la 07:05 (edge) sau de rutina Claude — fără intrări de mână</span>
      </div>
      {eroare && <div style={{ ...card, color:G.yellow, fontSize:12.5, marginBottom:10 }}>⚠️ {eroare}</div>}
      {mesaj && <div style={{ fontSize:12, marginBottom:8, color: mesaj.tip === 'ok' ? G.green : G.red }}>{mesaj.tip === 'ok' ? '✓' : '⚠️'} {mesaj.text}</div>}
      {view === null ? <div style={{ fontSize:12, color:G.muted }}>⏳ Se încarcă…</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:12 }}>
          {carduri(view).map(({ furnizor, v, ui }) => {
            const pct = v ? procentRamas(v.credite_plan, v.credite_ramase) : null
            const ep = v ? epuizare(v) : null
            const zile = consumZilnic(istoric.filter(r => r.furnizor === furnizor)).slice(-7).reverse()
            const culoare = pct == null ? G.dim : pct < 15 ? G.red : pct < 35 ? G.orange : G.green
            const eRutina = (v?.sursa || (furnizor === 'desktop_commander' ? 'rutina_claude' : 'api')) === 'rutina_claude'
            return (
              <div key={furnizor} style={card}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:18 }}>{ui.icon}</span>
                  <b style={{ fontSize:13.5 }}>{ui.nume}</b>
                  <span style={{ fontSize:10.5, color:G.dim }}>{ui.descriere}</span>
                  {!eRutina && <button style={{ ...btn, marginLeft:'auto', opacity: citesc ? .6 : 1 }} disabled={!!citesc} onClick={() => citesteAcum(furnizor)}>{citesc === furnizor ? '⏳' : '🔄'} Citește acum</button>}
                </div>
                {!v || v.zi == null ? (
                  <div style={{ fontSize:12, color:G.muted }}>
                    {v?.ultima_eroare ? <span style={{ color:G.red }}>⚠️ {v.ultima_eroare}</span>
                      : eRutina ? 'Fără citiri încă — le scrie rutina zilnică a sesiunii Claude de programare.'
                      : 'Fără citiri încă — cheia FIRECRAWL_API_KEY lipsește din Edge Secrets sau cronul n-a rulat.'}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:12.5, color:G.text, marginBottom:6 }}>
                      {v.unitate === 'procent'
                        ? <><b style={{ fontSize:20, color:culoare }}>{fmtNr(v.credite_ramase)}%</b> din cota lunară rămasă</>
                        : <><b style={{ fontSize:20, color:culoare }}>{fmtNr(v.credite_ramase)}</b> {v.unitate} rămase{v.credite_plan != null ? ` din ${fmtNr(v.credite_plan)}` : ''}</>}
                    </div>
                    {pct != null && (
                      <div style={{ height:8, background:G.bg, borderRadius:5, overflow:'hidden', marginBottom:8 }}>
                        <div style={{ height:'100%', width:`${pct}%`, background:culoare, borderRadius:5 }} />
                      </div>
                    )}
                    <div style={{ fontSize:11.5, color:G.muted, lineHeight:1.7 }}>
                      {v.perioada_start && <div>Perioada: {fmtZi(v.perioada_start)} – {fmtZi(v.perioada_sfarsit)}</div>}
                      {v.ritm_zilnic != null && <div>Ritm: ~{fmtNr(v.ritm_zilnic)} {v.unitate === 'procent' ? 'puncte' : v.unitate}/zi în perioadă</div>}
                      {ep && <div style={{ color: ep.inainteDeReset ? G.orange : G.muted }}>{ep.inainteDeReset ? '⚠️ La ritmul ăsta se termină pe ' : 'La ritmul ăsta ar ajunge până pe '}<b>{fmtZi(ep.data)}</b>{ep.inainteDeReset === false ? ' (după reset)' : ''}</div>}
                      <div>Citit {eRutina ? 'de rutina Claude' : ''} la {fmtOra(v.citit_la)}</div>
                      {v.ultima_eroare && <div style={{ color:G.red }}>⚠️ Ultima încercare ({fmtOra(v.ultima_incercare_la)}): {v.ultima_eroare}</div>}
                    </div>
                    {zile.length > 1 && (
                      <div style={{ marginTop:8, borderTop:`1px solid ${G.border2}`, paddingTop:6, fontSize:11, color:G.dim }}>
                        {zile.map(z => (
                          <div key={z.zi} style={{ display:'grid', gridTemplateColumns:'80px 1fr 1fr', gap:6 }}>
                            <span>{fmtZi(z.zi).slice(0, 5)}</span>
                            <span>{fmtNr(z.ramase)}{v.unitate === 'procent' ? '%' : ''} rămase</span>
                            <span style={{ color: z.reset ? G.blue : G.muted }}>{z.reset ? '↺ reset' : z.consum == null ? '' : `−${fmtNr(z.consum)} în zi`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
