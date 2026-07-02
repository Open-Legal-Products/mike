import { env } from "../lib/env";
import {
    createConversionWorker,
    stopConversionWorker,
} from "./conversionWorker";
import {
    createExtractionWorker,
    stopExtractionWorker,
} from "./extractionWorker";
import {
    createEmbeddingWorker,
    stopEmbeddingWorker,
} from "./embeddingWorker";
import { closeConversionQueue } from "../lib/queue/conversionQueue";
import { closeExtractionQueue } from "../lib/queue/extractionQueue";
import { closeEmbeddingQueue } from "../lib/queue/embeddingQueue";

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
        enabled: () => env.ASYNC_DOCUMENT_CONVERSION === "true",
        create: createConversionWorker,
        stop: stopConversionWorker,
        closeQueue: closeConversionQueue,
    },
    {
        name: "tabular-extraction",
        enabled: () => env.ASYNC_TABULAR_EXTRACTION === "true",
        create: createExtractionWorker,
        stop: stopExtractionWorker,
        closeQueue: closeExtractionQueue,
    },
    {
        name: "document-embedding",
        enabled: () => env.ASYNC_EMBEDDING === "true",
        create: createEmbeddingWorker,
        stop: stopEmbeddingWorker,
        closeQueue: closeEmbeddingQueue,
    },
];
