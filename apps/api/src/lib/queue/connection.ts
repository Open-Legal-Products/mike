import IORedis from "ioredis";
import { env } from "../env";

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
        connection = new IORedis(env.REDIS_URL, {
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
