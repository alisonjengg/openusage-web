const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_BUCKETS = 1024;

type LoginFailure = {
  count: number;
  firstAt: number;
};

const g = globalThis as unknown as {
  __ouLoginFailures?: Map<string, LoginFailure>;
};
const failures = (g.__ouLoginFailures ??= new Map<string, LoginFailure>());

function currentEntry(key: string, now: number): LoginFailure | null {
  const entry = failures.get(key);
  if (!entry) return null;
  if (now - entry.firstAt > WINDOW_MS) {
    failures.delete(key);
    return null;
  }
  return entry;
}

function prune(now: number): void {
  for (const [key, entry] of failures) {
    if (now - entry.firstAt > WINDOW_MS) failures.delete(key);
  }
  while (failures.size >= MAX_BUCKETS) {
    const oldest = failures.keys().next().value as string | undefined;
    if (!oldest) return;
    failures.delete(oldest);
  }
}

export function isLoginRateLimited(key: string, now = Date.now()): boolean {
  const entry = currentEntry(key, now);
  return entry ? entry.count >= MAX_FAILURES : false;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const entry = currentEntry(key, now);
  if (!entry) {
    prune(now);
    failures.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}
