export type CaseType = "deterministic" | "citation" | "judged";

export interface EvalCase {
  id: string;
  type: CaseType;
  description: string;
  /** Include in the fast subset used by the Stop hook (max 5). */
  smoke?: boolean;
  /** Reason this case is not yet runnable (reported, never run, never passes silently in CI reports). */
  pending?: string;
  /** Harness self-test: the case is expected to FAIL; a pass is reported as a failure. */
  expect_failure?: boolean;

  /** citation + judged cases: the text under test (later: produced by running a workflow on a fixture). */
  input?: { text?: string };

  /** deterministic cases: an HTTP request with content assertions. */
  request?: {
    url: string;
    /** "companies_house" adds Basic auth from COMPANIES_HOUSE_API_KEY (skipped when unset). */
    auth?: "companies_house";
    status?: number;
    contains?: string[];
  };

  /** judged cases: rubric path relative to evals/, and minimum acceptable score. */
  rubric?: string;
  min_score?: number;
}

export type ResultStatus = "pass" | "fail" | "skip" | "pending";

export interface CaseResult {
  id: string;
  type: CaseType;
  status: ResultStatus;
  detail: string;
  score?: number;
}
