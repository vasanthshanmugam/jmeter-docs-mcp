const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i",
  "if", "in", "into", "is", "it", "its", "jmeter", "my", "of", "on", "or", "so", "that", "the",
  "this", "to", "use", "using", "what", "when", "where", "which", "with", "you",
]);

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 4;
const BREADCRUMB_WEIGHT = 2;

export interface SearchableDoc {
  title: string;
  breadcrumbs: string[];
  body: string;
}

export interface SearchHit<T> {
  doc: T;
  score: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

/** A deliberately light stemmer: enough to match "timers"/"timer" and "extracting"/"extract". */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

interface IndexedDoc<T> {
  doc: T;
  terms: Map<string, number>;
  length: number;
  titleNormalized: string;
}

export class SearchIndex<T extends SearchableDoc> {
  private readonly docs: IndexedDoc<T>[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private averageLength = 0;

  constructor(docs: readonly T[]) {
    let totalLength = 0;
    for (const doc of docs) {
      const terms = new Map<string, number>();
      const add = (text: string, weight: number) => {
        for (const token of tokenize(text)) {
          terms.set(token, (terms.get(token) ?? 0) + weight);
        }
      };
      add(doc.title, TITLE_WEIGHT);
      add(doc.breadcrumbs.join(" "), BREADCRUMB_WEIGHT);
      add(doc.body, 1);

      let length = 0;
      for (const [term, count] of terms) {
        length += count;
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      totalLength += length;
      this.docs.push({ doc, terms, length, titleNormalized: normalizeTitle(doc.title) });
    }
    this.averageLength = this.docs.length > 0 ? totalLength / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  idf(term: string): number {
    const frequency = this.documentFrequency.get(term) ?? 0;
    return Math.log(1 + (this.docs.length - frequency + 0.5) / (frequency + 0.5));
  }

  search(query: string, limit = 5, filter?: (doc: T) => boolean): SearchHit<T>[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0) {
      return [];
    }
    const queryTitle = normalizeTitle(query);
    const hits: SearchHit<T>[] = [];

    for (const entry of this.docs) {
      if (filter && !filter(entry.doc)) {
        continue;
      }
      let score = 0;
      let matched = 0;
      for (const term of queryTerms) {
        const frequency = entry.terms.get(term);
        if (!frequency) {
          continue;
        }
        matched += 1;
        const normalized = frequency * (K1 + 1) / (frequency + K1 * (1 - B + (B * entry.length) / this.averageLength));
        score += this.idf(term) * normalized;
      }
      if (score === 0) {
        continue;
      }
      // Reward documents that cover more of the query, and exact title matches.
      score *= 0.5 + (0.5 * matched) / queryTerms.length;
      if (queryTitle && entry.titleNormalized === queryTitle) {
        score *= 2;
      } else if (queryTitle.length > 3 && entry.titleNormalized.includes(queryTitle)) {
        score *= 1.4;
      }
      hits.push({ doc: entry.doc, score });
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }
}

export function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Picks the passage of `body` that best covers the query terms, so search results show
 * the relevant part of long reference sections instead of their opening lines.
 */
export function bestExcerpt(body: string, query: string, maxChars = 600): string {
  const text = body.replace(/^#{1,6} .*$/gm, "").replace(/\n{2,}/g, "\n").trim();
  if (text.length <= maxChars) {
    return text;
  }
  const terms = [...new Set(tokenize(query))];
  const lower = text.toLowerCase();
  const window = maxChars;
  const step = Math.max(50, Math.floor(window / 4));

  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < text.length; start += step) {
    const slice = lower.slice(start, start + window);
    let score = 0;
    for (const term of terms) {
      if (slice.includes(term)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
    if (start + window >= text.length) {
      break;
    }
  }

  let start = bestStart;
  if (start > 0) {
    const lineBreak = text.lastIndexOf("\n", start);
    start = lineBreak >= 0 && start - lineBreak < 120 ? lineBreak + 1 : start;
  }
  const excerpt = text.slice(start, start + window).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${start + window < text.length ? "…" : ""}`;
}
