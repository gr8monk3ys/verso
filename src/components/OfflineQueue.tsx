"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { flush, onQueueChange } from "@/lib/offline/queue";

/**
 * Sync status.
 *
 * Visible only when there is something to say — pending sightings, or no
 * connection. A permanent "you are online" badge is noise; a silent queue that
 * drops your afternoon is worse.
 */
export function OfflineQueue() {
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setOnline(navigator.onLine);
    const unsubscribe = onQueueChange(setCount);

    async function sync() {
      const result = await flush();
      if (result.synced > 0) router.refresh();
    }

    function goOnline() {
      setOnline(true);
      void sync();
    }
    function goOffline() {
      setOnline(false);
    }

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    void sync();
    const timer = setInterval(sync, 30_000);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs offline page caching, not the queue.
      });
    }

    return () => {
      unsubscribe();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(timer);
    };
  }, [router]);

  if (online && count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center md:bottom-6">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border rule bg-[var(--color-ink-soft)] px-3 py-1.5 text-xs text-[var(--color-muted)] shadow-lg">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            online ? "bg-[var(--color-accent)] pulsing" : "bg-[var(--color-muted)]"
          }`}
        />
        {online
          ? `Syncing ${count} sighting${count === 1 ? "" : "s"}…`
          : count > 0
            ? `Offline · ${count} saved here, will sync`
            : "Offline · your logs are saved on this device"}
      </div>
    </div>
  );
}
