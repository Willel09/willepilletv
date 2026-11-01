// "Remove BS" (Settings → Library): hides Arabic and Indian channels, movies and series.
// Matches on script, language/network words and provider country tags in the name or category.

/** Arabic and Indic scripts (Devanagari through Sinhala) */
const SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿऀ-෿]/
const WORDS = /\b(arab|arabic|arabia|arabe|arabi|khaleeji|hindi|hindu|india|indian|bollywood|tollywood|kollywood|mollywood|punjabi|tamil|telugu|malayalam|kannada|marathi|bengali|bangla|gujarati|bhojpuri|mbc|osn|rotana|shahid|zee|star plus|sony sab|colors tv)\b/i
/** Country tags at the start: "AR | ", "|IN| ", "KSA: ", "[EG] " */
const TAG = /^\s*[|[(]?\s*(AR|ARB|KSA|UAE|EG|IQ|SY|LB|JO|KW|QA|BH|OM|YE|SD|LY|DZ|MA|TN|PS|IN|IND|HI)\s*[|\]):-]/

const bs = (s: string) => SCRIPT.test(s) || WORDS.test(s) || TAG.test(s)
export const isArabicOrIndian = (it: { name: string; group: string }) => bs(it.name) || bs(it.group)

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Settings → Library filters (hidden category words + Remove BS) as one test, or null if nothing is hidden.
 * Category results are cached: there are a few hundred categories but hundreds of thousands of titles.
 */
export function hiddenFilter(s: { hiddenGroups: string; removeBs?: boolean }): ((x: { name: string; group: string }) => boolean) | null {
  const words = s.hiddenGroups.split(',').map((w) => fold(w.trim())).filter(Boolean)
  if (!words.length && !s.removeBs) return null
  const groups = new Map<string, boolean>()
  const groupHidden = (g: string) => {
    let h = groups.get(g)
    if (h === undefined) groups.set(g, (h = words.some((w) => fold(g).includes(w)) || (!!s.removeBs && bs(g))))
    return h
  }
  return (x) => groupHidden(x.group) || (!!s.removeBs && bs(x.name))
}
