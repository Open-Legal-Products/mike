import type { NextRequest } from "next/server";

export type NextFunction = (err?: unknown) => void;

export type UploadedFile = {
    fieldname: string;
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
};

export type RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
) => unknown | Promise<unknown>;

export type ErrorRequestHandler = (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
) => unknown | Promise<unknown>;

export class Request {
    body: any;
    file?: UploadedFile;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    headers: Record<string, string>;

    constructor(
        public readonly raw: NextRequest,
        options: {
            body: any;
            params: Record<string, string>;
            query: Record<string, string | string[]>;
        },
    ) {
        this.body = options.body;
        this.params = options.params;
        this.query = options.query;
        this.headers = {};
        raw.headers.forEach((value, key) => {
            this.headers[key.toLowerCase()] = value;
        });
    }
}

export class Response {
    locals: Record<string, unknown> = {};
    statusCode = 200;
    headersSent = false;

    private readonly headers = new Headers();
    private body: BodyInit | null = null;
    private stream?: TransformStream<Uint8Array, Uint8Array>;
    private writer?: WritableStreamDefaultWriter<Uint8Array>;
    private writeChain: Promise<unknown> = Promise.resolve();
    private streamResponse?: globalThis.Response;
    private resolveStreamResponse?: (response: globalThis.Response) => void;
    private readonly streamResponsePromise =
        new Promise<globalThis.Response>((resolve) => {
            this.resolveStreamResponse = resolve;
        });

    status(code: number): this {
        this.statusCode = code;
        return this;
    }

    setHeader(name: string, value: string | number | readonly string[]): this {
        if (Array.isArray(value)) {
            this.headers.set(name, value.join(", "));
        } else {
            this.headers.set(name, String(value));
        }
        return this;
    }

    getHeader(name: string): string | null {
        return this.headers.get(name);
    }

    json(value: unknown): this {
        if (!this.headers.has("Content-Type")) {
            this.headers.set("Content-Type", "application/json");
        }
        this.body = JSON.stringify(value);
        this.headersSent = true;
        return this;
    }

    send(value?: unknown): this {
        if (value === undefined || value === null) {
            this.body = null;
        } else if (Buffer.isBuffer(value)) {
            this.body = value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
            ) as ArrayBuffer;
        } else if (value instanceof Uint8Array) {
            this.body = value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
            ) as ArrayBuffer;
        } else if (value instanceof ArrayBuffer) {
            this.body = value;
        } else if (typeof value === "string") {
            this.body = value;
        } else {
            return this.json(value);
        }
        this.headersSent = true;
        return this;
    }

    write(chunk: string | Uint8Array): boolean {
        this.ensureStream();
        const data =
            typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        this.writeChain = this.writeChain.then(() => this.writer!.write(data));
        return true;
    }

    flushHeaders(): void {
        this.ensureStream();
        this.headersSent = true;
        this.resolveStreamResponse?.(this.streamResponse!);
    }

    end(chunk?: string | Uint8Array): this {
        if (chunk !== undefined) {
            this.write(chunk);
        }
        if (this.writer) {
            this.writeChain = this.writeChain.finally(() => this.writer!.close());
        } else {
            this.headersSent = true;
        }
        return this;
    }

    async waitForStreamResponse(): Promise<globalThis.Response> {
        return this.streamResponsePromise;
    }

    toNextResponse(): globalThis.Response {
        if (this.streamResponse) return this.streamResponse;
        return new globalThis.Response(this.body, {
            status: this.statusCode,
            headers: this.headers,
        });
    }

    private ensureStream(): void {
        if (this.stream) return;
        this.stream = new TransformStream<Uint8Array, Uint8Array>();
        this.writer = this.stream.writable.getWriter();
        this.streamResponse = new globalThis.Response(this.stream.readable, {
            status: this.statusCode,
            headers: this.headers,
        });
    }
}

export type Route = {
    method: string;
    path: string;
    handlers: RequestHandler[];
};

class CompatRouter {
    routes: Route[] = [];
    errorHandlers: ErrorRequestHandler[] = [];

    constructor(_options?: unknown) {}

    get(path: string, ...handlers: RequestHandler[]): void {
        this.add("GET", path, handlers);
    }

    post(path: string, ...handlers: RequestHandler[]): void {
        this.add("POST", path, handlers);
    }

    put(path: string, ...handlers: RequestHandler[]): void {
        this.add("PUT", path, handlers);
    }

    patch(path: string, ...handlers: RequestHandler[]): void {
        this.add("PATCH", path, handlers);
    }

    delete(path: string, ...handlers: RequestHandler[]): void {
        this.add("DELETE", path, handlers);
    }

    use(...handlers: ErrorRequestHandler[]): void {
        this.errorHandlers.push(...handlers);
    }

    private add(method: string, path: string, handlers: RequestHandler[]): void {
        this.routes.push({ method, path, handlers });
    }
}

export type Router = CompatRouter;

export function Router(options?: unknown): CompatRouter {
    return new CompatRouter(options);
}

export function createQuery(
    searchParams: URLSearchParams,
): Record<string, string | string[]> {
    const query: Record<string, string | string[]> = {};
    for (const [key, value] of searchParams.entries()) {
        const existing = query[key];
        if (Array.isArray(existing)) {
            existing.push(value);
        } else if (existing !== undefined) {
            query[key] = [existing, value];
        } else {
            query[key] = value;
        }
    }
    return query;
}
