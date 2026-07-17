export const ROSS_DATA_BOUNDARY_VALUE = "synthetic-or-non-confidential";
export const ROSS_DATA_BOUNDARY_HEADER = "X-ROSS-Data-Boundary";
export const ROSS_DATA_BOUNDARY_EVENT = "ross-data-boundary-changed";
export const ROSS_DATA_BOUNDARY_VERSION =
    process.env.NEXT_PUBLIC_ROSS_DATA_BOUNDARY_VERSION ?? "2026-07-16";
export const ROSS_HOSTED_MODE =
    process.env.NEXT_PUBLIC_ROSS_HOSTED_MODE ?? "self-hosted";

const storageKey = `ross:data-boundary:${ROSS_DATA_BOUNDARY_VERSION}`;

export function hasDataBoundaryAcknowledgement() {
    if (ROSS_HOSTED_MODE !== "controlled-beta") return true;
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === ROSS_DATA_BOUNDARY_VALUE;
}

export function acknowledgeDataBoundary() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, ROSS_DATA_BOUNDARY_VALUE);
    window.dispatchEvent(new Event(ROSS_DATA_BOUNDARY_EVENT));
}

export function dataBoundaryHeaders(): Record<string, string> {
    return hasDataBoundaryAcknowledgement()
        ? { [ROSS_DATA_BOUNDARY_HEADER]: ROSS_DATA_BOUNDARY_VALUE }
        : {};
}
