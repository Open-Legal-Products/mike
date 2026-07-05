/**
 * Full-screen centered spinner used by the auth/MFA gates and route loading
 * states. Kept as a single component so every gate renders byte-identical markup
 * at the same DOM position — divergent copies caused a React hydration mismatch
 * (server rendered one class set, client another) on first paint.
 */
export function FullScreenLoader() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-gray-50/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
        </div>
    );
}
