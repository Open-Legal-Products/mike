import { AsyncLocalStorage } from "node:async_hooks";

// Ambient per-request / per-job context, carried implicitly through the async
// call stack via AsyncLocalStorage so that EVERY log line can be stamped with
// the request id (and, on workers, the job id / queue) without threading those
// values through every function signature or touching a single existing log
// call site. The logger's pino mixin (see lib/logger.ts) reads this store.
//
// AsyncLocalStorage is the Node primitive for exactly this: a value `run()` into
// scope is visible to all synchronous AND asynchronous work spawned inside that
// scope, and invisible outside it — which is why a log emitted outside any
// request carries no request_id.

export interface RequestContextStore {
    /** The request id pino-http minted and echoed on `x-request-id`. */
    requestId?: string;
    /** BullMQ job id — set while a worker processes a job. */
    jobId?: string;
    /** BullMQ queue name — set while a worker processes a job. */
    queue?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Run `fn` with `store` as the ambient request/job context. */
export function runWithRequestContext<T>(
    store: RequestContextStore,
    fn: () => T,
): T {
    return storage.run(store, fn);
}

/** The active context, or `undefined` when running outside any scope. */
export function getRequestContext(): RequestContextStore | undefined {
    return storage.getStore();
}
