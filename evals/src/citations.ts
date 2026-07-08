/**
 * Citation-resolution HARD GATE (BUILD_PLAN §4.2).
 *
 * Every statutory reference extracted from a text must resolve against the live
 * legislation.gov.uk API. Any citation that cannot be resolved is a failure.
 *
 * Case-law neutral citations (e.g. [2024] UKSC 12) currently have NO permitted
 * verification source: Find Case Law integration is deferred pending The National
 * Archives' computational-use licence, and BAILII must never be used. Per
 * CLAUDE.md hard rule 5 an unverifiable citation is a bug, so any neutral
 * citation found in output FAILS the gate until a verification source exists.
 */

const LEGISLATION_BASE = "https://www.legislation.gov.uk";
const USER_AGENT = "JessicaOS-evals/0.1 (+https://github.com/Sloth-ninja/JessicaOSS)";

export interface Citation {
  raw: string;
  kind: "statute-section" | "act" | "si" | "neutral-case";
  title?: string;
  year?: string;
  number?: string;
  section?: string;
}

export interface ResolutionFailure {
  citation: Citation;
  reason: string;
}

const ACT_TITLE = "([A-Z][A-Za-z()'\\u2019]*(?:\\s+[A-Za-z()'\\u2019]+)*?\\s+Act\\s+(\\d{4}))";

export function extractCitations(text: string): Citation[] {
  const found = new Map<string, Citation>();
  const add = (c: Citation) => {
    const key = `${c.kind}|${c.title ?? ""}|${c.year ?? ""}|${c.number ?? ""}|${c.section ?? ""}`;
    if (!found.has(key)) found.set(key, c);
  };

  // "s.994 Companies Act 2006" / "section 994 of the Companies Act 2006"
  const sectionFirst = new RegExp(
    `\\b(?:s\\.?|ss\\.?|section)\\s*(\\d+[A-Z]*)\\s+(?:of\\s+the\\s+)?${ACT_TITLE}`,
    "g",
  );
  for (const m of text.matchAll(sectionFirst)) {
    add({ raw: m[0], kind: "statute-section", section: m[1], title: m[2], year: m[3] });
  }

  // "Companies Act 2006, s 994"
  const actFirst = new RegExp(`\\b${ACT_TITLE}\\s*,\\s*(?:s\\.?|section)\\s*(\\d+[A-Z]*)`, "g");
  for (const m of text.matchAll(actFirst)) {
    add({ raw: m[0], kind: "statute-section", title: m[1], year: m[2], section: m[3] });
  }

  // Bare Act references ("the Employment Rights Act 1996") — resolved at Act level
  for (const m of text.matchAll(new RegExp(`\\b${ACT_TITLE}\\b`, "g"))) {
    const coveredBySection = [...found.values()].some(
      (c) => c.kind === "statute-section" && c.title === m[1],
    );
    if (!coveredBySection) add({ raw: m[0], kind: "act", title: m[1], year: m[2] });
  }

  // Statutory instruments by number: "SI 2006/246"
  for (const m of text.matchAll(/\bS\.?I\.?\s+(\d{4})\/(\d+)\b/g)) {
    add({ raw: m[0], kind: "si", year: m[1], number: m[2] });
  }

  // Neutral case citations: [2024] UKSC 12, [2023] EWCA Civ 1, [2022] EWHC 123 (Ch)
  for (const m of text.matchAll(
    /\[(\d{4})\]\s+(UKSC|UKPC|EWCA\s+(?:Civ|Crim)|EWHC|UKUT|UKFTT|EAT|UKEAT)\s+\d+/g,
  )) {
    add({ raw: m[0], kind: "neutral-case", year: m[1] });
  }

  return [...found.values()];
}

async function fetchLeg(path: string): Promise<Response> {
  return fetch(`${LEGISLATION_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
}

const titleUriCache = new Map<string, string | null>();

/** Resolve an Act title + year to its canonical /{type}/{year}/{number} path via the Atom title feed. */
async function resolveActUri(title: string, year: string): Promise<string | null> {
  const cacheKey = `${title}|${year}`;
  const cached = titleUriCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Search across primary-legislation types; ukpga covers the overwhelming majority.
  for (const type of ["ukpga", "asp", "asc", "ukla"]) {
    const res = await fetchLeg(`/${type}/data.feed?title=${encodeURIComponent(title)}`);
    if (!res.ok) continue;
    const atom = await res.text();
    // Entry ids look like: http://www.legislation.gov.uk/id/ukpga/2006/46
    const idRe = new RegExp(`/id/(${type})/(${year})/(\\d+)`, "g");
    const m = idRe.exec(atom);
    if (m) {
      const uri = `/${m[1]}/${m[2]}/${m[3]}`;
      titleUriCache.set(cacheKey, uri);
      return uri;
    }
  }
  titleUriCache.set(cacheKey, null);
  return null;
}

async function resolveOne(c: Citation): Promise<string | null> {
  switch (c.kind) {
    case "neutral-case":
      return (
        `case-law citation "${c.raw}" cannot be verified: no permitted case-law source is ` +
        `integrated (Find Case Law deferred pending TNA licence; BAILII prohibited). ` +
        `Product prompts must not emit case-law citations yet.`
      );
    case "si": {
      const res = await fetchLeg(`/uksi/${c.year}/${c.number}/data.xml`);
      return res.ok ? null : `SI ${c.year}/${c.number} not found on legislation.gov.uk (HTTP ${res.status})`;
    }
    case "act":
    case "statute-section": {
      const uri = await resolveActUri(c.title!, c.year!);
      if (!uri) return `"${c.title}" not found on legislation.gov.uk title search`;
      if (c.kind === "act") return null;
      const res = await fetchLeg(`${uri}/section/${c.section}/data.xml`);
      return res.ok
        ? null
        : `s.${c.section} of ${c.title} does not resolve (${uri}/section/${c.section}, HTTP ${res.status})`;
    }
  }
}

export async function resolveCitations(text: string): Promise<{
  citations: Citation[];
  failures: ResolutionFailure[];
}> {
  const citations = extractCitations(text);
  const failures: ResolutionFailure[] = [];
  for (const c of citations) {
    const reason = await resolveOne(c);
    if (reason) failures.push({ citation: c, reason });
  }
  return { citations, failures };
}
