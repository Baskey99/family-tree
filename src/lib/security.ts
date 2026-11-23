/**
 * Application security utilities:
 * - Strict text & URL sanitization (blocks XSS schemes, SVG scripts, control chars, private hosts)
 * - Password strength evaluation & breached/common password blocking
 * - Sliding-window client rate limiting with exponential lockout
 * - Anti-bot guards (honeypot, timing check, and unpredictable human verification challenges)
 */

export type RateLimitAction =
  | 'login'
  | 'register'
  | 'reset_password'
  | 'google_auth'
  | 'invite';

interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  label: string;
}

interface RateLimitRecord {
  timestamps: number[];
  lockedUntil: number;
  lockCount: number;
}

const RATE_LIMIT_STORAGE_KEY = 'kinship_security_rl_v1';

const RATE_LIMIT_CONFIGS: Record<RateLimitAction, RateLimitConfig> = {
  login: {
    maxAttempts: 5,
    windowMs: 5 * 60 * 1000,
    baseCooldownMs: 30 * 1000,
    maxCooldownMs: 5 * 60 * 1000,
    label: 'login attempts',
  },
  register: {
    maxAttempts: 3,
    windowMs: 10 * 60 * 1000,
    baseCooldownMs: 2 * 60 * 1000,
    maxCooldownMs: 10 * 60 * 1000,
    label: 'registration attempts',
  },
  reset_password: {
    maxAttempts: 3,
    windowMs: 15 * 60 * 1000,
    baseCooldownMs: 3 * 60 * 1000,
    maxCooldownMs: 15 * 60 * 1000,
    label: 'password reset requests',
  },
  google_auth: {
    maxAttempts: 6,
    windowMs: 5 * 60 * 1000,
    baseCooldownMs: 60 * 1000,
    maxCooldownMs: 5 * 60 * 1000,
    label: 'Google sign-in attempts',
  },
  invite: {
    maxAttempts: 10,
    windowMs: 10 * 60 * 1000,
    baseCooldownMs: 2 * 60 * 1000,
    maxCooldownMs: 10 * 60 * 1000,
    label: 'invitation requests',
  },
};

const memoryRateLimits: Partial<Record<RateLimitAction, RateLimitRecord>> = {};

function loadRateLimitStore(): Partial<Record<RateLimitAction, RateLimitRecord>> {
  try {
    const raw = window.localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (!raw) return { ...memoryRateLimits };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ...memoryRateLimits };
    return { ...memoryRateLimits, ...(parsed as Partial<Record<RateLimitAction, RateLimitRecord>>) };
  } catch {
    return { ...memoryRateLimits };
  }
}

function saveRateLimitStore(store: Partial<Record<RateLimitAction, RateLimitRecord>>): void {
  Object.assign(memoryRateLimits, store);
  try {
    window.localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Fallback remains in memoryRateLimits
  }
}

function getCleanRecord(action: RateLimitAction, now: number): RateLimitRecord {
  const cfg = RATE_LIMIT_CONFIGS[action];
  const store = loadRateLimitStore();
  const existing = store[action];
  if (!existing) {
    return { timestamps: [], lockedUntil: 0, lockCount: 0 };
  }
  const timestamps = Array.isArray(existing.timestamps)
    ? existing.timestamps.filter((t) => typeof t === 'number' && now - t < cfg.windowMs)
    : [];
  const lockedUntil =
    typeof existing.lockedUntil === 'number' && existing.lockedUntil > now
      ? existing.lockedUntil
      : 0;
  const lockCount =
    timestamps.length === 0 && lockedUntil === 0
      ? 0
      : typeof existing.lockCount === 'number'
        ? Math.max(0, Math.min(existing.lockCount, 10))
        : 0;
  return { timestamps, lockedUntil, lockCount };
}

export function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function checkRateLimit(action: RateLimitAction): {
  allowed: boolean;
  retryAfterMs: number;
  recentAttempts: number;
  message?: string;
} {
  const now = Date.now();
  const cfg = RATE_LIMIT_CONFIGS[action];
  const record = getCleanRecord(action, now);

  if (record.lockedUntil > now) {
    const retryAfterMs = record.lockedUntil - now;
    return {
      allowed: false,
      retryAfterMs,
      recentAttempts: record.timestamps.length,
      message: `Too many ${cfg.label}. Please wait ${formatCooldown(retryAfterMs)} before trying again.`,
    };
  }

  return {
    allowed: true,
    retryAfterMs: 0,
    recentAttempts: record.timestamps.length,
  };
}

export function recordRateLimitAttempt(action: RateLimitAction): {
  locked: boolean;
  retryAfterMs: number;
  recentAttempts: number;
} {
  const now = Date.now();
  const cfg = RATE_LIMIT_CONFIGS[action];
  const store = loadRateLimitStore();
  const record = getCleanRecord(action, now);

  record.timestamps.push(now);

  let locked = false;
  let retryAfterMs = 0;

  if (record.timestamps.length >= cfg.maxAttempts) {
    record.lockCount += 1;
    const multiplier = Math.pow(2, Math.min(record.lockCount - 1, 4));
    retryAfterMs = Math.min(cfg.baseCooldownMs * multiplier, cfg.maxCooldownMs);
    record.lockedUntil = now + retryAfterMs;
    record.timestamps = [];
    locked = true;
  }

  store[action] = record;
  saveRateLimitStore(store);

  return {
    locked,
    retryAfterMs,
    recentAttempts: record.timestamps.length,
  };
}

export function resetRateLimit(action: RateLimitAction): void {
  const store = loadRateLimitStore();
  delete store[action];
  delete memoryRateLimits[action];
  saveRateLimitStore(store);
}

/**
 * Strips null bytes and unsafe ASCII control characters from multi-line text.
 */
export function sanitizeText(value: string, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    // Remove control chars except tab (\x09), LF (\x0A), CR (\x0D) and strip BiDi override chars
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Strips all control characters and collapses whitespace for single-line fields.
 */
export function sanitizeSingleLine(value: string, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

const SAFE_DATA_IMAGE_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const BLOCKED_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1\]|::1)$/i;

/**
 * Strictly validates an image URL before saving or rendering in <img src>.
 * Allows ONLY:
 *  - Safe compressed raster Data URLs (JPEG, PNG, WebP) — explicitly blocking SVG & HTML
 *  - Public HTTPS URLs (blocking javascript:, vbscript:, http:, file:, and local/private hosts)
 */
export function sanitizeImageUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 65000) return '';

  if (trimmed.startsWith('data:')) {
    return SAFE_DATA_IMAGE_RE.test(trimmed) ? trimmed : '';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return '';
    if (!parsed.hostname || BLOCKED_HOST_RE.test(parsed.hostname)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'admin123',
  'welcome1',
  'letmein1',
  'abc12345',
  'family123',
  'familytree',
]);

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  isAcceptable: boolean;
  reason?: string;
  checks: {
    minLength: boolean;
    hasLower: boolean;
    hasUpper: boolean;
    hasNumber: boolean;
    hasSymbol: boolean;
  };
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const checks = {
    minLength: password.length >= 8,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  };

  const lower = password.toLowerCase().trim();
  if (COMMON_WEAK_PASSWORDS.has(lower)) {
    return {
      score: 0,
      label: 'Too weak',
      isAcceptable: false,
      reason: 'This password is too common and easily guessed. Please choose a stronger password.',
      checks,
    };
  }

  const varietyCount =
    Number(checks.hasLower) +
    Number(checks.hasUpper) +
    Number(checks.hasNumber) +
    Number(checks.hasSymbol);

  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (password.length >= 8) score = 1;
  if (password.length >= 8 && varietyCount >= 2) score = 2;
  if (password.length >= 10 && varietyCount >= 3) score = 3;
  if (password.length >= 12 && varietyCount >= 3) score = 4;
  if (password.length >= 8 && varietyCount === 4) score = Math.max(score, 3) as 3 | 4;

  const labels: Record<0 | 1 | 2 | 3 | 4, PasswordStrengthResult['label']> = {
    0: 'Too weak',
    1: 'Weak',
    2: 'Fair',
    3: 'Good',
    4: 'Strong',
  };

  if (!checks.minLength) {
    return {
      score,
      label: labels[score],
      isAcceptable: false,
      reason: 'Password must be at least 8 characters long.',
      checks,
    };
  }

  if (varietyCount < 2) {
    return {
      score,
      label: labels[score],
      isAcceptable: false,
      reason: 'Use at least two character types (e.g., letters and numbers).',
      checks,
    };
  }

  return {
    score,
    label: labels[score],
    isAcceptable: true,
    checks,
  };
}

export interface HumanChallengeData {
  id: string;
  question: string;
  expectedAnswer: number;
}

function secureRandomInt(min: number, max: number): number {
  const span = max - min + 1;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return min + (arr[0] % span);
  }
  return min + Math.floor(Math.random() * span);
}

/**
 * Generates an unpredictable arithmetic human-verification challenge
 * to block automated registration, password-reset, and credential-stuffing bots.
 */
export function createHumanChallenge(): HumanChallengeData {
  const op = secureRandomInt(0, 1); // 0 = add, 1 = subtract
  let a: number;
  let b: number;
  let expectedAnswer: number;
  let question: string;

  if (op === 0) {
    a = secureRandomInt(3, 14);
    b = secureRandomInt(2, 9);
    expectedAnswer = a + b;
    question = `${a} + ${b}`;
  } else {
    a = secureRandomInt(10, 19);
    b = secureRandomInt(2, 9);
    expectedAnswer = a - b;
    question = `${a} − ${b}`;
  }

  return {
    id: `ch_${Date.now()}_${secureRandomInt(1000, 9999)}`,
    question,
    expectedAnswer,
  };
}

/**
 * Verifies silent anti-bot signals (honeypot trap + minimum human interaction time).
 */
export function verifyBotGuards(params: {
  honeypotValue: string;
  formOpenedAt: number;
  minHumanMs?: number;
}): { ok: boolean; reason?: string } {
  if (params.honeypotValue.trim().length > 0) {
    return {
      ok: false,
      reason: 'Automated submission detected. Please try again normally.',
    };
  }

  const minMs = params.minHumanMs ?? 800;
  if (Date.now() - params.formOpenedAt < minMs) {
    return {
      ok: false,
      reason: 'Submission was too fast. Please wait a second and try again.',
    };
  }

  return { ok: true };
}
