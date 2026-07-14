// Normalizare diacritice pentru cautare: "Onesti" cu s-sedila, cu s-virgula sau fara
// diacritice devin identice. NFD desparte litera de semnul diacritic, apoi il scoatem.
// Context: contract dublat pe 14.07.2026 pentru ca search-ul nu gasea varianta cu sedila.
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
