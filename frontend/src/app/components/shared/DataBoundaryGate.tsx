"use client";

import { useState, useSyncExternalStore } from "react";
import {
    ROSS_DATA_BOUNDARY_EVENT,
    ROSS_DATA_BOUNDARY_VERSION,
    ROSS_HOSTED_MODE,
    acknowledgeDataBoundary,
    hasDataBoundaryAcknowledgement,
} from "@/app/lib/dataBoundary";
import { recordDataBoundaryAcknowledgement } from "@/app/lib/mikeApi";

function subscribe(callback: () => void) {
    window.addEventListener(ROSS_DATA_BOUNDARY_EVENT, callback);
    window.addEventListener("storage", callback);
    return () => {
        window.removeEventListener(ROSS_DATA_BOUNDARY_EVENT, callback);
        window.removeEventListener("storage", callback);
    };
}

export function DataBoundaryGate({ children }: { children: React.ReactNode }) {
    const acknowledged = useSyncExternalStore(
        subscribe,
        hasDataBoundaryAcknowledgement,
        () => ROSS_HOSTED_MODE !== "controlled-beta",
    );
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (acknowledged) return children;

    return (
        <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-5 py-12 text-slate-900">
            <section
                aria-labelledby="data-boundary-title"
                className="w-full max-w-2xl rounded-2xl bg-white p-7 shadow-2xl sm:p-10"
            >
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">
                    Controlled beta · policy {ROSS_DATA_BOUNDARY_VERSION}
                </p>
                <h1
                    id="data-boundary-title"
                    className="mt-3 font-serif text-4xl"
                >
                    Use only synthetic or non-confidential material
                </h1>
                <p className="mt-5 leading-7 text-slate-600">
                    ROSS is not approved for privileged, confidential,
                    proprietary, regulated, or real client material. This
                    boundary applies to prompts, uploads, filenames,
                    screenshots, support requests, and connector activity.
                </p>
                <label className="mt-7 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                        className="mt-1 h-4 w-4"
                    />
                    <span className="text-sm leading-6">
                        I understand and will submit only synthetic or
                        affirmatively non-confidential material during this
                        controlled beta.
                    </span>
                </label>
                <button
                    type="button"
                    disabled={!confirmed || saving}
                    onClick={async () => {
                        setSaving(true);
                        setError(null);
                        try {
                            await recordDataBoundaryAcknowledgement({
                                version: ROSS_DATA_BOUNDARY_VERSION,
                                acknowledgement:
                                    "synthetic-or-non-confidential",
                            });
                            acknowledgeDataBoundary();
                        } catch {
                            setError(
                                "ROSS could not record the acknowledgement. Please try again.",
                            );
                            setSaving(false);
                        }
                    }}
                    className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {saving
                        ? "Recording acknowledgement…"
                        : "Enter controlled beta"}
                </button>
                {error && (
                    <p role="alert" className="mt-4 text-sm text-red-700">
                        {error}
                    </p>
                )}
            </section>
        </main>
    );
}
