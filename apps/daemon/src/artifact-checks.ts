/**
 * Artifact check registry — the single entry point for "Auto QA" checks that
 * run against a generated artifact.
 *
 * Historically the artifact save / lint endpoints called `lintArtifact`
 * directly. As Auto QA grows (usability, layout, brand-consistency, …) we want
 * one place that runs every check and concatenates their findings, so each new
 * check is just an entry in `CHECKS` rather than another call site to wire up.
 *
 * Every check produces the shared `LintFinding` shape, so all findings — no
 * matter which check emitted them — flow through the same
 * `renderFindingsForAgent` self-correction loop and the same UI badges.
 *
 * Design notes:
 * - Checks run in registration order and their findings are concatenated; the
 *   order only affects how findings are listed, not severity (that is sorted
 *   downstream in `renderFindingsForAgent`).
 * - A check that throws must not take down the whole pipeline — each is run in
 *   isolation and a thrown error is swallowed (a broken check should degrade to
 *   "found nothing", never block an artifact save).
 * - Only deterministic, synchronous checks live here for now. Render- and
 *   model-based checks (layout, visual) will register through the same shape
 *   once their async plumbing lands.
 */

import { lintArtifact, type LintFinding } from './lint-artifact.js';
import { checkUsability } from './check-usability.js';

export interface ArtifactCheck {
  /** Stable identifier, used for logging / future enable-disable wiring. */
  id: string;
  /** Run the check against the artifact HTML body. */
  run: (html: string) => LintFinding[];
}

const CHECKS: ArtifactCheck[] = [
  { id: 'anti-slop', run: lintArtifact },
  { id: 'usability', run: checkUsability },
];

/**
 * Run every registered artifact check against an HTML body and return the
 * concatenated findings. Non-string / empty input yields no findings, matching
 * the individual checks' own guards.
 */
export function runArtifactChecks(rawHtml: unknown): LintFinding[] {
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) return [];
  const findings: LintFinding[] = [];
  for (const check of CHECKS) {
    try {
      findings.push(...check.run(rawHtml));
    } catch {
      // A single misbehaving check must never block an artifact save; treat a
      // thrown check as having found nothing.
    }
  }
  return findings;
}
