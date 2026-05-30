type FlightMap = Map<string, Promise<unknown>>;

const g = globalThis as unknown as { __ouSingleFlights?: FlightMap };
const flights = (g.__ouSingleFlights ??= new Map<string, Promise<unknown>>());

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = flights.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  let promise: Promise<T>;
  promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (flights.get(key) === promise) flights.delete(key);
    });
  flights.set(key, promise);
  return promise;
}
