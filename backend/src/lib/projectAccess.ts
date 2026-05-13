export function normalizeSharedWith(emails: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of emails) {
        if (typeof raw !== "string") continue;
        const e = raw.trim().toLowerCase();
        if (!e || seen.has(e)) continue;
        seen.add(e);
        result.push(e);
    }
    return result;
}

export function emailInSharedWith(
    sharedWith: string[],
    email: string | null | undefined,
): boolean {
    if (!email) return false;
    const normalized = email.toLowerCase();
    return sharedWith.some((e) => (e ?? "").toLowerCase() === normalized);
}
