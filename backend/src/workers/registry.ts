import {
    createConversionWorker,
    stopConversionWorker,
} from "./conversionWorker";
import {
    createExtractionWorker,
    stopExtractionWorker,
} from "./extractionWorker";
import {
    createAppJobsWorker,
    stopAppJobsWorker,
} from "./appJobsWorker";
import { closeConversionQueue } from "../lib/queue/conversionQueue";
import { closeExtractionQueue } from "../lib/queue/extractionQueue";
import { closeAppJobsQueue } from "../lib/queue/appJobsQueue";
import { redisEnabled } from "../lib/dbq/driver";

/**
 * One background queue's lifecycle, described declaratively. `startWorkers()` /
 * `stopWorkers()` iterate this list, so the server entrypoint and shutdown path
 * never need to know which queues exist.
 */
export interface WorkerDescriptor {
    /** Log/identify label. */
    name: string;
    /** Whether this worker should run in the current configuration. */
    enabled: () => boolean;
    /** Start the in-process BullMQ worker (idempotent). */
    create: () => void;
    /** Gracefully stop the worker. */
    stop: () => Promise<void>;
    /** Close the worker's producer-side queue. */
    closeQueue: () => Promise<void>;
}

/**
 * To add a background queue: implement its queue (`lib/queue/<name>Queue.ts`)
 * and worker (`workers/<name>Worker.ts`), then append one descriptor here.
 * `startWorkers()`, `stopWorkers()`, `anyWorkerEnabled()`, and the server
 * entrypoint all pick it up with no further change.
 */
export const WORKER_REGISTRY: WorkerDescriptor[] = [
    {
        name: "document-conversion",
        enabled: () =>
            process.env.ASYNC_DOCUMENT_CONVERSION === "true" && redisEnabled(),
        create: createConversionWorker,
        stop: stopConversionWorker,
        closeQueue: closeConversionQueue,
    },
    {
        name: "tabular-extraction",
        enabled: () =>
            process.env.ASYNC_TABULAR_EXTRACTION === "true" && redisEnabled(),
        create: createExtractionWorker,
        stop: stopExtractionWorker,
        closeQueue: closeExtractionQueue,
    },
    {
        // Fast delivery for the DB-backed registry jobs (outbox pattern) —
        // only meaningful when Redis is configured; the DB poller carries
        // those jobs otherwise.
        name: "app-jobs",
        enabled: redisEnabled,
        create: () => void createAppJobsWorker(),
        stop: stopAppJobsWorker,
        closeQueue: closeAppJobsQueue,
    },
];
