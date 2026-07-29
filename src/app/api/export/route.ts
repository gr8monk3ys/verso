import { currentUser } from "@/lib/auth/session";
import { exportCsv, exportJson } from "@/lib/domain/export";
import { recordEvent } from "@/lib/domain/social";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response("not signed in", { status: 401 });

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  recordEvent(user.id, "export", { format });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return new Response(exportJson(user.id, user.handle), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="verso-${user.handle}-${stamp}.json"`,
      },
    });
  }

  return new Response(exportCsv(user.id), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="verso-${user.handle}-${stamp}.csv"`,
    },
  });
}
