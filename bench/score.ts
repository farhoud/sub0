// @sigil implements design/spike-harness.sigil SpikeHarness (issue matcher)
//
// A re-implementation of the unexported design-path matcher in
// sigil:scripts/slotted-benchmark/report.ts (analyze and matchesIssue, at the
// revision the harness was written against). sigil is not changed to export it.
// Keep the two in step; score_test.ts compares this one with sigil's renderReport.
import type { IssuePreflight, JsonObject } from "./sigil.ts";
import type { PlantedOutcome } from "./types.ts";

export interface LinkedEvidence {
  report: JsonObject;
  context: JsonObject;
}

export interface Score {
  planted: Record<string, PlantedOutcome>;
  /** Indices of findings that matched no planted problem. */
  extra: number[];
  matched: Record<string, number[]>;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Every planted problem unscored, for a pass whose check did not validate. */
export function unscored(issues: readonly IssuePreflight[]): Score {
  return { planted: Object.fromEntries(issues.map((i) => [i.id, "unscored"])), extra: [], matched: {} };
}

/**
 * Score planted problems from the harness's own linked check. A problem whose
 * anchor Facet or source was not read is N/A, not missed; a drifted problem is
 * N/A too. A finding counts for a problem only with the right class, law, a
 * witness claim on the problem's Facet, and the exact subject and object.
 */
export function scoreLinked(evidence: LinkedEvidence, issues: readonly IssuePreflight[]): Score {
  // Only sigil's design-path matcher is re-implemented; an implementation issue would need the other branch.
  if (issues.some((issue) => issue.implementation !== undefined)) throw new Error("implementation issues are not scored here");
  const { report, context } = evidence;
  const findings = array(report.findings).map(object).filter((f): f is JsonObject => f !== null);

  const claimFacet = new Map<string, string>();
  for (const unit of array(context.units)) {
    const row = object(unit);
    if (typeof row?.facet !== "string") continue;
    for (const asserted of array(row.asserted)) {
      const claim = object(asserted)?.claim;
      if (typeof claim === "string") claimFacet.set(claim, row.facet);
    }
  }

  const unreadFacets = new Set<string>();
  const unreadSources = new Set<string>();
  for (const entry of array(report.unread)) {
    const unread = object(entry);
    if (!unread) continue;
    const facets = array(unread.facets).filter((f): f is string => typeof f === "string");
    for (const facet of facets) unreadFacets.add(facet);
    if (facets.length === 0 && typeof unread.source === "string") unreadSources.add(unread.source);
  }
  for (const path of array(report.unreadFiles)) if (typeof path === "string") unreadSources.add(path);

  const planted: Record<string, PlantedOutcome> = {};
  const matched: Record<string, number[]> = {};
  const consumed = new Set<number>();
  for (const issue of issues) {
    if (issue.status !== "scorable") {
      planted[issue.id] = "n/a";
      continue;
    }
    if (
      issue.facets.some((f) => unreadFacets.has(f)) ||
      issue.anchors.some((a) => unreadSources.has(a.source))
    ) {
      planted[issue.id] = "n/a";
      continue;
    }
    const indices: number[] = [];
    findings.forEach((finding, index) => {
      if (matchesIssue(finding, issue, claimFacet)) {
        indices.push(index);
        consumed.add(index);
      }
    });
    planted[issue.id] = indices.length > 0 ? "found" : "missed";
    if (indices.length > 0) matched[issue.id] = indices;
  }
  return { planted, matched, extra: findings.map((_, i) => i).filter((i) => !consumed.has(i)) };
}

function matchesIssue(finding: JsonObject, issue: IssuePreflight, claimFacet: ReadonlyMap<string, string>): boolean {
  if (finding.class !== issue.findingClass || !issue.laws.includes(String(finding.law))) return false;
  const claims = array(finding.claims).filter((c): c is string => typeof c === "string");
  if (!claims.some((claim) => issue.facets.includes(claimFacet.get(claim) ?? ""))) return false;
  const evidence = issue.findingEvidence;
  if (evidence.subject === "cited-claim") {
    return claims.includes(String(finding.subject)) && finding.object === evidence.object;
  }
  // The right class and law with the wrong subject is an extra finding, not a match.
  return (finding.subject === evidence.subject && finding.object === evidence.object) ||
    (evidence.eitherDirection === true && finding.subject === evidence.object &&
      finding.object === evidence.subject);
}
