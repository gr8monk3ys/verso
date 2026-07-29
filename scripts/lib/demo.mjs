/**
 * Demo data.
 *
 * Not a fixture for tests — this exists so the feed, the stats pages and the
 * §13 metric gates have something honest to render against. The personas and
 * their cadences come straight from §6: Priya logs often and rates most of
 * what she sees, Tom logs in bursts around coursework and writes at length,
 * Elena logs twice a year and hard.
 *
 * Everything is generated from a fixed seed so two runs produce the same
 * database and the metric numbers are reproducible.
 */

import { hashPassword } from "../../src/lib/auth/password.mjs";
import { assertDisplay } from "../../src/lib/domain/display.mjs";
import { transact } from "./db.mjs";

/** mulberry32 — small, fast, deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERSONAS = [
  {
    handle: "priya",
    display_name: "Priya Raghunathan",
    bio: "Met member. Mostly European paintings, increasingly the Egyptian wing.",
    // visits per month, works per visit, P(rate), P(review)
    visitsPerMonth: 3,
    worksPerVisit: [6, 18],
    rateProb: 0.72,
    reviewProb: 0.22,
    feedOpensPerWeek: 4,
  },
  {
    handle: "tom",
    display_name: "Tom Íñiguez",
    bio: "Painting MFA. Building a reference library one wall label at a time.",
    visitsPerMonth: 5,
    worksPerVisit: [10, 26],
    rateProb: 0.61,
    reviewProb: 0.34,
    feedOpensPerWeek: 6,
  },
  {
    handle: "elena",
    display_name: "Elena Marchetti",
    bio: "Two trips a year, planned obsessively. Currently: medieval everything.",
    visitsPerMonth: 0.5,
    worksPerVisit: [18, 40],
    rateProb: 0.8,
    reviewProb: 0.4,
    feedOpensPerWeek: 1,
  },
  {
    handle: "marcus",
    display_name: "Marcus Bell",
    bio: "Sculpture, bronzes, and arguing about plinths.",
    visitsPerMonth: 2,
    worksPerVisit: [5, 12],
    rateProb: 0.55,
    reviewProb: 0.12,
    feedOpensPerWeek: 3,
  },
  {
    handle: "jo",
    display_name: "Jo Vance",
    bio: "Lunch-hour looker. One gallery at a time.",
    visitsPerMonth: 4,
    worksPerVisit: [3, 8],
    rateProb: 0.4,
    reviewProb: 0.08,
    feedOpensPerWeek: 5,
  },
  {
    handle: "ines",
    display_name: "Inês Da Cunha",
    bio: "Conservator. I look at surfaces, not subjects.",
    visitsPerMonth: 2.5,
    worksPerVisit: [4, 14],
    rateProb: 0.66,
    reviewProb: 0.3,
    feedOpensPerWeek: 2,
  },
];

// Dense on purpose. §4's second principle is that social products need graph
// density more than user count, and the V1 gate wants a median of five follows
// — a demo graph thinner than the gate makes the gate page meaningless.
const FOLLOWS = [
  ["priya", "tom"], ["priya", "elena"], ["priya", "ines"], ["priya", "marcus"], ["priya", "jo"],
  ["tom", "priya"], ["tom", "marcus"], ["tom", "ines"], ["tom", "jo"], ["tom", "elena"],
  ["elena", "priya"], ["elena", "tom"], ["elena", "ines"], ["elena", "marcus"], ["elena", "jo"],
  ["marcus", "tom"], ["marcus", "priya"], ["marcus", "jo"], ["marcus", "ines"], ["marcus", "elena"],
  ["jo", "priya"], ["jo", "tom"], ["jo", "marcus"], ["jo", "ines"], ["jo", "elena"],
  ["ines", "priya"], ["ines", "tom"], ["ines", "elena"], ["ines", "marcus"], ["ines", "jo"],
];

const REVIEW_LINES = [
  "Smaller than I expected and much better for it.",
  "Third time seeing this and the first time I've noticed the hands.",
  "The label does it no favours. Stand to the left of it.",
  "Hung too high. Still extraordinary.",
  "Went back twice in one visit, which is unusual for me.",
  "Not a great example, but a useful one.",
  "The paint handling in the lower third is doing all the work.",
  "Overexposed by reproduction. In person it's much colder.",
  "Kept thinking about this on the train home.",
  "Technically astonishing, emotionally inert.",
  "Everyone walks past this to get to the room after it. Don't.",
  "Better in winter light.",
];

const TAG_POOL = [
  "portrait", "landscape", "bronze", "marble", "revisit", "wow", "close-looking",
  "for-teaching", "colour", "surface", "small", "monumental", "underrated",
];

const LIST_SPECS = [
  { handle: "tom", title: "Hands, badly painted", description: "A teaching set. Mostly cautionary.", ranked: 0, size: 9 },
  { handle: "tom", title: "Surfaces to study before finals", description: "", ranked: 1, size: 12 },
  { handle: "priya", title: "The ten-minute Met", description: "If you only have ten minutes and you're already inside.", ranked: 1, size: 10 },
  { handle: "elena", title: "Reasons to go back to the Cloisters", description: "", ranked: 0, size: 8 },
  { handle: "ines", title: "Damage you can see from the rope", description: "Not a criticism. A reading list.", ranked: 0, size: 7 },
  { handle: "marcus", title: "Bronzes that survive being walked around", description: "", ranked: 1, size: 11 },
];

/**
 * The named personas are the six from §6, plus a background population.
 *
 * The background exists for one reason: k-anonymity. The institutional
 * dashboard suppresses anything derived from fewer than five distinct
 * visitors, so a six-person demo makes that page render an empty table and
 * look broken rather than careful. R3's plan is 200 hand-recruited users in
 * one city; this is a fortieth of that, which is enough for the suppression
 * threshold to pass on popular works and still bite on quiet ones.
 */
const BACKGROUND_USERS = 34;

const FIRST_NAMES = [
  "Alex", "Bea", "Caro", "Dev", "Emeka", "Fen", "Greta", "Hana", "Ivo", "Juno",
  "Kit", "Lena", "Mo", "Nils", "Orla", "Pia", "Quinn", "Rae", "Sami", "Tuur",
  "Uma", "Vic", "Wren", "Xan", "Yara", "Zsa",
];
const LAST_NAMES = [
  "Adeyemi", "Bergström", "Costa", "Duarte", "Egan", "Fournier", "Gao", "Haas",
  "Iversen", "Jha", "Kowalski", "Lindqvist", "Mbeki", "Novak", "O'Rourke",
  "Petrov", "Quraishi", "Rossi", "Sandoval", "Takahashi",
];

function backgroundPersona(index, random) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 7 + 3) % LAST_NAMES.length];
  const keen = random();
  return {
    handle: `${first.toLowerCase().replace(/[^a-z]/g, "")}${index + 10}`,
    display_name: `${first} ${last}`,
    bio: "",
    // A long tail: most people log a little, a few log constantly.
    visitsPerMonth: Number((0.4 + keen * keen * 4).toFixed(2)),
    worksPerVisit: [2, 6 + Math.round(keen * 18)],
    rateProb: 0.3 + keen * 0.5,
    reviewProb: 0.05 + keen * 0.25,
    feedOpensPerWeek: Math.round(keen * 6),
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

function intBetween(random, [low, high]) {
  return low + Math.floor(random() * (high - low + 1));
}

export function seedDemo(db, { days = 180, seed = 20260729 } = {}) {
  const random = rng(seed);
  const personas = [
    ...PERSONAS,
    ...Array.from({ length: BACKGROUND_USERS }, (_, index) =>
      backgroundPersona(index, random),
    ),
  ];
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  const venues = db.prepare("SELECT id, slug FROM venues").all();
  if (!venues.length) throw new Error("seed the catalogue first: scripts/db.mjs seed");

  // Works grouped by (venue, gallery). Real visits are contiguous: you log six
  // things in one room, not six things scattered across the building.
  const galleries = new Map();
  const rows = db
    .prepare(
      `SELECT d.work_id, d.venue_id, d.location_label
         FROM displays d
        WHERE d.source = 'institutional' AND d.ended_on IS NULL`,
    )
    .all();
  for (const row of rows) {
    const key = `${row.venue_id}|${row.location_label ?? ""}`;
    if (!galleries.has(key)) {
      galleries.set(key, { venueId: row.venue_id, label: row.location_label, works: [] });
    }
    galleries.get(key).works.push(row.work_id);
  }
  const galleryList = [...galleries.values()].filter((g) => g.works.length >= 3);
  if (!galleryList.length) throw new Error("no institutional displays to draw on");

  const summary = {
    users: 0, sightings: 0, ratings: 0, reviews: 0, lists: 0,
    follows: 0, likes: 0, comments: 0, watchlist: 0, exhibitions: 0,
  };

  transact(db, () => {
    // ------------------------------------------------------------- users --
    const password = hashPassword("verso-demo");
    const insertUser = db.prepare(
      `INSERT INTO users (handle, display_name, email, password_hash, bio, home_city, created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(handle) DO UPDATE SET display_name = excluded.display_name`,
    );
    const userIds = new Map();
    for (const persona of personas) {
      const joined = new Date(today);
      joined.setUTCDate(joined.getUTCDate() - days - intBetween(random, [1, 40]));
      insertUser.run(
        persona.handle,
        persona.display_name,
        `${persona.handle}@example.test`,
        password,
        persona.bio,
        "New York",
        `${isoDate(joined)} 09:00:00`,
      );
      const id = db.prepare("SELECT id FROM users WHERE handle = ?").get(persona.handle).id;
      userIds.set(persona.handle, id);
      summary.users++;
    }

    const insertFollow = db.prepare(
      "INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)",
    );
    for (const [a, b] of FOLLOWS) {
      insertFollow.run(userIds.get(a), userIds.get(b));
      summary.follows++;
    }

    // The background population follows a handful of people each, weighted
    // towards the named personas — new users follow the people already
    // logging, which is what makes a one-city graph dense rather than wide.
    const allHandles = personas.map((persona) => persona.handle);
    for (const persona of personas) {
      if (PERSONAS.some((named) => named.handle === persona.handle)) continue;
      const count = intBetween(random, [4, 9]);
      for (let i = 0; i < count; i++) {
        const target =
          random() < 0.6
            ? pick(random, PERSONAS).handle
            : pick(random, allHandles);
        if (target === persona.handle) continue;
        insertFollow.run(userIds.get(persona.handle), userIds.get(target));
        summary.follows++;
      }
    }

    // ------------------------------------------------------- exhibitions --
    const metId = venues.find((v) => v.slug === "met-fifth-avenue")?.id ?? venues[0].id;
    const cloistersId = venues.find((v) => v.slug === "met-cloisters")?.id ?? metId;
    const exhibitionSpecs = [
      {
        slug: "hands-of-the-sculptor",
        venue_id: metId,
        title: "Hands of the Sculptor",
        subtitle: "Modelling and the unfinished",
        starts: -150,
        ends: 30,
        size: 26,
      },
      {
        slug: "winter-light-cloisters",
        venue_id: cloistersId,
        title: "Winter Light",
        subtitle: "Glass and the medieval interior",
        starts: -90,
        ends: 45,
        size: 18,
      },
    ];
    const insertExhibition = db.prepare(
      `INSERT INTO exhibitions (slug, venue_id, title, subtitle, description, starts_on, ends_on)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(slug) DO NOTHING`,
    );
    const insertInclusion = db.prepare(
      "INSERT OR IGNORE INTO inclusions (exhibition_id, work_id, position) VALUES (?,?,?)",
    );
    const exhibitionsByVenue = new Map();
    for (const spec of exhibitionSpecs) {
      const startsOn = new Date(today);
      startsOn.setUTCDate(startsOn.getUTCDate() + spec.starts);
      const endsOn = new Date(today);
      endsOn.setUTCDate(endsOn.getUTCDate() + spec.ends);
      insertExhibition.run(
        spec.slug, spec.venue_id, spec.title, spec.subtitle,
        "A demo exhibition: works drawn from the permanent collection so the " +
          "exhibition surface has something to show before real listings exist.",
        isoDate(startsOn), isoDate(endsOn),
      );
      const exhibition = db.prepare("SELECT id FROM exhibitions WHERE slug = ?").get(spec.slug);
      const pool = db
        .prepare(
          `SELECT w.id FROM works w
             JOIN displays d ON d.work_id = w.id AND d.ended_on IS NULL
            WHERE d.venue_id = ? ORDER BY w.id LIMIT ?`,
        )
        .all(spec.venue_id, spec.size);
      pool.forEach((work, index) => insertInclusion.run(exhibition.id, work.id, index));
      exhibitionsByVenue.set(spec.venue_id, {
        id: exhibition.id,
        works: new Set(pool.map((w) => w.id)),
        startsOn: isoDate(startsOn),
      });
      summary.exhibitions++;
    }

    // ---------------------------------------------------------- sightings --
    const insertSighting = db.prepare(
      `INSERT INTO sightings (client_uuid, user_id, work_id, venue_id, exhibition_id,
                              seen_on, date_precision, rating, review, private_note,
                              source, encounter, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO sighting_tags (sighting_id, tag) VALUES (?, ?)",
    );
    const insertRecognition = db.prepare(
      `INSERT INTO recognition_events (user_id, venue_id, top_work_id, chosen_work_id,
                                       chosen_rank, top_score, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    );
    const insertEvent = db.prepare(
      "INSERT INTO events (user_id, kind, at, meta) VALUES (?,?,?,?)",
    );

    let uuid = 0;
    const sightingsByUser = new Map();

    for (const persona of personas) {
      const userId = userIds.get(persona.handle);
      sightingsByUser.set(userId, []);

      // Visit days across the window, jittered.
      const visitCount = Math.max(1, Math.round((persona.visitsPerMonth * days) / 30));
      const visitDays = new Set();
      while (visitDays.size < visitCount) {
        visitDays.add(Math.floor(random() * days));
      }

      for (const daysAgo of [...visitDays].sort((a, b) => b - a)) {
        const when = new Date(today);
        when.setUTCDate(when.getUTCDate() - daysAgo);
        const seenOn = isoDate(when);

        // One or two galleries per visit.
        const rooms = random() < 0.55 ? 1 : 2;
        const chosen = [];
        for (let i = 0; i < rooms; i++) chosen.push(pick(random, galleryList));
        const venueId = chosen[0].venueId;
        const target = intBetween(random, persona.worksPerVisit);
        const pool = chosen.filter((g) => g.venueId === venueId).flatMap((g) => g.works);
        const seen = new Set();

        for (let i = 0; i < target && seen.size < pool.length; i++) {
          const workId = pick(random, pool);
          if (seen.has(workId)) continue;
          seen.add(workId);

          const rated = random() < persona.rateProb;
          // Ratings cluster high — people log what they chose to look at.
          const rating = rated ? Math.min(10, 5 + Math.floor(random() * 6)) : null;
          const reviewed = rated && random() < persona.reviewProb;
          const review = reviewed
            ? [pick(random, REVIEW_LINES), random() < 0.35 ? pick(random, REVIEW_LINES) : ""]
                .filter(Boolean)
                .join(" ")
            : null;
          const exhibition = exhibitionsByVenue.get(venueId);
          const exhibitionId =
            exhibition && exhibition.works.has(workId) && seenOn >= exhibition.startsOn
              ? exhibition.id
              : null;
          const capture = random() < 0.7;

          const result = insertSighting.run(
            `demo-${++uuid}`,
            userId,
            workId,
            venueId,
            exhibitionId,
            seenOn,
            "day",
            rating,
            review,
            random() < 0.08 ? "Note to self: check the catalogue raisonné." : null,
            capture ? "capture" : "search",
            "original",
            `${seenOn} ${10 + Math.floor(random() * 8)}:${String(Math.floor(random() * 60)).padStart(2, "0")}:00`,
            `${seenOn} 20:00:00`,
          );
          const sightingId = Number(result.lastInsertRowid);
          sightingsByUser.get(userId).push({ id: sightingId, workId, hasReview: !!review });
          summary.sightings++;
          if (rating) summary.ratings++;
          if (review) summary.reviews++;

          if (random() < 0.35) insertTag.run(sightingId, pick(random, TAG_POOL));
          if (random() < 0.15) insertTag.run(sightingId, pick(random, TAG_POOL));

          assertDisplay(db, { workId, venueId, seenOn, exhibitionId });

          if (capture) {
            // Most captures accept the top match; a minority correct it. This
            // is what the §13 guardrail measures.
            const acceptedTop = random() < 0.968;
            insertRecognition.run(
              userId, venueId,
              acceptedTop ? workId : pick(random, pool),
              workId,
              acceptedTop ? 0 : 1 + Math.floor(random() * 2),
              Number((0.55 + random() * 0.45).toFixed(3)),
              `${seenOn} 12:00:00`,
            );
          }
        }

        insertEvent.run(userId, "capture_session", `${seenOn} 12:00:00`, null);
      }

      // A backfill burst on signup: logging from memory, undated (§9.2).
      const backfill = Math.round(intBetween(random, [4, 14]));
      for (let i = 0; i < backfill; i++) {
        const gallery = pick(random, galleryList);
        const workId = pick(random, gallery.works);
        try {
          insertSighting.run(
            `demo-${++uuid}`, userId, workId, gallery.venueId, null,
            null, "unknown",
            random() < 0.8 ? Math.min(10, 6 + Math.floor(random() * 5)) : null,
            random() < 0.3 ? pick(random, REVIEW_LINES) : null,
            null, "backfill", "original",
            `${isoDate(new Date(today.getTime() - days * 86400000))} 21:00:00`,
            `${isoDate(new Date(today.getTime() - days * 86400000))} 21:00:00`,
          );
          summary.sightings++;
        } catch {
          // duplicate client_uuid is impossible here; ignore any constraint noise
        }
      }

      // Feed opens, for the V1 gate.
      const opens = Math.round((persona.feedOpensPerWeek * days) / 7);
      for (let i = 0; i < opens; i++) {
        const when = new Date(today);
        when.setUTCDate(when.getUTCDate() - Math.floor(random() * days));
        insertEvent.run(userId, "feed_open", `${isoDate(when)} 08:00:00`, null);
      }
    }

    // -------------------------------------------------- likes and comments --
    const publicReviews = db
      .prepare(
        `SELECT id, user_id FROM sightings
          WHERE review IS NOT NULL AND review_public = 1 AND is_private = 0`,
      )
      .all();
    const insertLike = db.prepare(
      "INSERT OR IGNORE INTO likes (user_id, sighting_id) VALUES (?, ?)",
    );
    const insertComment = db.prepare(
      "INSERT INTO comments (sighting_id, user_id, body) VALUES (?, ?, ?)",
    );
    const commentLines = [
      "Completely agree about the hands.",
      "It was moved last month — it's in 634 now.",
      "I've never managed to see this without a crowd.",
      "Adding to my watchlist.",
      "Strong disagree, but well argued.",
    ];
    const allUserIds = [...userIds.values()];
    for (const review of publicReviews) {
      for (const userId of allUserIds) {
        if (userId === review.user_id) continue;
        if (random() < 0.05) {
          insertLike.run(userId, review.id);
          summary.likes++;
        }
        if (random() < 0.012) {
          insertComment.run(review.id, userId, pick(random, commentLines));
          summary.comments++;
        }
      }
    }

    // ------------------------------------------------- lists and watchlist --
    const insertList = db.prepare(
      `INSERT INTO lists (user_id, slug, title, description, is_public, is_ranked)
       VALUES (?,?,?,?,1,?) ON CONFLICT(user_id, slug) DO NOTHING`,
    );
    const insertListItem = db.prepare(
      `INSERT OR IGNORE INTO list_items (list_id, work_id, position, note)
       VALUES (?,?,?,?)`,
    );
    for (const spec of LIST_SPECS) {
      const userId = userIds.get(spec.handle);
      const slug = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      insertList.run(userId, slug, spec.title, spec.description, spec.ranked);
      const list = db
        .prepare("SELECT id FROM lists WHERE user_id = ? AND slug = ?")
        .get(userId, slug);
      const seen = sightingsByUser.get(userId) ?? [];
      for (let i = 0; i < spec.size && seen.length; i++) {
        const entry = pick(random, seen);
        insertListItem.run(list.id, entry.workId, i, "");
      }
      summary.lists++;
    }

    const insertWatch = db.prepare(
      "INSERT OR IGNORE INTO watchlist (user_id, work_id, note) VALUES (?,?,?)",
    );
    const watchPool = db
      .prepare("SELECT id FROM works ORDER BY id LIMIT 400")
      .all();
    for (const userId of allUserIds) {
      const count = intBetween(random, [3, 9]);
      for (let i = 0; i < count; i++) {
        insertWatch.run(userId, pick(random, watchPool).id, "");
        summary.watchlist++;
      }
    }
  });

  return summary;
}
