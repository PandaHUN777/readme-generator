/**
 * Secret-pattern scanning. Used twice: on repository file content before it is
 * placed in the brief (and therefore before it can reach a generation provider),
 * and on the generated README before it is written.
 */

export interface SecretPattern {
  id: string;
  description: string;
  regex: RegExp;
}

// Patterns are intentionally conservative about false negatives: a redacted
// false positive in a README draft is cheap, a leaked credential is not.
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'private-key',
    description: 'PEM private key block',
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  },
  { id: 'aws-access-key', description: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', description: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { id: 'openai-key', description: 'OpenAI-style API key', regex: /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'xai-key', description: 'xAI API key', regex: /\bxai-[A-Za-z0-9]{20,}\b/g },
  { id: 'anthropic-key', description: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', description: 'Slack token', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'google-api-key', description: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'stripe-key', description: 'Stripe secret key', regex: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
  { id: 'npm-token', description: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    id: 'jwt',
    description: 'JSON Web Token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'url-credentials',
    description: 'credentials embedded in a URL',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{6,}@[^\s]+/gi,
  },
  {
    id: 'generic-assignment',
    description: 'hard-coded secret assignment',
    // key = "value" where the value looks like a real credential (long, mixed, no spaces,
    // not an obvious placeholder such as <...>, ${...}, YOUR_..., xxx).
    regex:
      /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b["']?\s*[:=]\s*["'](?![<$]|your|xxx|changeme|example|placeholder)(?=[^"'\s]*[0-9])(?=[^"'\s]*[A-Za-z])[^"'\s]{16,}["']/gi,
  },
];

export interface SecretFinding {
  patternId: string;
  description: string;
  /** 1-based line number of the match start. */
  line: number;
}

export interface ScanResult {
  findings: SecretFinding[];
  redacted: string;
}

export const REDACTION = '[REDACTED]';

/** Scan text for secret patterns and return findings plus a redacted copy. Never returns the secret values. */
export function scanForSecrets(text: string): ScanResult {
  const findings: SecretFinding[] = [];
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of text.matchAll(re)) {
      const idx = match.index ?? 0;
      findings.push({
        patternId: pattern.id,
        description: pattern.description,
        line: text.slice(0, idx).split('\n').length,
      });
    }
    redacted = redacted.replace(new RegExp(pattern.regex.source, pattern.regex.flags), REDACTION);
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, redacted };
}

/** Replace any occurrence of known secret values (e.g. the user's own tokens) in a message. */
export function scrubKnownValues(message: string, values: Array<string | undefined>): string {
  let out = message;
  for (const v of values) {
    if (v && v.length >= 8) out = out.split(v).join(REDACTION);
  }
  return out;
}
