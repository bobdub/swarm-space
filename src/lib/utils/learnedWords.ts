export interface LearnedWordEntry {
  word: string;
  learnedAt: number;
  lastUsedAt: number | null;
  usageCount: number;
}

export interface LearnWordOptions {
  learnedAt?: number;
}

interface InternalWordEntry extends LearnedWordEntry {
  normalized: string;
}

const normalizeWord = (word: string): string => word.trim().toLowerCase();

const createEntrySnapshot = (entry: InternalWordEntry): LearnedWordEntry => ({
  word: entry.word,
  learnedAt: entry.learnedAt,
  lastUsedAt: entry.lastUsedAt,
  usageCount: entry.usageCount,
});

export class LearnedWordRegistry {
  private readonly entries = new Map<string, InternalWordEntry>();

  constructor(initialWords: Array<string | { word: string; learnedAt?: number }> = []) {
    for (const item of initialWords) {
      if (typeof item === 'string') {
        this.learn(item);
      } else {
        this.learn(item.word, { learnedAt: item.learnedAt });
      }
    }
  }

  learn(word: string, options: LearnWordOptions = {}): LearnedWordEntry {
    const normalized = normalizeWord(word);
    if (!normalized) {
      throw new Error('Cannot learn an empty word');
    }

    const existing = this.entries.get(normalized);
    if (existing) {
      existing.word = word;
      if (options.learnedAt !== undefined) {
        existing.learnedAt = options.learnedAt;
      }
      return createEntrySnapshot(existing);
    }

    const entry: InternalWordEntry = {
      normalized,
      word,
      learnedAt: options.learnedAt ?? Date.now(),
      lastUsedAt: null,
      usageCount: 0,
    };

    this.entries.set(normalized, entry);
    return createEntrySnapshot(entry);
  }

  has(word: string): boolean {
    const normalized = normalizeWord(word);
    if (!normalized) {
      return false;
    }
    return this.entries.has(normalized);
  }

  respond(word: string, timestamp = Date.now()): string | null {
    const normalized = normalizeWord(word);
    if (!normalized) {
      return null;
    }

    const entry = this.entries.get(normalized);
    if (!entry) {
      return null;
    }

    entry.lastUsedAt = timestamp;
    entry.usageCount += 1;
    return entry.word;
  }

  recall(word: string): LearnedWordEntry | null {
    const normalized = normalizeWord(word);
    if (!normalized) {
      return null;
    }

    const entry = this.entries.get(normalized);
    return entry ? createEntrySnapshot(entry) : null;
  }

  list(): LearnedWordEntry[] {
    return [...this.entries.values()]
      .map((entry) => createEntrySnapshot(entry))
      .sort((a, b) => a.learnedAt - b.learnedAt);
  }

  forget(word: string): boolean {
    const normalized = normalizeWord(word);
    if (!normalized) {
      return false;
    }

    return this.entries.delete(normalized);
  }
}
