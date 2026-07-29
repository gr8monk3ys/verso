"use client";

/**
 * Offline-first sighting queue (§9.1).
 *
 * "Offline-first is mandatory. Gallery basements have no signal." Reviewers of
 * the competition complained specifically about forgetting to check in while
 * physically present with no way to backfill — the fix is that the app never
 * asks whether it is online. Every sighting is written to IndexedDB first and
 * synced afterwards, so the capture path is local-only and cannot fail on
 * signal.
 *
 * Idempotency: each queued sighting carries a client-minted UUID and the server
 * treats a replay as success (see createSighting). Retrying blind is therefore
 * always safe, which is what lets the flush be this dumb.
 */

const DB_NAME = "verso";
const DB_VERSION = 2;
const QUEUE_STORE = "sighting-queue";
const CATALOGUE_STORE = "catalogue";

export type QueuedSighting = {
  clientUuid: string;
  workId: number;
  workTitle: string;
  workArtist: string;
  venueId: number | null;
  seenOn: string | null;
  rating: number | null;
  review: string | null;
  tags: string[];
  source: "capture" | "search" | "backfill" | "import";
  encounter: "original" | "reproduction";
  recognitionRank?: number | null;
  recognitionTopWorkId?: number | null;
  recognitionScore?: number | null;
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

export type OfflineWork = {
  id: number;
  slug: string;
  title: string;
  artist: string;
  date: string;
  gallery: string | null;
  /** Lowercased title + artist, for local substring search. */
  haystack: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "clientUuid" });
      }
      if (!db.objectStoreNames.contains(CATALOGUE_STORE)) {
        db.createObjectStore(CATALOGUE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function newClientUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const listeners = new Set<(count: number) => void>();

export function onQueueChange(listener: (count: number) => void): () => void {
  listeners.add(listener);
  void pendingCount().then(listener);
  return () => listeners.delete(listener);
}

async function announce() {
  const count = await pendingCount();
  for (const listener of listeners) listener(count);
}

export async function enqueue(
  sighting: Omit<QueuedSighting, "queuedAt" | "attempts" | "clientUuid"> & { clientUuid?: string },
): Promise<QueuedSighting> {
  const record: QueuedSighting = {
    ...sighting,
    clientUuid: sighting.clientUuid ?? newClientUuid(),
    queuedAt: Date.now(),
    attempts: 0,
  };
  await tx(QUEUE_STORE, "readwrite", (store) => store.put(record));
  void announce();
  // Fire and forget: if we're online this lands immediately, and if we're not
  // the queue is already durable.
  void flush();
  return record;
}

export async function pending(): Promise<QueuedSighting[]> {
  const all = await tx<QueuedSighting[]>(QUEUE_STORE, "readonly", (store) =>
    store.getAll() as IDBRequest<QueuedSighting[]>,
  );
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function pendingCount(): Promise<number> {
  try {
    return await tx<number>(QUEUE_STORE, "readonly", (store) => store.count());
  } catch {
    return 0;
  }
}

async function remove(clientUuid: string) {
  await tx(QUEUE_STORE, "readwrite", (store) => store.delete(clientUuid));
}

let flushing = false;

/** Push everything queued. Safe to call at any time, including offline. */
export async function flush(): Promise<{ synced: number; failed: number }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    const queue = await pending();
    for (const item of queue) {
      try {
        const response = await fetch("/api/sightings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientUuid: item.clientUuid,
            workId: item.workId,
            venueId: item.venueId,
            seenOn: item.seenOn,
            datePrecision: item.seenOn ? "day" : "unknown",
            rating: item.rating,
            review: item.review,
            tags: item.tags,
            source: item.source,
            encounter: item.encounter,
            recognition: {
              rank: item.recognitionRank ?? null,
              topWorkId: item.recognitionTopWorkId ?? null,
              score: item.recognitionScore ?? null,
            },
          }),
        });

        if (response.ok) {
          await remove(item.clientUuid);
          synced++;
          continue;
        }

        // 4xx means this payload will never be accepted; keeping it would jam
        // the queue behind a permanently poisoned entry. 401 is the exception:
        // the session may come back.
        if (response.status >= 400 && response.status < 500 && response.status !== 401) {
          await remove(item.clientUuid);
          failed++;
          continue;
        }
        failed++;
      } catch {
        failed++;
        break; // network died mid-flush; try again on the next online event
      }
    }
  } finally {
    flushing = false;
    void announce();
  }
  return { synced, failed };
}

// ------------------------------------------------------- offline catalogue --

/**
 * A slice of the catalogue cached for the venue you are standing in, so search
 * still works with no signal. One venue's on-view works is a few hundred rows —
 * small enough to keep, large enough to cover a visit.
 */
export async function cacheVenueCatalogue(venueSlug: string, works: OfflineWork[]) {
  await tx(CATALOGUE_STORE, "readwrite", (store) =>
    store.put({ key: `venue:${venueSlug}`, cachedAt: Date.now(), works }),
  );
}

export async function cachedVenueCatalogue(venueSlug: string): Promise<OfflineWork[]> {
  try {
    const record = await tx<{ works: OfflineWork[] } | undefined>(
      CATALOGUE_STORE,
      "readonly",
      (store) =>
        store.get(`venue:${venueSlug}`) as IDBRequest<{ works: OfflineWork[] } | undefined>,
    );
    return record?.works ?? [];
  } catch {
    return [];
  }
}

export function searchOffline(works: OfflineWork[], query: string, limit = 20): OfflineWork[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return works.slice(0, limit);
  const tokens = needle.split(/\s+/);
  return works
    .filter((work) => tokens.every((token) => work.haystack.includes(token)))
    .slice(0, limit);
}
