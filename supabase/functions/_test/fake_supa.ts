// Client Supabase simulat pentru testele porții (doar teste, nu se deployează — nimic din producție nu-l importă).
// Numără: citiri pe tabele, scrieri (insert/update/upsert/delete/rpc non-verificare), apeluri storage, apeluri AI.
export type Tabele = Record<string, Record<string, unknown>[]>

export function fakeSupa(tabele: Tabele) {
  const n = { scrieri: 0, storage: 0, ai: 0, citiri: [] as string[] }
  const from = (t: string) => {
    let rows = [...(tabele[t] || [])]
    let scriere = false
    const b: any = {
      select: () => b, order: () => b, limit: () => b, like: () => b, not: () => b,
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => String(r[c]) === String(v)); return b },
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b },
      insert: () => { scriere = true; n.scrieri++; return b },
      update: () => { scriere = true; n.scrieri++; return b },
      upsert: () => { scriere = true; n.scrieri++; return b },
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
    rpc: (name: string) => {
      if (name === 'fn_verifica_radar_secret') return Promise.resolve({ data: false, error: null })
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
export const getUser = (jwt: string) => Promise.resolve(jwt === 'invalid' ? null : jwt)
export const cerere = (uid: string, body: unknown) => new Request('http://x/', {
  method: 'POST', headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
