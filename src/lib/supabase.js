import { createClient } from '@supabase/supabase-js'
import { instrumenteazaStorageRls } from './storageRls.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Lipsesc variabilele de mediu Supabase! Verifica fisierul .env')
}

export const supabase = instrumenteazaStorageRls(createClient(supabaseUrl, supabaseAnonKey))
