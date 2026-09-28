// Teste fără rețea: interceptăm serverul, mediul și fetch înainte de orice request.
type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const serveOriginal = Deno.serve;
try {
  Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as unknown as typeof Deno.serve;
  await import('./index.ts');
} finally { Deno.serve = serveOriginal; }

function assert(ok: unknown, mesaj = 'Asserție eșuată'): asserts ok {
  if (!ok) throw new Error(mesaj);
}

async function probe(opts: {
  method?: string; secret?: string; body?: unknown; raw?: string;
  missing?: boolean; fail?: 'secret' | 'update' | 'insert';
} = {}) {
  const calls: { url: URL; method: string; body: Record<string, unknown> }[] = [];
  const fetchOriginal = globalThis.fetch, envOriginal = Deno.env.get;
  try {
    Deno.env.get = (key: string) => key === 'SUPABASE_URL' ? 'http://127.0.0.1:1' : 'fixture-service-role';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const body = JSON.parse(String(init?.body || '{}'));
      const method = init?.method || 'GET';
      calls.push({ url, method, body });
      let result: unknown;
      let failure = false;
      if (url.pathname === '/rest/v1/rpc/iot_secret_get') {
        assert(body.p_name === 'TERRA_TEMP_SECRET'); result = 'fixture-terra'; failure = opts.fail === 'secret';
      } else if (url.pathname === '/rest/v1/iot_dispozitive') {
        assert(method === 'PATCH', 'Nu se citește sau creează un alt dispozitiv');
        assert(url.searchParams.get('sursa') === 'eq.terra' && url.searchParams.get('extern_id') === 'eq.terra');
        assert(url.searchParams.get('select') === 'id');
        result = opts.missing ? null : { id: 42 }; failure = opts.fail === 'update';
      } else if (url.pathname === '/rest/v1/iot_citiri') {
        assert(method === 'POST' && body.dispozitiv_id === 42);
        result = null; failure = opts.fail === 'insert';
      } else throw new Error('Acces neașteptat: ' + url.pathname);
      return new Response(JSON.stringify(failure ? { message: 'fixture error' } : result), {
        status: failure ? 400 : 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const method = opts.method || 'POST';
    const headers: Record<string, string> = { Authorization: 'Bearer fixture-jwt', 'Content-Type': 'application/json' };
    if (opts.secret !== undefined) headers['x-terra-secret'] = opts.secret;
    const res = await handler(new Request('http://localhost/iot-terra', {
      method, headers, ...(method === 'GET' ? {} : { body: opts.raw ?? JSON.stringify(opts.body ?? { cpu: 51 }) }),
    }));
    return { status: res.status, body: await res.json(), calls };
  } finally { globalThis.fetch = fetchOriginal; Deno.env.get = envOriginal; }
}

Deno.test('endpoint: POST exclusiv, JWT nu înlocuiește secretul', async () => {
  const get = await probe({ method: 'GET' }); assert(get.status === 405 && get.calls.length === 0);
  const options = await probe({ method: 'OPTIONS' }); assert(options.status === 405);
  const lipsa = await probe(); assert(lipsa.status === 401 && lipsa.calls.length === 0);
  const gresit = await probe({ secret: 'gresit' }); assert(gresit.status === 401 && gresit.calls.length === 1);
});
Deno.test('endpoint: JSON/cheie invalidă nu scriu date', async () => {
  for (const opts of [{ raw: '{' }, { body: { extern_id: 'alt-dispozitiv' } }]) {
    const r = await probe({ secret: 'fixture-terra', ...opts }); assert(r.status === 400 && r.calls.length === 1);
  }
});
Deno.test('endpoint: scrie doar Terra, aceeași citire și oră în istoric', async () => {
  const r = await probe({ secret: 'fixture-terra', body: { discuri: [{ dev: '/dev/sda', temp: 46 }] } });
  assert(r.status === 200 && r.calls.length === 3);
  const ultima = r.calls[1].body, istoric = r.calls[2].body;
  assert(JSON.stringify(ultima.ultima_citire) === JSON.stringify(istoric.valori));
  assert(ultima.citit_la === istoric.la);
  assert((ultima.ultima_citire as Record<string, unknown>).disc_max === 46);
});
Deno.test('endpoint: dispozitiv absent și erori DB întorc JSON fără scrieri ulterioare', async () => {
  const lipsa = await probe({ secret: 'fixture-terra', missing: true }); assert(lipsa.status === 409 && lipsa.calls.length === 2);
  const secret = await probe({ secret: 'fixture-terra', fail: 'secret' }); assert(secret.status === 503 && secret.calls.length === 1);
  const update = await probe({ secret: 'fixture-terra', fail: 'update' }); assert(update.status === 500 && update.calls.length === 2);
  const insert = await probe({ secret: 'fixture-terra', fail: 'insert' }); assert(insert.status === 500 && insert.calls.length === 3);
  assert(insert.body.error.includes('istoricul'));
});
