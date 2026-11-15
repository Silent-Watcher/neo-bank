// Application-owned HTTP boundary contracts (ADR-032): the minimal request and
// response surfaces that reusable components consume. The running adapter's
// request/response objects satisfy these structurally, so no shared component
// imports a platform-specific type; only the bootstrap registers
// platform-specific behavior against them.

/** Narrowing guard shared by the HTTP-boundary consumers. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface HttpRequestLike {
  /** HTTP method; absent for transport-level errors answered before parsing. */
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /**
   * Request ID assigned by the request-ID lifecycle before routing (ADR-010):
   * a UUIDv4 string there. Typed `unknown` because the platform's
   * IncomingMessage augmentation declares the wider `ReqId`
   * (`number | string | object`) and every consumer stringifies the value.
   */
  id?: unknown;
}

export interface HttpResponseLike {
  /** The status code the response will be sent with. */
  statusCode: number;
  getHeader(name: string): string | number | string[] | undefined;
  /** Sets a response header (chained, like the adapter's express-style helpers). */
  header(name: string, value: string): HttpResponseLike;
  /** Sets the status code the response will be sent with. */
  status(code: number): HttpResponseLike;
  /** Serializes and sends the body, ending the response. */
  send(body?: unknown): unknown;
  /** True once the response has finished sending. */
  writableEnded: boolean;
  /** True once the response headers have been sent (writes have started). */
  headersSent: boolean;
}
