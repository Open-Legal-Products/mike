"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { Button } from "@/app/components/ui/button";
import {
  createConflictRecord,
  listConflictAuditEvents,
  listConflictRecords,
  listConflictSearches,
  reviewConflictSearch,
  runConflictSearch,
  type ConflictAuditEvent,
  type ConflictRecord,
  type ConflictSearch,
} from "@/app/lib/mikeApi";

function lines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const fieldClass =
  "w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-gray-400";
const cardClass =
  "rounded-2xl border border-white/80 bg-app-surface p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]";

export default function ConflictsPage() {
  const [records, setRecords] = useState<ConflictRecord[]>([]);
  const [searches, setSearches] = useState<ConflictSearch[]>([]);
  const [events, setEvents] = useState<ConflictAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recordForm, setRecordForm] = useState({
    clientName: "",
    matterName: "",
    parties: "",
    affiliates: "",
  });
  const [searchForm, setSearchForm] = useState({
    prospectiveClient: "",
    matterName: "",
    parties: "",
    affiliates: "",
  });
  const [result, setResult] = useState<{
    search: ConflictSearch;
    records: ConflictRecord[];
    disclaimer: string;
  } | null>(null);
  const [decision, setDecision] = useState<"cleared" | "conflict_found">(
    "cleared",
  );
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextRecords, nextSearches, nextEvents] = await Promise.all([
        listConflictRecords(),
        listConflictSearches(),
        listConflictAuditEvents(),
      ]);
      setRecords(nextRecords);
      setSearches(nextSearches);
      setEvents(nextEvents);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load conflicts data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const addRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createConflictRecord({
        clientName: recordForm.clientName,
        matterName: recordForm.matterName || undefined,
        parties: lines(recordForm.parties),
        affiliates: lines(recordForm.affiliates),
      });
      setRecordForm({
        clientName: "",
        matterName: "",
        parties: "",
        affiliates: "",
      });
      setShowRecordForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add record");
    } finally {
      setBusy(false);
    }
  };

  const performSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    setNotes("");
    try {
      const next = await runConflictSearch({
        prospectiveClient: searchForm.prospectiveClient || undefined,
        matterName: searchForm.matterName || undefined,
        parties: lines(searchForm.parties),
        affiliates: lines(searchForm.affiliates),
      });
      setResult(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run search");
    } finally {
      setBusy(false);
    }
  };

  const saveDecision = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const updated = await reviewConflictSearch(result.search.id, {
        status: decision,
        notes,
      });
      setResult({ ...result, search: updated });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader shrink>
        <div className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="h-5 w-5" /> Conflicts
        </div>
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-10 md:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>Human review required.</strong> Search results are potential
            matches only. Mike does not determine that a conflict is cleared or
            that a matter may proceed.
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
            <section className={cardClass}>
              <div className="mb-4 flex items-center gap-2">
                <Search className="h-4 w-4" />
                <h2 className="font-semibold">New conflicts check</h2>
              </div>
              <form
                onSubmit={performSearch}
                className="grid gap-3 sm:grid-cols-2"
              >
                <label className="text-sm">
                  Prospective client
                  <input
                    aria-label="Prospective client"
                    className={`${fieldClass} mt-1`}
                    value={searchForm.prospectiveClient}
                    onChange={(e) =>
                      setSearchForm({
                        ...searchForm,
                        prospectiveClient: e.target.value,
                      })
                    }
                    maxLength={200}
                  />
                </label>
                <label className="text-sm">
                  Matter name
                  <input
                    aria-label="Matter name"
                    className={`${fieldClass} mt-1`}
                    value={searchForm.matterName}
                    onChange={(e) =>
                      setSearchForm({
                        ...searchForm,
                        matterName: e.target.value,
                      })
                    }
                    maxLength={200}
                  />
                </label>
                <label className="text-sm">
                  Parties <span className="text-gray-500">(one per line)</span>
                  <textarea
                    aria-label="Parties"
                    className={`${fieldClass} mt-1 min-h-24`}
                    value={searchForm.parties}
                    onChange={(e) =>
                      setSearchForm({ ...searchForm, parties: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Affiliates{" "}
                  <span className="text-gray-500">(one per line)</span>
                  <textarea
                    aria-label="Affiliates"
                    className={`${fieldClass} mt-1 min-h-24`}
                    value={searchForm.affiliates}
                    onChange={(e) =>
                      setSearchForm({
                        ...searchForm,
                        affiliates: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="sm:col-span-2">
                  <Button disabled={busy} type="submit">
                    {busy ? <Loader2 className="animate-spin" /> : <Search />}{" "}
                    Search restricted records
                  </Button>
                </div>
              </form>
            </section>
            <section className={cardClass}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Restricted records</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRecordForm((value) => !value)}
                >
                  <Plus /> Add
                </Button>
              </div>
              {showRecordForm && (
                <form onSubmit={addRecord} className="mb-4 space-y-2">
                  <input
                    required
                    aria-label="Record client"
                    placeholder="Client name"
                    className={fieldClass}
                    value={recordForm.clientName}
                    onChange={(e) =>
                      setRecordForm({
                        ...recordForm,
                        clientName: e.target.value,
                      })
                    }
                    maxLength={200}
                  />
                  <input
                    aria-label="Record matter"
                    placeholder="Matter name"
                    className={fieldClass}
                    value={recordForm.matterName}
                    onChange={(e) =>
                      setRecordForm({
                        ...recordForm,
                        matterName: e.target.value,
                      })
                    }
                    maxLength={200}
                  />
                  <textarea
                    aria-label="Record parties"
                    placeholder="Parties, one per line"
                    className={fieldClass}
                    value={recordForm.parties}
                    onChange={(e) =>
                      setRecordForm({ ...recordForm, parties: e.target.value })
                    }
                  />
                  <textarea
                    aria-label="Record affiliates"
                    placeholder="Affiliates, one per line"
                    className={fieldClass}
                    value={recordForm.affiliates}
                    onChange={(e) =>
                      setRecordForm({
                        ...recordForm,
                        affiliates: e.target.value,
                      })
                    }
                  />
                  <Button size="sm" disabled={busy} type="submit">
                    Save restricted record
                  </Button>
                </form>
              )}
              {loading ? (
                <Loader2 className="animate-spin text-gray-400" />
              ) : records.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No restricted records yet.
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {records.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-xl border border-gray-100 bg-white/60 p-3 text-sm"
                    >
                      <div className="font-medium">{record.client_name}</div>
                      <div className="text-gray-500">
                        {record.matter_name || "No matter name"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {record.parties.length} parties ·{" "}
                        {record.affiliates.length} affiliates
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {result && (
            <section className={cardClass} aria-label="Search results">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  Potential matches ({result.records.length})
                </h2>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                  Pending human review
                </span>
              </div>
              <p className="mb-4 text-sm text-gray-600">{result.disclaimer}</p>
              {result.records.length === 0 ? (
                <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
                  No matches were found in the current restricted records. This
                  is not an automatic clearance.
                </p>
              ) : (
                <div className="mb-4 grid gap-2 sm:grid-cols-2">
                  {result.records.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-sm"
                    >
                      <div className="font-medium">{record.client_name}</div>
                      <div>{record.matter_name || "No matter name"}</div>
                      <div className="mt-1 text-xs text-amber-800">
                        Matched: {record.matched_fields?.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {result.search.status === "pending_review" ? (
                <div className="rounded-xl border border-gray-200 p-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    Reviewer decision
                  </h3>
                  <div className="mb-3 flex gap-4 text-sm">
                    <label>
                      <input
                        type="radio"
                        checked={decision === "cleared"}
                        onChange={() => setDecision("cleared")}
                      />{" "}
                      Cleared by reviewer
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={decision === "conflict_found"}
                        onChange={() => setDecision("conflict_found")}
                      />{" "}
                      Conflict found
                    </label>
                  </div>
                  <textarea
                    aria-label="Review rationale"
                    required
                    placeholder="Document the reviewer’s rationale"
                    className={`${fieldClass} mb-3`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={2000}
                  />
                  <Button
                    onClick={saveDecision}
                    disabled={busy || !notes.trim()}
                  >
                    Record human decision
                  </Button>
                </div>
              ) : (
                <div
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm ${result.search.status === "cleared" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
                >
                  {result.search.status === "cleared" ? (
                    <CheckCircle2 />
                  ) : (
                    <AlertTriangle />
                  )}
                  <div>
                    <strong>
                      {result.search.status === "cleared"
                        ? "Cleared by reviewer"
                        : "Conflict found by reviewer"}
                    </strong>
                    <p>{result.search.reviewer_notes}</p>
                  </div>
                </div>
              )}
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className={cardClass}>
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4" />
                <h2 className="font-semibold">Review history</h2>
              </div>
              {searches.length === 0 ? (
                <p className="text-sm text-gray-500">No searches yet.</p>
              ) : (
                <div className="space-y-2">
                  {searches.slice(0, 10).map((search) => (
                    <div
                      key={search.id}
                      className="rounded-xl border border-gray-100 p-3 text-sm"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">
                          {search.search_input.prospectiveClient ||
                            search.search_input.parties[0] ||
                            "Structured search"}
                        </span>
                        <span>{search.status.replaceAll("_", " ")}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {search.result_count} potential matches ·{" "}
                        {formatDate(search.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className={cardClass}>
              <h2 className="mb-3 font-semibold">Conflicts audit trail</h2>
              {events.length === 0 ? (
                <p className="text-sm text-gray-500">No audit events yet.</p>
              ) : (
                <div className="space-y-2">
                  {events.slice(0, 10).map((event) => (
                    <div
                      key={event.id}
                      className="flex justify-between rounded-xl border border-gray-100 p-3 text-sm"
                    >
                      <span>{event.action.replaceAll(".", " ")}</span>
                      <span className="text-xs text-gray-500">
                        {formatDate(event.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
