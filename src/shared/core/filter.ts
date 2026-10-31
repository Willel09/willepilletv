// "Remove BS" (Settings → Library): hides Arabic and Indian channels, movies and series.
// Matches on script, language/network words and provider country tags in the name or category.

/** Arabic and Indic scripts (Devanagari through Sinhala) */
const SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿऀ-෿]/
const WORDS = /\b(arab|arabic|arabia|arabe|arabi|khaleeji|hindi|hindu|india|indian|bollywood|tollywood|kollywood|mollywood|punjabi|tamil|telugu|malayalam|kannada|marathi|bengali|bangla|gujarati|bhojpuri|mbc|osn|rotana|shahid|zee|star plus|sony sab|colors tv)\b/i
/** Country tags at the start: "AR | ", "|IN| ", "KSA: ", "[EG] " */
const TAG = /^\s*[|[(]?\s*(AR|ARB|KSA|UAE|EG|IQ|SY|LB|JO|KW|QA|BH|OM|YE|SD|LY|DZ|MA|TN|PS|IN|IND|HI)\s*[|\]):-]/

export const isArabicOrIndian = (it: { name: string; group: string }) =>
  [it.name, it.group].some((s) => SCRIPT.test(s) || WORDS.test(s) || TAG.test(s))
