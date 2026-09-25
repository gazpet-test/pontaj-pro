// Client Supabase simulat pentru testele porții (doar teste, nu se deployează — nimic din producție nu-l importă).
// Numără: citiri pe tabele, scrieri (insert/update/upsert/delete/rpc non-verificare), apeluri storage, apeluri AI.
export type Tabele = Record<string, Record<string, unknown>[]>

// radarSecret: emulează fn_verifica_radar_secret — undefined = secretul NU există în vault (=> false mereu).
export function fakeSupa(tabele: Tabele, opt: { radarSecret?: string } = {}) {
  // upsertate: payload-urile trimise la upsert, pe tabel (ca testele să verifice CE s-ar scrie, ex. tip_sursa)
  const n = { scrieri: 0, storage: 0, ai: 0, rpcSecret: 0, citiri: [] as string[], upsertate: [] as { tabel: string; rows: any[] }[] }
  const from = (t: string) => {
    let rows = [...(tabele[t] || [])]
    let scriere = false
    const b: any = {
      select: () => b, order: () => b, limit: () => b, like: () => b, not: () => b,
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => String(r[c]) === String(v)); return b },
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b },
      insert: () => { scriere = true; n.scrieri++; return b },
      update: () => { scriere = true; n.scrieri++; return b },
      upsert: (r: unknown) => { scriere = true; n.scrieri++; n.upsertate.push({ tabel: t, rows: Array.isArray(r) ? r : [r] }); return b },
      delete: () => { scriere = true; n.scrieri++; return b },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } }),
      then: (ok: any, ko: any) => Promise.resolve({ data: scriere ? [] : rows, error: null }).then(ok, ko),
    }
    n.citiri.push(t)
    return b
  }
  const supa = {
    from,
    rpc: (name: string, args?: { p_secret?: string | null }) => {
      if (name === 'fn_verifica_radar_secret') {
        n.rpcSecret++
        const s = opt.radarSecret, p = args?.p_secret ?? ''
        return Promise.resolve({ data: s !== undefined && p.length === s.length && p === s, error: null })
      }
      n.scrieri++
      return Promise.resolve({ data: null, error: null })
    },
    storage: {
      from: () => ({
        list: () => { n.storage++; return Promise.resolve({ data: [], error: null }) },
        download: () => { n.storage++; return Promise.resolve({ data: null, error: { message: 'fake' } }) },
      }),
    },
  }
  return { supa, n }
}

// fetch AI simulat: numără apelurile și întoarce un răspuns OpenAI Responses minimal cu o poziție.
export function fakeFetch(n: { ai: number }): typeof fetch {
  return ((_u: unknown, _i?: unknown) => {
    n.ai++
    const corp = { output_text: '{"p":[["Obiect 1",null,"Conducta PE Dn110","m",120,"C6 poz.1",0]]}',
      usage: { input_tokens: 100, output_tokens: 20 }, status: 'completed',
      content: [{ type: 'text', text: '{}' }] }
    return Promise.resolve(new Response(JSON.stringify(corp), { status: 200 }))
  }) as typeof fetch
}

export const OWNER = 'u-owner', RESP = 'u-resp95', STRAIN = 'u-strain', RESP_ALTA = 'u-resp96'
export const PROFILE = [
  { id: OWNER, is_owner: true }, { id: RESP, is_owner: false }, { id: STRAIN, is_owner: false }, { id: RESP_ALTA, is_owner: false },
]
export const LICITATII = [{ id: 95, responsabil_id: RESP }, { id: 96, responsabil_id: RESP_ALTA }, { id: 97, responsabil_id: null }]
// token = uid (getUser simulat); 'invalid' => null
// Orice token în formă JWT (cu puncte) e tratat ca nevalidat de Auth => null, ca în producție pt semnătură falsă.
export const getUser = (jwt: string) => Promise.resolve(jwt === 'invalid' || jwt.includes('.') ? null : jwt)
export const cerere = (uid: string, body: unknown) => new Request('http://x/', {
  method: 'POST', headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
// cerere cu antete arbitrare (fără Authorization implicit)
export const cerereH = (headers: Record<string, string>, body: unknown) => new Request('http://x/', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
})
// JWT nesemnat care PRETINDE role=service_role — getUser real l-ar respinge (semnătură invalidă).
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
export const JWT_FALS_SERVICE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', iss: 'supabase' })}.semnatura-falsa`
