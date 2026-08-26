/**
 * Predicate for body-parser's oversized-body error (issue #109).
 *
 * express.json()/express.urlencoded() reject a body over their configured
 * `limit` with an error shaped `{ type: "entity.too.large", status: 413 }`
 * rather than a named error class, so a plain `instanceof` check doesn't
 * work — this is the shared check app.ts's error handler uses to give it a
 * clear 413 response instead of falling through to the generic 500 handler.
 */
export function isPayloadTooLargeError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { type?: unknown; status?: unknown };
  return e.type === 'entity.too.large' || e.status === 413;
}
