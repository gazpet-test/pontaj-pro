// Execuție — acces pe PROIECT (20261209a, decizia lui Răzvan 10.11.2026).
//   useAccesProiectExecutie(client) — ce proiecte vede contul curent (owner / nerestrâns / restrâns / eroare); poarta reală e în BD.
//   MesajAccesProiect                — mesajul clar pentru un link direct către un proiect nepermis (nu ecran gol).
//   AccesProiecteOwnerModal          — ecranul owner-ului: bifează proiectele unui cont (RPC fn_executie_acces_proiect_seteaza, CAS pe lista văzută).
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { stareAcces, listaPentruRpc, listaDinRanduri, diferenteAcces, rezultatSetare, MESAJ_LINK } from './executieAccesProiect.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  executie:'#58A6FF',
}
const S = {
  btn: { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' },
  input: { padding: '8px 12px', background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8, color: G.text, fontSize: 13, boxSizing: 'border-box' },
}

// tabelul nu există încă (migrarea neaplicată): nici în BD nu există restricții → contul se comportă ca azi
const TABEL_LIPSA = e => e && (e.code === 'PGRST205' || e.code === '42P01')

export function useAccesProiectExecutie(client) {
  const [st, setSt] = useState({ gata: false })
  const gen = useRef(0)
  const reincarca = useCallback(async () => {
    const g = ++gen.current
    setSt({ gata: false })
    try {
      const { data: { user } = {}, error: eu } = await client.auth.getUser()
      if (eu) throw eu
      if (!user) { if (g === gen.current) setSt({ gata: true, eroare: 'neautentificat' }); return }
      const [{ data: prof, error: ep }, { data: randuri, error: er }] = await Promise.all([
        client.from('profiles').select('id, is_owner').eq('id', user.id).maybeSingle(),
        // RPC-ul de setare plafonează lista la 500 de proiecte: încape într-o pagină
        client.from('executie_acces_proiect').select('profile_id, proiect_id, nivel').eq('profile_id', user.id).order('proiect_id'),
      ])
      if (g !== gen.current) return
      if (ep) throw ep
      if (er && !TABEL_LIPSA(er)) throw er
      setSt({ gata: true, eOwner: prof?.is_owner === true, randuri: er ? [] : (randuri || []) })
    } catch (e) {
      if (g === gen.current) setSt({ gata: true, eroare: e?.message || String(e) })
    }
  }, [client])
  useEffect(() => { reincarca(); return () => { gen.current++ } }, [reincarca])
  const acces = useMemo(() => stareAcces(st), [st])
  return { acces, reincarca }
}

export function MesajAccesProiect({ verdict, eroare, onBack }) {
  const text = verdict === 'eroare' ? 'Nu am putut verifica proiectul: ' + (eroare || 'eroare necunoscută') : (MESAJ_LINK[verdict] || MESAJ_LINK.lipsa)
  const culoare = verdict === 'eroare' ? G.red : G.yellow
  return (
    <div style={{ padding: '48px 28px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%', background: G.surface, border: `1px solid ${culoare}55`, borderRadius: 12, padding: '24px 26px' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>{verdict === 'eroare' ? '⚠️' : '🔒'}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: G.text, marginBottom: 8 }}>
          {verdict === 'eroare' ? 'Eroare la încărcare' : 'Proiect indisponibil'}
        </div>
        <div style={{ fontSize: 13, color: G.muted, lineHeight: 1.5, marginBottom: 18 }}>{text}</div>
        <button onClick={onBack} style={{ ...S.btn, background: G.executie, color: '#0D1117' }}>← Înapoi la proiectele mele</button>
      </div>
    </div>
  )
}

// ── ecranul owner-ului ───────────────────────────────────────────────────────────────────────────────────
export function AccesProiecteOwnerModal({ client, onClose }) {
  const [conturi, setConturi] = useState([])       // [{profile_id, name, email, access_level}]
  const [proiecte, setProiecte] = useState([])     // [{id, cod_intern, nume, activ}]
  const [randuriToti, setRanduriToti] = useState([]) // rândurile tuturor conturilor (pentru eticheta „restrâns (N)”)
  const [incarcare, setIncarcare] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [contSel, setContSel] = useState('')
  const [vechi, setVechi] = useState([])           // lista contului, așa cum am citit-o (trimisă pentru CAS)
  const [bife, setBife] = useState(new Map())      // proiect_id -> nivel
  const [cauta, setCauta] = useState('')
  const [salvez, setSalvez] = useState(false)
  const [mesaj, setMesaj] = useState(null)         // {tip:'ok'|'eroare'|'info', text}
  const gen = useRef(0)
  const contRef = useRef('')                       // contul curent, pentru răspunsurile întârziate (L24)
  useEffect(() => { contRef.current = contSel }, [contSel])

  const incarca = useCallback(async (pastreazaCont) => {
    const g = ++gen.current
    setIncarcare(true); setEroare(null)
    try {
      const acces = await paginareKeyset((ultim, pas) => {
        let q = client.from('user_module_access').select('id, profile_id, access_level').eq('module', 'executie').order('id').limit(pas)
        return ultim == null ? q : q.gt('id', ultim)
      })
      const ids = [...new Set(acces.map(a => a.profile_id))]
      const profile = []
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await client.from('profiles').select('id, name, email, is_owner').in('id', ids.slice(i, i + 100))
        if (error) throw error
        for (const p of data || []) profile.push(p)
      }
      const pr = await paginareKeyset((ultim, pas) => {
        let q = client.from('executie_proiecte').select('id, cod_intern, nume, activ').order('id').limit(pas)
        return ultim == null ? q : q.gt('id', ultim)
      })
      // tabelul de acces are cheie compusă (fără id): keyset pe (profile_id, proiect_id) nu se poate cu .gt simplu → pe fiecare cont
      const randuri = []
      for (const pid of ids) {
        const { data, error } = await client.from('executie_acces_proiect').select('profile_id, proiect_id, nivel, acordat_la').eq('profile_id', pid).order('proiect_id')
        if (error) throw error
        for (const r of data || []) randuri.push(r)
      }
      if (g !== gen.current) return
      const pm = new Map(profile.map(p => [p.id, p]))
      setConturi(acces.map(a => ({ profile_id: a.profile_id, access_level: a.access_level, name: pm.get(a.profile_id)?.name || '(fără nume)',
                                   email: pm.get(a.profile_id)?.email || '', is_owner: pm.get(a.profile_id)?.is_owner === true }))
        .filter(c => !c.is_owner)
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')))
      setProiecte(pr)
      setRanduriToti(randuri)
      if (!pastreazaCont) setContSel('')
    } catch (e) {
      if (g === gen.current) setEroare(e?.message || String(e))
    } finally {
      if (g === gen.current) setIncarcare(false)
    }
  }, [client])
  useEffect(() => { incarca(false); return () => { gen.current++ } }, [incarca])

  // la schimbarea contului (sau după reîncărcare): lista lui, exact cum e în BD
  useEffect(() => {
    if (!contSel) { setVechi([]); setBife(new Map()); return }
    const l = listaDinRanduri(randuriToti, contSel)
    setVechi(l)
    setBife(new Map(l.map(x => [x.proiect_id, x.nivel])))
    setMesaj(null)
  }, [contSel, randuriToti])

  const nou = useMemo(() => { try { return listaPentruRpc(bife) } catch { return null } }, [bife])
  const dif = useMemo(() => diferenteAcces(vechi, nou || []), [vechi, nou])
  const restrans = vechi.length > 0
  const contInfo = conturi.find(c => c.profile_id === contSel)
  const nrPeCont = useMemo(() => {
    const m = new Map(); for (const r of randuriToti) m.set(r.profile_id, (m.get(r.profile_id) || 0) + 1); return m
  }, [randuriToti])
  const proiecteFiltrate = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    return proiecte.filter(p => !q || `${p.cod_intern || ''} ${p.nume || ''}`.toLowerCase().includes(q))
  }, [proiecte, cauta])
  const eticheta = id => { const p = proiecte.find(x => x.id === id); return p ? (p.cod_intern || `#${p.id}`) : `#${id}` }

  const bifeaza = (id, on) => setBife(prev => { const m = new Map(prev); if (on) m.set(id, m.get(id) || 'editor'); else m.delete(id); return m })
  const nivel = (id, n) => setBife(prev => { const m = new Map(prev); if (m.has(id)) m.set(id, n); return m })

  const trimite = async (pRestrans, lista) => {
    const cont = contSel
    const g = gen.current            // tokenul ÎNAINTEA primului await (L24)
    setSalvez(true); setMesaj(null)
    try {
      const { data, error } = await client.rpc('fn_executie_acces_proiect_seteaza', {
        p_profile: cont, p_restrans: pRestrans, p_lista: lista, p_lista_veche: vechi,
      })
      if (g !== gen.current || cont !== contRef.current) return
      const r = rezultatSetare(data, error)
      if (r.tip === 'ok') {
        setMesaj({ tip: 'ok', text: r.duplicat ? 'Nimic de schimbat: lista era deja aceasta.' : (pRestrans ? `Salvat: ${r.lista.length} proiecte.` : 'Restricția a fost scoasă: contul vede din nou toate proiectele.') })
        await incarca(true)
      } else if (r.tip === 'conflict') {
        setMesaj({ tip: 'eroare', text: 'Lista acestui cont s-a schimbat între timp (alt tab / alt calculator). Am reîncărcat-o: verifică și salvează din nou.' })
        await incarca(true)
      } else {
        // eroare: nu știm sigur dacă s-a scris (rețea / timeout) → reîncărcăm din BD, nu presupunem nimic (L05)
        setMesaj({ tip: 'eroare', text: 'Eroare: ' + r.mesaj + ' — am reîncărcat lista din baza de date.' })
        await incarca(true)
      }
    } finally {
      setSalvez(false)
    }
  }

  const salveaza = () => {
    if (!nou) { setMesaj({ tip: 'eroare', text: 'Selecție invalidă.' }); return }
    if (nou.length === 0) { setMesaj({ tip: 'eroare', text: 'Bifează cel puțin un proiect. Ca să vadă toate proiectele, folosește „Scoate restricția”.' }); return }
    if (dif.nimic) { setMesaj({ tip: 'info', text: 'Nicio schimbare.' }); return }
    const linii = [
      dif.adaugate.length ? `+ ${dif.adaugate.map(eticheta).join(', ')}` : null,
      dif.scoase.length ? `− ${dif.scoase.map(eticheta).join(', ')}` : null,
      dif.schimbate.length ? `nivel schimbat: ${dif.schimbate.map(eticheta).join(', ')}` : null,
    ].filter(Boolean)
    const intro = restrans ? '' : 'ATENȚIE: contul vede azi TOATE proiectele; după salvare va vedea DOAR cele bifate '
      + '(și raportul zilnic doar pe șantierele lor).\n\n'
    if (!window.confirm(`${intro}${contInfo?.name || 'Contul'} — ${nou.length} proiecte în Execuție:\n${linii.join('\n')}\n\nSalvez?`)) return
    trimite(true, nou)
  }
  const scoateRestrictia = () => {
    if (!window.confirm(`${contInfo?.name || 'Contul'} va vedea din nou TOATE proiectele din Execuție (cât îi dă modulul). Continui?`)) return
    trimite(false, [])
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !salvez) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '50px 16px', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 780, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, color: G.text }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>🔐 Acces pe proiecte — Execuție</div>
          <button onClick={onClose} disabled={salvez} style={{ ...S.btn, background: 'transparent', border: `1px solid ${G.border}`, color: G.muted }}>Închide</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, color: G.muted, lineHeight: 1.5, marginBottom: 14 }}>
            Un cont fără nicio bifă vede toate proiectele pe care i le dă modulul Execuție (ca până acum). Cu cel puțin o bifă, vede și scrie
            DOAR în proiectele bifate („doar citire” = vede, nu modifică). Dreptul pe modul (viewer / editor) nu se schimbă de aici.
            Atenție: raportul zilnic din telefon nu se mai deschide pe șantierele proiectelor nebifate, iar coada „de repartizat” a
            corespondenței nu se mai vede (e comună tuturor proiectelor).
          </div>
          {eroare && <div style={{ color: G.red, fontSize: 13, marginBottom: 12 }}>Eroare la încărcare: {eroare}</div>}
          {incarcare ? <div style={{ color: G.muted, fontSize: 13 }}>Se încarcă…</div> : (
            <>
              <select value={contSel} onChange={e => setContSel(e.target.value)} disabled={salvez} style={{ ...S.input, width: '100%', marginBottom: 12 }}>
                <option value="">— alege contul (conturile cu acces la Execuție) —</option>
                {conturi.map(c => (
                  <option key={c.profile_id} value={c.profile_id}>
                    {c.name}{c.email ? ` · ${c.email}` : ''} · modul {c.access_level}{nrPeCont.get(c.profile_id) ? ` · restrâns (${nrPeCont.get(c.profile_id)})` : ' · vede tot'}
                  </option>
                ))}
              </select>
              {contSel && (
                <>
                  <div style={{ fontSize: 13, marginBottom: 10, color: restrans ? G.yellow : G.green }}>
                    {restrans ? `Restrâns acum la ${vechi.length} proiecte.` : 'Nerestrâns acum: vede toate proiectele.'}
                    {contInfo?.access_level === 'viewer' && <span style={{ color: G.muted }}> · modulul e „viewer”: nu scrie nicăieri, oricum ar fi bifat.</span>}
                  </div>
                  <input placeholder="🔍 Caută proiect…" value={cauta} onChange={e => setCauta(e.target.value)} style={{ ...S.input, width: '100%', marginBottom: 8 }} />
                  <div style={{ maxHeight: 360, overflowY: 'auto', border: `1px solid ${G.border}`, borderRadius: 8 }}>
                    {proiecteFiltrate.map(p => {
                      const on = bife.has(p.id)
                      return (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: `1px solid ${G.border}`, background: on ? G.executie + '10' : 'transparent' }}>
                          <input type="checkbox" checked={on} disabled={salvez} onChange={e => bifeaza(p.id, e.target.checked)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: G.executie }}>{p.cod_intern || `#${p.id}`}</span>
                            <span style={{ fontSize: 12, color: p.activ === false ? G.dim : G.text, marginLeft: 8 }}>{(p.nume || '').slice(0, 80)}</span>
                            {p.activ === false && <span style={{ fontSize: 10, color: G.dim, marginLeft: 6 }}>(arhivat)</span>}
                          </div>
                          <select value={bife.get(p.id) || 'editor'} disabled={!on || salvez} onChange={e => nivel(p.id, e.target.value)}
                            style={{ ...S.input, padding: '4px 8px', fontSize: 12, opacity: on ? 1 : 0.4 }}>
                            <option value="editor">citire + scriere</option>
                            <option value="viewer">doar citire</option>
                          </select>
                        </div>
                      )
                    })}
                    {!proiecteFiltrate.length && <div style={{ padding: 12, fontSize: 12, color: G.muted }}>Niciun proiect.</div>}
                  </div>
                  {mesaj && <div style={{ fontSize: 13, marginTop: 10, color: mesaj.tip === 'ok' ? G.green : mesaj.tip === 'info' ? G.muted : G.red }}>{mesaj.text}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {restrans && (
                      <button onClick={scoateRestrictia} disabled={salvez}
                        style={{ ...S.btn, background: 'transparent', border: `1px solid ${G.orange}88`, color: G.orange }}>Scoate restricția (vede tot)</button>
                    )}
                    <button onClick={salveaza} disabled={salvez || dif.nimic || !nou || nou.length === 0}
                      style={{ ...S.btn, background: G.greenBg, color: '#fff', opacity: (salvez || dif.nimic || !nou || nou.length === 0) ? 0.5 : 1 }}>
                      {salvez ? 'Se salvează…' : `Salvează (${nou ? nou.length : 0} proiecte)`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
