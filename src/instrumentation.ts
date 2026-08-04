import { reportError } from "@/lib/observability.mjs";

/**
 * Server-side error reporting.
 *
 * `onRequestError` is the framework's own hook and fires for every server error
 * Next catches — Server Component renders, route handlers, and server actions —
 * which is the set an error boundary in the client cannot see. `error.tsx` tells
 * the user their sightings are safe; this tells the operator what broke.
 *
 * Deliberately thin. The redaction and the transport live in lib/observability so
 * they are testable without a running server, and so the rule about never
 * forwarding request headers sits next to the code that builds the payload.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: {
    routePath?: string;
    routeType?: string;
    renderSource?: string;
    revalidateReason?: string;
  },
) {
  await reportError(error, request, context);
}
