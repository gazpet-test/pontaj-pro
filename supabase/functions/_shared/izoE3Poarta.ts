import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { atribuireValidaE3, EroareE3 } from '../ocr-packing-list/avizE3.ts'

// Numai clientul construit cu JWT-ul apelantului. Nicio citire cu service_role.
export async function utilizatorE3(req: Request, caller: SupabaseClient): Promise<string> {
  if (!req.headers.get('Authorization')?.startsWith('Bearer ')) throw new EroareE3('fara_drept', 403)
  const { data, error } = await caller.auth.getUser()
  if (error || !data?.user) throw new EroareE3('fara_drept', 403)
  return data.user.id
}

export async function verificaPoartaE3(caller: SupabaseClient, user: string, proiect: number, depozit: number) {
  const { data: profile, error: pe } = await caller.from('profiles').select('is_owner').eq('id', user).maybeSingle()
  if (pe || !profile) throw new EroareE3('fara_drept', 403)
  if (profile.is_owner === true) return
  const { data: acces, error: ae } = await caller.from('user_module_access').select('access_level').eq('profile_id', user).eq('module', 'magazie').in('access_level', ['editor', 'admin']).limit(1)
  if (ae || !acces?.length) throw new EroareE3('fara_drept', 403)
  const { data: atribuiri, error: ie } = await caller.from('izo_atribuiri').select('proiect_id,depozit_id,rol,activ,valabil_de,valabil_pana').eq('profile_id', user).eq('proiect_id', proiect).eq('depozit_id', depozit).eq('rol', 'gestionar').eq('activ', true)
  const azi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (ie || !atribuiri?.some(a => atribuireValidaE3(a, proiect, depozit, azi))) throw new EroareE3('fara_drept', 403)
}
