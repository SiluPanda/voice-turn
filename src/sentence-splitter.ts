// Known abbreviations that should not trigger sentence splits
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd',
  'dept', 'approx', 'fig', 'est', 'vol', 'no', 'pp', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'st', 'ave', 'blvd',
])

const MIN_SENTENCE_LENGTH = 10

/**
 * Split text into sentences on . ! ? followed by whitespace or end of string.
 * Preserves known abbreviations (e.g. "Dr. Smith" stays together).
 * Returns non-empty trimmed sentences of at least MIN_SENTENCE_LENGTH chars.
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return []

  const sentences: string[] = []
  // Regex: split on sentence-ending punctuation followed by whitespace or end
  // We use a lookahead to keep the punctuation with the sentence
  const raw = text.split(/(?<=[.!?])\s+/)

  let buffer = ''
  for (const chunk of raw) {
    const combined = buffer ? buffer + ' ' + chunk : chunk
    // Check if the last word before a period is an abbreviation
    const abbrevMatch = combined.match(/\b([A-Za-z]+)\.\s*$/)
    if (abbrevMatch && ABBREVIATIONS.has(abbrevMatch[1].toLowerCase())) {
      buffer = combined
      continue
    }
    buffer = ''
    const trimmed = combined.trim()
    if (trimmed.length >= MIN_SENTENCE_LENGTH) {
      sentences.push(trimmed)
    }
  }

  // Flush any remaining buffer
  if (buffer.trim().length >= MIN_SENTENCE_LENGTH) {
    sentences.push(buffer.trim())
  }

  return sentences
}
