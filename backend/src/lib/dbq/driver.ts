/**
 * Which transport delivers queued work.
 *
 * "redis"    — BullMQ delivers instantly; Postgres remains the durable record
 *              for registry jobs (transactional-outbox pattern) and the
 *              conversion/extraction queues run natively on BullMQ.
 * "postgres" — no Redis anywhere: the DB queue's poller is the delivery
 *              mechanism, and conversion/extraction (when their ASYNC_* flags
 *              are on) ride the DB queue too.
 *
 * Resolution, in order:
 * 1. QUEUE_DRIVER=redis|postgres — explicit operator override.
 * 2. REDIS_URL set — the deployment configured Redis; use it.
 * 3. A legacy ASYNC_* flag is "true" — those flags have always meant "BullMQ
 *    against REDIS_URL (default localhost)", so flag-on deployments keep
 *    their Redis semantics even without an explicit REDIS_URL.
 * 4. Otherwise: postgres. This is every pre-existing default deployment —
 *    which is exactly why the DB queue, not BullMQ, is the default-on layer.
 */
export function queueDriver(): "redis" | "postgres" {
    const explicit = process.env.QUEUE_DRIVER;
    if (explicit === "redis" || explicit === "postgres") return explicit;
    if (process.env.REDIS_URL) return "redis";
    if (process.env.ASYNC_DOCUMENT_CONVERSION === "true") return "redis";
    if (process.env.ASYNC_TABULAR_EXTRACTION === "true") return "redis";
    return "postgres";
}

export function redisEnabled(): boolean {
    return queueDriver() === "redis";
}
