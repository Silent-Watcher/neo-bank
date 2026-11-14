/**
 * Races `operation` against a fixed timeout so a peer that never answers
 * (e.g. a dropped-packet host that stalls the TCP handshake) surfaces as a
 * normal failure instead of hanging the caller. PostgreSQL connection
 * attempts and probes have no built-in timeout knob through the ORM
 * configuration, so database-side waits are bounded here.
 *
 * Promise.race subscribes to both promises, so a late rejection from the
 * losing side can never surface as an unhandled rejection; the timer is
 * always cleared so no stale handle outlives the operation.
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
