// Characters sung as part of the beat before them: small kana, the sokuon and the long vowel
// mark rarely get a note of their own.
const ATTACHING_RE = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶーゝゞヽヾ]/u

/**
 * Cuts a kana reading into the beats (morae) it is sung in: こころ into こ・こ・ろ, しょうねん
 * into しょ・う・ね・ん, with small kana, っ and ー kept with the beat before.
 */
export function splitMorae(reading: string): string[] {
  const morae: string[] = []
  for (const char of reading) {
    if (morae.length > 0 && ATTACHING_RE.test(char)) {
      morae[morae.length - 1] += char
    }
    else {
      morae.push(char)
    }
  }
  return morae
}
