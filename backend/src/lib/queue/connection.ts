import IORedis from "ioredis";

/** REDIS_URL points at the Redis instance backing BullMQ; defaults to
 *  localhost for bare-metal dev. Only ever dialled when an ASYNC_* queue
 *  flag is turned on — the default (synchronous) deployment needs no Redis. */
export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/**
 * Shared Redis connection for BullMQ (queues + workers). Lazily created and
 * reused so producers and in-process workers share one client.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ: its blocking commands
 * (BRPOPLPUSH etc.) must not be aborted by ioredis's per-request retry cap.
 */
let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
    if (!connection) {
        connection = new IORedis(REDIS_URL, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });
    }
    return connection;
}

export async function closeRedisConnection(): Promise<void> {
    if (connection) {
        await connection.quit();
        connection = null;
    }
}
