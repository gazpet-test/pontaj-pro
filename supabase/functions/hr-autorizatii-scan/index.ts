// Leaga scanurile de autorizatii care au ajuns din greseala in documentele personale.
//
// Importul din Drive a adus fisiere care sunt de fapt autorizatii profesionale (macaragiu,
// stivuitorist, legator de sarcina). Ele au modul propriu — hr_autorizatii — unde exista deja
// inregistrarile, dar fara scan: 13 macaragii inregistrati, niciunul cu document atasat.
//
// Potrivirea NU e unu-la-unu: un macaragiu are in medie patru fisiere si o singura autorizatie.
// Tiparul, verificat pe dosarele reale, e asta:
//   „AUTORIZATIE MACARAGIU - NUME - 2026.pdf"  (~390 KB, 2 pagini) = autorizatia ISCIR + talonul
//                                                                    de vize anuale — ASTA se ataseaza
//   „AUTORIZARE MACARAGIU - NUME (1).pdf"      (~210 KB, 1 pagina) = acelasi card, scanat separat
//   „... (2).pdf"                              (~560 KB)           = certificatul de calificare
//   „... (3).pdf"                              (~695 KB, 2 pagini) = suplimentul descriptiv
// Numele nu spune nimic din toate astea, deci functia NU decide singura: `lista` si `linkuri`
// scot documentele cu link-uri semnate ca sa fie privite, iar `ataseaza` leaga exact ce i se spune.
//
// De ce conteaza sa nu ghicim: pe hr_autorizatii ruleaza alertele de expirare. O autorizatie cu
// scanul gresit arata in regula si nu mai atrage atentia nimanui.
//
// AUTENTIFICARE: deocamdata un antet propriu, fiindca SEAP_IMPORT_SECRET nu exista in secretele
// Supabase (e doar in Vercel). Cand se adauga acolo, se sterge PAROLA si ramane doar verificarea
// pe Deno.env — vezi claude_context id 955.
import { createClient } from 'npm:@supabase/supabase-js@2';

const PAROLA = 'hr-aut-2026-08-30-Rt7pNc3Xw';
const SURSA = 'documente-personal';
const TINTA = 'autorizatii';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-hr-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Ce cuvant din numele fisierului trimite spre ce tip de autorizatie.
const POTRIVIRI: [RegExp, string][] = [
  [/MACARAGIU/i, 'MACARAGIU'],
  [/STIVUITOR/i, 'STIVUITORIST'],
  [/LEGATOR/i, 'LEGATOR_SARCINA'],
  [/RSVTI/i, 'RSVTI'],
  [/BULDOEXCAVATOR/i, 'BULDOEXCAVATORIST'],
  [/EXCAVATOR/i, 'EXCAVATORIST'],
  [/EXAMINARE VIZUALA/i, 'EXAMINARE_VIZUALA'],
  [/OPERATOR SUDARE|SUDARE TEVI/i, 'OPERATOR_SUDARE_PEHD'],
  [/ELECTRICIAN/i, 'ELECTRICIAN'],
];

const faraDiacritice = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const dinEnv = Deno.env.get('SEAP_IMPORT_SECRET');
  const antet = req.headers.get('x-hr-secret') || '';
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (jwt !== SERVICE && antet !== PAROLA && !(dinEnv && antet === dinEnv)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const supa = createClient(SUPA_URL, SERVICE);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const actiune = body?.actiune || 'lista';

  // ─────────── link-uri semnate pentru documente anume ───────────
  // `lista` se uita doar la neclasificate; multe autorizatii sunt insa clasificate deja, si tot
  // trebuie privite. Aici se cer pe id, oricare ar fi tipul lor.
  if (actiune === 'linkuri') {
    const ids: number[] = (Array.isArray(body?.doc_ids) ? body.doc_ids : []).map(Number).filter(Boolean);
    if (!ids.length) return json({ error: 'niciun doc_id' }, 400);
    const { data: docs, error } = await supa.from('hr_documente_personale')
      .select('id, employee_id, fisier_nume, fisier_path, fisier_mime, fisier_size_bytes, employees(name)')
      .in('id', ids).is('deleted_at', null);
    if (error) return json({ error: error.message }, 500);
    const out = [];
    for (const d of docs || []) {
      const { data: semnat } = await supa.storage.from(SURSA).createSignedUrl(d.fisier_path, 3600);
      out.push({
        doc_id: d.id, angajat: (d as any).employees?.name, employee_id: d.employee_id,
        fisier: d.fisier_nume, kb: Math.round((d.fisier_size_bytes || 0) / 1024),
        link: semnat?.signedUrl || null,
      });
    }
    out.sort((a, b) => (a.angajat || '').localeCompare(b.angajat || '') || a.fisier.localeCompare(b.fisier));
    return json({ gasite: out.length, cerute: ids.length, lista: out });
  }

  const { data: tipNec } = await supa.from('hr_documente_personale_tipuri')
    .select('id').eq('cod', 'neclasificat').single();

  // ─────────── lista candidatilor, cu link-uri de privit ───────────
  if (actiune === 'lista') {
    const { data: docs, error } = await supa.from('hr_documente_personale')
      .select('id, employee_id, fisier_nume, fisier_path, fisier_mime, fisier_size_bytes, employees(name)')
      .is('deleted_at', null).eq('tip_id', tipNec!.id);
    if (error) return json({ error: error.message }, 500);

    const { data: tipuri } = await supa.from('hr_autorizatii_tipuri').select('id, cod, denumire');
    const { data: autorizatii } = await supa.from('hr_autorizatii')
      .select('id, employee_id, tip_id, numar_autorizatie, data_emitere, data_expirare, fisier_path')
      .is('deleted_at', null);

    const out: any[] = [];
    for (const d of docs || []) {
      const nume = faraDiacritice(d.fisier_nume || '');
      const gasit = POTRIVIRI.find(([re]) => re.test(nume));
      if (!gasit) continue;
      const tip = (tipuri || []).find((t: any) => t.cod === gasit[1]);
      if (!tip) continue;

      const { data: semnat } = await supa.storage.from(SURSA).createSignedUrl(d.fisier_path, 3600);

      out.push({
        doc_id: d.id,
        angajat: (d as any).employees?.name,
        employee_id: d.employee_id,
        fisier: d.fisier_nume,
        mime: d.fisier_mime,
        kb: Math.round((d.fisier_size_bytes || 0) / 1024),
        tip_autorizatie: tip.cod,
        link: semnat?.signedUrl || null,
        autorizatii_ale_omului: (autorizatii || [])
          .filter((a: any) => a.employee_id === d.employee_id && a.tip_id === tip.id)
          .map((a: any) => ({ aut_id: a.id, numar: a.numar_autorizatie, emitere: a.data_emitere, expirare: a.data_expirare, are_scan: !!a.fisier_path })),
      });
    }
    out.sort((a, b) => (a.angajat || '').localeCompare(b.angajat || '') || a.fisier.localeCompare(b.fisier));
    return json({ candidati: out.length, lista: out });
  }

  // ─────────── ataseaza un fisier anume la o autorizatie anume ───────────
  if (actiune === 'ataseaza') {
    const perechi: any[] = Array.isArray(body?.perechi) ? body.perechi : [];
    if (!perechi.length) return json({ error: 'nicio pereche doc_id/aut_id' }, 400);

    const raport: any[] = [];
    for (const p of perechi) {
      try {
        const { data: d } = await supa.from('hr_documente_personale')
          .select('id, employee_id, fisier_path, fisier_nume, fisier_mime, fisier_size_bytes')
          .eq('id', Number(p.doc_id)).is('deleted_at', null).single();
        if (!d) throw new Error('documentul nu exista sau e sters');

        const { data: a } = await supa.from('hr_autorizatii')
          .select('id, employee_id, fisier_path, numar_autorizatie, data_emitere, data_expirare, emitent, subcategorie')
          .eq('id', Number(p.aut_id)).is('deleted_at', null).single();
        if (!a) throw new Error('autorizatia nu exista');
        if (a.employee_id !== d.employee_id) throw new Error('documentul si autorizatia sunt ale unor oameni diferiti');
        if (a.fisier_path && !p.suprascrie) throw new Error('autorizatia are deja scan (trimite suprascrie:true daca chiar vrei)');

        const { data: bin, error: eDl } = await supa.storage.from(SURSA).download(d.fisier_path);
        if (eDl || !bin) throw new Error(`descarcare: ${eDl?.message || 'esuata'}`);
        const buf = new Uint8Array(await bin.arrayBuffer());

        const ext = (d.fisier_nume || '').includes('.') ? d.fisier_nume.split('.').pop()!.toLowerCase() : 'pdf';
        const cale = `${d.employee_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: eUp } = await supa.storage.from(TINTA)
          .upload(cale, buf, { contentType: d.fisier_mime || 'application/pdf', upsert: false });
        if (eUp) throw new Error(`urcare: ${eUp.message}`);

        // Numarul si datele citite de pe scan se completeaza DOAR unde baza n-are nimic.
        // Ce a scris omul ramane cum e — daca difera de document, se vede in `completate` si
        // se lamureste separat, nu prin suprascriere tacuta.
        const patch: Record<string, unknown> = {
          fisier_path: cale, fisier_nume: d.fisier_nume,
          fisier_size_bytes: buf.length, fisier_mime: d.fisier_mime,
          modificat_la: new Date().toISOString(),
        };
        const completate: string[] = [];
        const sarite: string[] = [];
        for (const camp of ['numar_autorizatie', 'data_emitere', 'data_expirare', 'emitent', 'subcategorie']) {
          if (!p[camp]) continue;
          const acum = (a as any)[camp];
          if (acum === null || acum === undefined || acum === '') { patch[camp] = p[camp]; completate.push(camp); }
          else if (String(acum) !== String(p[camp])) sarite.push(`${camp}: in baza „${acum}", pe document „${p[camp]}"`);
        }
        const { error: eAut } = await supa.from('hr_autorizatii').update(patch).eq('id', a.id);
        if (eAut) throw new Error(`update autorizatie: ${eAut.message}`);

        // Documentul personal se retrage, dar nu se sterge: ramane recuperabil.
        await supa.from('hr_documente_personale').update({
          deleted_at: new Date().toISOString(),
          observatii: `Mutat la Autorizatii (id ${a.id}) pe ${new Date().toISOString().slice(0, 10)} — e autorizatie profesionala, nu document personal.`,
        }).eq('id', d.id);

        raport.push({ doc_id: d.id, aut_id: a.id, cale_noua: cale, completate, nepotriviri: sarite, ok: true });
      } catch (e) {
        raport.push({ doc_id: p.doc_id, aut_id: p.aut_id, eroare: String((e as Error)?.message || e).slice(0, 160) });
      }
    }
    return json({ atasate: raport.filter((r) => r.ok).length, esuate: raport.filter((r) => r.eroare).length, raport });
  }

  return json({ error: `actiune necunoscuta: ${actiune}` }, 400);
});
