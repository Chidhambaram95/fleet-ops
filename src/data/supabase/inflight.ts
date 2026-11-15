const pending = new Map<string, Promise<unknown>>();

/**
 * Lets several callers that ask for the same thing at the same moment share
 * one request. Home screens mount five or six cards that each need the bus
 * list; with this they send one query instead of six.
 *
 * Only calls that are in flight at the same time are shared. Once the request
 * finishes the next call asks the database again, so nothing is ever stale.
 * Browser only: on the server one process serves many people, and what they
 * may read differs by person, so every call runs its own query there.
 * Arrays are copied for each caller; treat the objects in them as read-only.
 */
export function shareInFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") {
    return load();
  }
  let promise = pending.get(key) as Promise<T> | undefined;
  if (!promise) {
    const started: Promise<T> = load().finally(() => {
      if (pending.get(key) === started) pending.delete(key);
    });
    pending.set(key, started);
    promise = started;
  }
  return promise.then((value) => (Array.isArray(value) ? ([...value] as unknown as T) : value));
}
