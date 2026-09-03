import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

interface PublishRequest {
  pozitie_id: number;
  titlu: string;
  descriere: string;
  category_id: string;
  city_id: string;
  contact_name: string;
  contact_phone: string;
}

// Fetch app secrets (OLX credentials)
async function getSecret(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_secrets')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value || Deno.env.get(key) || null;
}

// Get and refresh OLX tokens
async function getOlxTokens() {
  const { data } = await supabase
    .from('olx_tokens')
    .select('*')
    .single();

  if (!data) return null;

  // Check if expired
  if (new Date(data.expires_at) < new Date()) {
    const clientId = await getSecret('OLX_CLIENT_ID');
    const clientSecret = await getSecret('OLX_CLIENT_SECRET');

    const refreshRes = await fetch('https://open.olx.pl/api/open/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.refresh_token,
      }),
    });

    const refreshData = await refreshRes.json();
    if (!refreshData.access_token) return null;

    const expiresAt = new Date(Date.now() + refreshData.expires_in * 1000);
    await supabase
      .from('olx_tokens')
      .update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        expires_at: expiresAt.toISOString(),
      })
      .eq('id', data.id);

    return {
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
    };
  }

  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

// Action: status — check if connected
async function actionStatus() {
  const tokens = await getOlxTokens();
  if (!tokens?.access_token) return { ok: false, eroare: 'Nu e conectat la OLX' };

  try {
    const res = await fetch('https://open.olx.pl/api/open/user', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const user = await res.json();
    return { ok: true, conectat: true, cont: user };
  } catch (e) {
    return { ok: false, conectat: false, eroare: e.message };
  }
}

// Action: connect-url — OAuth authorize URL
async function actionConnectUrl() {
  const clientId = await getSecret('OLX_CLIENT_ID');
  if (!clientId) return { eroare: 'OLX_CLIENT_ID nu-i configurat în Supabase secrets' };

  const url = `https://open.olx.pl/api/open/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=https://dxczwkbciseqniprspcu.supabase.co/functions/v1/olx-api`;
  return { ok: true, url };
}

// Action: publica — publish new advert (WITHOUT external_url to avoid OLX validation error)
async function actionPublica(req: PublishRequest) {
  const tokens = await getOlxTokens();
  if (!tokens?.access_token) return { ok: false, eroare: 'Nu e conectat la OLX' };

  // Build payload WITHOUT external_url — OLX categoria 1497 nu acceptă asta
  const payload = {
    category: { id: parseInt(req.category_id) },
    title: req.titlu,
    description: req.descriere,
    location: { city: { id: parseInt(req.city_id) } },
    contact: {
      name: req.contact_name,
      phone: req.contact_phone,
    },
  };

  try {
    const res = await fetch('https://open.olx.pl/api/open/adverts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        eroare: data.error?.message || `OLX API: ${res.status}`,
        detalii: data,
      };
    }

    // Store in database
    if (data.id) {
      await supabase
        .from('hr_recrutare_pozitii')
        .update({
          olx_advert_id: data.id,
          olx_url: data.url,
          olx_status: data.status,
          olx_publicat_la: new Date().toISOString(),
        })
        .eq('id', req.pozitie_id);
    }

    return { ok: true, advert: data };
  } catch (e) {
    return { ok: false, eroare: e.message };
  }
}

serve(async (req) => {
  try {
    const body = await req.json();
    const { actiune } = body;

    let result: any;

    switch (actiune) {
      case 'status':
        result = await actionStatus();
        break;
      case 'connect-url':
        result = await actionConnectUrl();
        break;
      case 'publica':
        result = await actionPublica(body);
        break;
      default:
        result = { eroare: `Actiune necunoscută: ${actiune}` };
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ eroare: e.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
