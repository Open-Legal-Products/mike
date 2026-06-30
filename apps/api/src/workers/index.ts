import {
    createConversionWorker,
    stopConversionWorker,
} from "./conversionWorker";
import { closeConversionQueue } from "../lib/queue/conversionQueue";
import { closeRedisConnection } from "../lib/queue/connection";
import { logger } from "../lib/logger";

/**
 * Start the in-process BullMQ workers. Called from the server entrypoint only
 * when ASYNC_DOCUMENT_CONVERSION is enabled. Running workers in the API process
 * keeps the dev/single-node story simple; split them into a dedicated process
 * by calling this from a separate entrypoint when you need to scale them apart.
 */
export function startWorkers(): void {
    createConversionWorker();
    logger.info("[workers] document-conversion worker started");
}

export async function stopWorkers(): Promise<void> {
    await stopConversionWorker();
    await closeConversionQueue();
    await closeRedisConnection();
}
