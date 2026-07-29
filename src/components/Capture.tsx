"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { StarInput } from "@/components/Stars";
import {
  cacheVenueCatalogue,
  cachedVenueCatalogue,
  enqueue,
  newClientUuid,
  searchOffline,
  type OfflineWork,
} from "@/lib/offline/queue";

/**
 * The in-gallery capture path (§9.1).
 *
 * Target: under ten seconds, one hand, poor signal, feeling self-conscious.
 * The decisions that follow from that:
 *
 *   · nothing blocks on the network — the sighting is written to IndexedDB and
 *     synced later, so "Logged" is true the instant it is shown
 *   · the screen does not navigate away after logging. A visit is fifteen
 *     works; bouncing to a confirmation page after each one is what makes
 *     visit-logging the natural unit instead of work-logging (§4)
 *   · rating is offered but never required. Nobody writes criticism standing
 *     in front of a Rothko with a queue behind them; the evening prompt at
 *     /me/queue is where that happens
 *   · every suggestion shows alternates and needs an explicit tap (R5)
 */

type Candidate = {
  workId: number;
  slug: string;
  title: string;
  artist: string;
  dateDisplay: string;
  imageUrl: string | null;
  locationLabel: string | null;
  score: number;
  basis: string;
};

type Venue = { id: number; slug: string; name: string; city: string };

type Logged = {
  clientUuid: string;
  workId: number;
  title: string;
  artist: string;
  rating: number | null;
};

const VENUE_KEY = "verso:last-venue";

export function Capture({ venues, today }: { venues: Venue[]; today: string }) {
  const [venueId, setVenueId] = useState<number | null>(venues[0]?.id ?? null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [usesImage, setUsesImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [logged, setLogged] = useState<Logged[]>([]);
  const [pendingRating, setPendingRating] = useState<Logged | null>(null);
  const [offlineWorks, setOfflineWorks] = useState<OfflineWork[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const venue = useMemo(
    () => venues.find((item) => item.id === venueId) ?? null,
    [venues, venueId],
  );

  // Remember where you were. People go to the same museum repeatedly (§6).
  useEffect(() => {
    const saved = Number(localStorage.getItem(VENUE_KEY));
    if (saved && venues.some((item) => item.id === saved)) setVenueId(saved);
  }, [venues]);

  useEffect(() => {
    if (venueId) localStorage.setItem(VENUE_KEY, String(venueId));
  }, [venueId]);

  // Pull this venue's on-view list into IndexedDB so search keeps working in
  // a basement. Refreshed opportunistically, used unconditionally.
  useEffect(() => {
    if (!venue) return;
    let cancelled = false;
    void (async () => {
      const cached = await cachedVenueCatalogue(venue.slug);
      if (!cancelled && cached.length) setOfflineWorks(cached);
      try {
        const response = await fetch(`/api/catalogue?venue=${venue.slug}&full`);
        if (!response.ok) return;
        const body = (await response.json()) as { works: OfflineWork[] };
        if (cancelled) return;
        setOfflineWorks(body.works);
        await cacheVenueCatalogue(venue.slug, body.works);
      } catch {
        // offline: the cached copy above is the answer
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue]);

  const startCamera = useCallback(async () => {
    if (streamRef.current || typeof navigator === "undefined" || !navigator.mediaDevices) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraError("No camera here — search below works just as well.");
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [startCamera]);

  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const width = 640;
    const height = Math.round((video.videoHeight / video.videoWidth) * width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  const identify = useCallback(async () => {
    if (!venueId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/recognize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, image: usesImage ? grabFrame() : null }),
      });
      const body = (await response.json()) as {
        candidates: Candidate[];
        provider: string;
        usesImage?: boolean;
      };
      setCandidates(body.candidates ?? []);
      setProvider(body.provider);
      setUsesImage(Boolean(body.usesImage));
    } catch {
      // Offline: fall back to the cached venue list, ranked arbitrarily but
      // honestly labelled.
      setCandidates(
        offlineWorks.slice(0, 3).map((work) => ({
          workId: work.id,
          slug: work.slug,
          title: work.title,
          artist: work.artist,
          dateDisplay: work.date,
          imageUrl: null,
          locationLabel: work.gallery,
          score: 0,
          basis: "From this venue's offline list",
        })),
      );
      setProvider("offline");
    } finally {
      setBusy(false);
    }
  }, [venueId, usesImage, grabFrame, offlineWorks]);

  useEffect(() => {
    if (venueId) void identify();
    // Re-shortlist when the venue changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  // Search: server when possible, cached catalogue when not.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const local = searchOffline(offlineWorks, trimmed, 8).map((work) => ({
        workId: work.id,
        slug: work.slug,
        title: work.title,
        artist: work.artist,
        dateDisplay: work.date,
        imageUrl: null,
        locationLabel: work.gallery,
        score: 0,
        basis: "In this venue",
      }));
      setResults(local);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "8" });
        if (venue) params.set("venue", venue.slug);
        const response = await fetch(`/api/catalogue?${params}`);
        if (!response.ok) return;
        const body = (await response.json()) as {
          results: {
            id: number;
            slug: string;
            title: string;
            artist: string;
            date: string;
            gallery: string | null;
            image: string | null;
          }[];
        };
        setResults(
          body.results.map((work) => ({
            workId: work.id,
            slug: work.slug,
            title: work.title,
            artist: work.artist,
            dateDisplay: work.date,
            imageUrl: work.image,
            locationLabel: work.gallery,
            score: 0,
            basis: "Search",
          })),
        );
      } catch {
        // keep local results
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, offlineWorks, venue]);

  const log = useCallback(
    async (candidate: Candidate, rank: number) => {
      const clientUuid = newClientUuid();
      const entry: Logged = {
        clientUuid,
        workId: candidate.workId,
        title: candidate.title,
        artist: candidate.artist,
        rating: null,
      };
      setLogged((current) => [entry, ...current]);
      setPendingRating(entry);
      setQuery("");
      setResults([]);

      await enqueue({
        clientUuid,
        workId: candidate.workId,
        workTitle: candidate.title,
        workArtist: candidate.artist,
        venueId,
        seenOn: today,
        rating: null,
        review: null,
        tags: [],
        source: "capture",
        encounter: "original",
        recognitionRank: rank,
        recognitionTopWorkId: candidates[0]?.workId ?? null,
        recognitionScore: candidates[0]?.score ?? null,
      });

      // Next work: re-shortlist so the same painting isn't offered twice.
      void identify();
    },
    [venueId, today, candidates, identify],
  );

  const rateLast = useCallback(
    async (value: number | null) => {
      if (!pendingRating) return;
      setLogged((current) =>
        current.map((item) =>
          item.clientUuid === pendingRating.clientUuid ? { ...item, rating: value } : item,
        ),
      );
      // Re-queueing the same clientUuid replaces the queued copy while it is
      // still local; once synced, the rating goes through the same path as any
      // later edit.
      await enqueue({
        clientUuid: pendingRating.clientUuid,
        workId: pendingRating.workId,
        workTitle: pendingRating.title,
        workArtist: pendingRating.artist,
        venueId,
        seenOn: today,
        rating: value,
        review: null,
        tags: [],
        source: "capture",
        encounter: "original",
      });
    },
    [pendingRating, venueId, today],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <select
          className="field max-w-[60%]"
          value={venueId ?? ""}
          onChange={(event) => setVenueId(Number(event.target.value))}
          aria-label="Venue"
        >
          {venues.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--color-muted)]">
          {logged.length > 0 ? `${logged.length} logged today` : today}
        </span>
      </div>

      <div className="relative overflow-hidden border rule bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-[3/4] w-full object-cover opacity-90"
        />
        {cameraError && (
          <p className="absolute inset-x-0 bottom-0 bg-[var(--color-ink)]/85 px-3 py-2 text-center text-xs text-[var(--color-muted)]">
            {cameraError}
          </p>
        )}
        <button
          type="button"
          onClick={() => void identify()}
          disabled={busy}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 btn btn-primary px-6"
        >
          {busy ? "Looking…" : usesImage ? "Identify" : "What's here?"}
        </button>
      </div>

      {candidates.length > 0 && (
        <section>
          <h2 className="label-caps mb-2">
            {usesImage ? "Best match" : "On the wall here"}
            {provider === "offline" && " · offline"}
          </h2>
          <ul className="border rule divide-y divide-[var(--color-line)]">
            {candidates.map((candidate, index) => (
              <li key={candidate.workId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {candidate.title}{" "}
                    <span className="text-[var(--color-muted)]">{candidate.dateDisplay}</span>
                  </p>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {candidate.artist || "Unattributed"} · {candidate.basis}
                    {candidate.locationLabel ? ` · ${candidate.locationLabel}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={index === 0 ? "btn btn-primary px-4 py-1.5" : "btn px-4 py-1.5"}
                  onClick={() => void log(candidate, index)}
                >
                  Log
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Not one of these? Search below — nothing is logged without a tap.
          </p>
        </section>
      )}

      <section>
        <input
          className="field"
          placeholder="Search this venue — title or artist"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoCapitalize="none"
          autoComplete="off"
        />
        {results.length > 0 && (
          <ul className="mt-2 border rule divide-y divide-[var(--color-line)]">
            {results.map((candidate) => (
              <li key={candidate.workId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{candidate.title}</p>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {candidate.artist || "Unattributed"}
                    {candidate.locationLabel ? ` · ${candidate.locationLabel}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn px-4 py-1.5"
                  onClick={() => void log(candidate, -1)}
                >
                  Log
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendingRating && (
        <section className="border rule p-3">
          <p className="text-sm">
            Logged <strong>{pendingRating.title}</strong>. Rate it now, or leave it —
            you&apos;ll be asked this evening.
          </p>
          <div className="mt-2">
            <StarInput
              key={pendingRating.clientUuid}
              size="md"
              onChange={(value) => void rateLast(value)}
            />
          </div>
        </section>
      )}

      {logged.length > 0 && (
        <section>
          <h2 className="label-caps mb-2">This visit</h2>
          <ul className="border rule divide-y divide-[var(--color-line)] text-sm">
            {logged.map((item) => (
              <li key={item.clientUuid} className="flex items-center justify-between px-3 py-2">
                <span className="truncate">{item.title}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {item.rating == null ? "unrated" : `${item.rating / 2} / 5`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Saved on this device and synced when there&apos;s signal.{" "}
            <Link href="/me/queue" className="underline">
              Rate them later
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
