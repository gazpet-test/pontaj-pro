// diurneOrdin.js — câte zile intră pe ordinul de deplasare generat dintr-o plată (openOrdGen).
// Decizia Răzvan 01.10.2026 (3A): min(zileDiurna din alocaDiurneTransa, zile NET de pe ordin) —
// aceeași alocare ca la export, plată și BT (scade CO, numără weekendul, împarte tranșele lunii).
export function zileOrdinDeplasare(alocareEmp, netDaysCount) {
  const z = Number(alocareEmp?.zileDiurna) || 0
  return Math.max(0, Math.min(z, Number(netDaysCount) || 0))
}
