import express from "express";

type ExpressHandler = (...args: unknown[]) => unknown;

const METHODS = [
    "all",
    "delete",
    "get",
    "head",
    "options",
    "patch",
    "post",
    "put",
    "use",
] as const;

function wrapHandler(handler: unknown): unknown {
    if (Array.isArray(handler)) return handler.map(wrapHandler);
    if (typeof handler !== "function") return handler;

    const fn = handler as ExpressHandler & { __mikeAsyncWrapped?: boolean };
    if (fn.__mikeAsyncWrapped || fn.length === 4) return fn;

    const wrapped = function wrappedAsyncHandler(
        this: unknown,
        req: unknown,
        res: unknown,
        next: (err?: unknown) => void,
    ) {
        try {
            const result = fn.call(this, req, res, next);
            if (
                result &&
                typeof (result as Promise<unknown>).then === "function"
            ) {
                return (result as Promise<unknown>).catch(next);
            }
            return result;
        } catch (err) {
            next(err);
            return undefined;
        }
    };

    Object.defineProperty(wrapped, "__mikeAsyncWrapped", { value: true });
    return wrapped;
}

function patchRouteMethods(proto: Record<string, unknown>): void {
    for (const method of METHODS) {
        const original = proto[method] as
            | ((...args: unknown[]) => unknown)
            | undefined;
        if (
            !original ||
            (original as { __mikeAsyncPatched?: boolean }).__mikeAsyncPatched
        ) {
            continue;
        }

        const patched = function patchedRouteMethod(
            this: unknown,
            ...args: unknown[]
        ) {
            return original.call(this, ...args.map(wrapHandler));
        };
        Object.defineProperty(patched, "__mikeAsyncPatched", { value: true });
        proto[method] = patched;
    }
}

patchRouteMethods(
    (
        express.Router() as unknown as {
            constructor: { prototype: Record<string, unknown> };
        }
    ).constructor.prototype,
);
patchRouteMethods(express.application as unknown as Record<string, unknown>);
