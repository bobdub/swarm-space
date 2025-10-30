export type ContentType = 'post' | 'comment' | 'message' | 'profile';

export interface ScoreTrigger {
  type:
    | 'keyword'
    | 'link-density'
    | 'uppercase-ratio'
    | 'repetition'
    | 'metadata'
    | 'length'
    | 'structure';
  description: string;
  weight: number;
}

export interface ContentScore {
  riskScore: number;
  severity: 'low' | 'medium' | 'high';
  triggers: ScoreTrigger[];
}

export interface ContentScoreContext {
  content: string;
  contentType?: ContentType;
  userReputation?: number; // 0 - 1
  accountAgeMs?: number;
  priorFlagCount?: number;
  linkOverride?: number;
  attachmentCount?: number;
}

const KEYWORD_RULES: Array<{ pattern: RegExp; weight: number; description: string }> = [
  { pattern: /free\s+money/i, weight: 0.3, description: 'Mentions "free money"' },
  { pattern: /crypto\s+giveaway/i, weight: 0.35, description: 'References a crypto giveaway' },
  { pattern: /limited\s+time\s+offer/i, weight: 0.25, description: 'Aggressive urgency language' },
  { pattern: /click\s+here/i, weight: 0.25, description: 'Contains "click here"' },
  { pattern: /visit\s+(?:this\s+)?link/i, weight: 0.2, description: 'Directive to visit a link' },
  { pattern: /earn\s+\${2,}/i, weight: 0.2, description: 'Promises significant cash earnings' },
  { pattern: /100%\s+free/i, weight: 0.2, description: 'Guarantees fully free product' }
];

const REPETITIVE_PATTERN = /(.)\1{6,}/;
const WORD_REPETITION_THRESHOLD = 5;
const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

export function scoreContent(content: string, context: ContentScoreContext): ContentScore {
  const triggers: ScoreTrigger[] = [];
  let score = 0;

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(content)) {
      score += rule.weight;
      triggers.push({ type: 'keyword', description: rule.description, weight: rule.weight });
    }
  }

  const linkCount = context.linkOverride ?? (content.match(URL_PATTERN)?.length ?? 0);
  if (linkCount >= 2) {
    const weight = 0.2 + Math.max(0, linkCount - 2) * 0.05;
    score += weight;
    triggers.push({
      type: 'link-density',
      description: `Contains ${linkCount} external links`,
      weight
    });
  } else if (linkCount === 1 && content.length < 32) {
    const weight = 0.15;
    score += weight;
    triggers.push({
      type: 'link-density',
      description: 'Single link dominates short message',
      weight
    });
  }

  const cleaned = content.replace(/[^A-Za-z]/g, '');
  if (cleaned.length > 0) {
    const uppercaseCount = cleaned.replace(/[a-z]/g, '').length;
    const ratio = uppercaseCount / cleaned.length;
    if (ratio >= 0.7 && cleaned.length >= 20) {
      const weight = 0.2;
      score += weight;
      triggers.push({
        type: 'uppercase-ratio',
        description: `Uppercase ratio ${(ratio * 100).toFixed(0)}%`,
        weight
      });
    }
  }

  if (REPETITIVE_PATTERN.test(content)) {
    const weight = 0.2;
    score += weight;
    triggers.push({ type: 'repetition', description: 'Contains repeated character spam', weight });
  }

  const words = content
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 0) {
    const counts = new Map<string, number>();
    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const mostCommon = Math.max(...counts.values());
    if (mostCommon >= WORD_REPETITION_THRESHOLD) {
      const weight = 0.2 + (mostCommon - WORD_REPETITION_THRESHOLD) * 0.02;
      score += weight;
      triggers.push({ type: 'repetition', description: 'Repeated words detected', weight });
    }
  }

  const textWithoutLinks = content.replace(URL_PATTERN, ' ');
  const nonLinkBodyLength = textWithoutLinks.replace(/\s+/g, '').length;

  if (nonLinkBodyLength <= 6 && linkCount > 0) {
    const weight = 0.15;
    score += weight;
    triggers.push({ type: 'length', description: 'Body dominated by links', weight });
  }

  if (content.length > 2000) {
    const weight = 0.1;
    score += weight;
    triggers.push({ type: 'length', description: 'Extremely long content body', weight });
  }

  if (context.accountAgeMs !== undefined && context.accountAgeMs < 24 * 60 * 60 * 1000) {
    const weight = 0.1;
    score += weight;
    triggers.push({ type: 'metadata', description: 'Account younger than 24h', weight });
  }

  if (context.userReputation !== undefined) {
    if (context.userReputation < 0.1) {
      const weight = 0.25;
      score += weight;
      triggers.push({ type: 'metadata', description: 'Low reputation account', weight });
    } else if (context.userReputation < 0.3) {
      const weight = 0.15;
      score += weight;
      triggers.push({ type: 'metadata', description: 'Below-average reputation', weight });
    } else if (context.userReputation > 0.7) {
      score -= 0.1;
    }
  }

  if (context.priorFlagCount) {
    const weight = Math.min(0.05 * context.priorFlagCount, 0.25);
    score += weight;
    triggers.push({ type: 'metadata', description: 'Historical flags on account', weight });
  }

  if ((context.attachmentCount ?? 0) > 4) {
    const weight = 0.15;
    score += weight;
    triggers.push({ type: 'structure', description: 'Unusually high attachment count', weight });
  }

  score = Math.min(Math.max(score, 0), 1);

  const severity: ContentScore['severity'] = score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';

  return {
    riskScore: score,
    severity,
    triggers
  };
}
