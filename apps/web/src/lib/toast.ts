import { toast } from "sonner";

/**
 * Derive a human-readable message from an unknown thrown value.
 * Falls back to `fallback` when nothing useful can be extracted.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
    if (typeof err === "string" && err.trim()) return err;
    if (err instanceof Error && err.message.trim()) return err.message;
    if (
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string" &&
        (err as { message: string }).message.trim()
    ) {
        return (err as { message: string }).message;
    }
    return fallback;
}

/** Surface an error to the user as a toast. */
export function toastError(err: unknown, fallback?: string): void {
    toast.error(errorMessage(err, fallback));
}

/** Surface a success message to the user as a toast. */
export function toastSuccess(message: string): void {
    toast.success(message);
}
