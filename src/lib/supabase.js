import { createClient } from '@supabase/supabase-js'
import { instrumenteazaStorageRls } from './storageRls.js'
// fără sesiune, cererile către tabele nu pleacă (doar RPC-urile paginilor publice): src/lib/sesiuneCereri.js
import { optiuniClient } from './sesiuneCereri.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Lipsesc variabilele de mediu Supabase! Verifica fisierul .env')
}

export const supabase = instrumenteazaStorageRls(createClient(supabaseUrl, supabaseAnonKey, optiuniClient(supabaseAnonKey)))
