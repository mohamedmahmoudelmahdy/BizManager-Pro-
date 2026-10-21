const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const TATWEEL = /\u0640/g;

/** Normalize text for case-insensitive, partial Arabic/English search. */
export function normalizeSearchText(input: string): string {
  let text = input.trim().normalize('NFKD');
  text = text.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '');
  text = text
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  text = text.toLowerCase().replace(/\s+/g, ' ');
  return text;
}

export function matchesSearchText(haystack: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const normalizedHaystack = normalizeSearchText(haystack);
  const normalizedQuery = normalizeSearchText(trimmed);
  if (normalizedHaystack.includes(normalizedQuery)) return true;

  const queryDigits = trimmed.replace(/\D/g, '');
  if (queryDigits.length >= 2) {
    const haystackDigits = haystack.replace(/\D/g, '');
    if (haystackDigits.includes(queryDigits)) return true;
  }

  return false;
}

export function buildSearchableText(
  ...parts: Array<string | undefined | null>
): string {
  return parts.filter((part) => part && part.trim()).join(' ');
}
