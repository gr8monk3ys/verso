import { NextResponse } from "next/server";
import { get } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness plus the one dependency that matters. A health check that returns
 * 200 without touching the database tells a load balancer the process is up
 * while every page 500s.
 *
 * Deliberately thin on detail: catalogue size is public on the landing page,
 * but nothing here should describe users.
 */
export async function GET() {
  try {
    const row = await get<{ works: number }>("SELECT COUNT(*) AS works FROM works");
    return NextResponse.json(
      { status: "ok", works: Number(row?.works ?? 0) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", error: "database unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
