// Căutarea din Registru (id parcelă / nume) — O SINGURĂ regulă pentru ambele căi (L19, r3 Jakarinos #984):
//   • calea SQL (pagina normală): PostgREST `or=(id_parcela.ilike.%t%,nume.ilike.%t%)`;
//   • calea locală (filtrul SMS activ + CSV „Lista SMS”): subșir fără diferență de majuscule.
// Ca ILIKE să însemne exact „conține termenul, literal”, termenul se curăță de tot ce ar fi wildcard sau sintaxă PostgREST:
//   % și _ (wildcard ILIKE), * (PostgREST îl traduce în %), \ (escape ILIKE), " , ( ) (sintaxa listei or=) → spațiu, apoi trim.
// Înainte (doar % , ( ) curățate) „_” / „*” / „\” lucrau ca wildcard pe calea SQL — neintenționat (nu există altă căutare în Registru).
export function curataCautare(t) {
  return String(t ?? '').replace(/[%_*\\",()]/g, ' ').trim()
}

// Filtrul pentru supabase-js `.or(...)`; null = fără căutare
export function filtruCautareSql(t) {
  const c = curataCautare(t)
  return c ? `id_parcela.ilike.%${c}%,nume.ilike.%${c}%` : null
}

// Aceeași regulă, local
export function potrivesteCautare(rand, t) {
  const c = curataCautare(t).toLowerCase()
  if (!c) return true
  return String(rand?.id_parcela ?? '').toLowerCase().includes(c) || String(rand?.nume ?? '').toLowerCase().includes(c)
}
