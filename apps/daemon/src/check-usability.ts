/**
 * Usability checks for generated HTML artifacts.
 *
 * Where `lintArtifact` (anti-slop) asks "does this look AI-generated?", this
 * checker asks "can the user actually use / hand off this artifact?" — the
 * cheapest slice of the Auto QA direction: dead or placeholder links and
 * non-functional buttons that turn a "looks done" artifact into one that
 * silently breaks when someone clicks it.
 *
 * Like the anti-slop linter, this is deliberately greppy: it does NOT parse
 * HTML. False positives are tolerable because every finding carries a snippet
 * the agent can verify, and the checks are anchored narrowly enough that real
 * deliverable links/buttons pass. The checks are independent — adding a new
 * one only means appending to `checkUsability`.
 *
 * Findings use the shared `LintFinding` shape so they flow through the same
 * registry, `renderFindingsForAgent` self-correction loop and UI badges as
 * every other artifact check.
 */

import type { LintFinding } from './lint-artifact.js';

// Anchor `href` values that render a link inert. Compared case-insensitively
// against the trimmed attribute value.
const DEAD_HREFS = new Set([
  '',
  '#',
  'javascript:void(0)',
  'javascript:void(0);',
  'javascript:;',
  'undefined',
  'null',
]);

// Obvious placeholder destinations a finished deliverable should not ship with.
const PLACEHOLDER_HREF_RE =
  /(?:^|\/\/|\.)example\.(?:com|org|net)\b|your[-_]?(?:domain|site|link|url|company)|link[-_]?here|#?\btodo\b|\blorem\b|\{\{[^}]*\}\}/i;

const ANCHOR_TAG_RE = /<a\b[^>]*>/gi;
const BUTTON_TAG_RE = /<button\b[^>]*>/gi;
const HREF_ATTR_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/i;
const ONCLICK_ATTR_RE = /\bonclick\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/i;

/**
 * Run all usability checks against an HTML artifact body. Returns at most one
 * finding per rule (with the first offending snippet) to avoid flooding the
 * agent when the same mistake repeats.
 */
export function checkUsability(rawHtml: unknown): LintFinding[] {
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) return [];
  const html = rawHtml;
  const findings: LintFinding[] = [];

  const deadLink = firstDeadLink(html);
  if (deadLink) {
    findings.push({
      severity: 'P1',
      id: 'dead-link',
      message: 'A link points nowhere (empty, "#", or a javascript: no-op), so clicking it does nothing.',
      fix: 'Give the anchor a real destination, or render it as plain text / a button if it is not meant to navigate.',
      snippet: clip(deadLink),
    });
  }

  const placeholderLink = firstPlaceholderLink(html);
  if (placeholderLink) {
    findings.push({
      severity: 'P2',
      id: 'placeholder-link',
      message: 'A link still uses a placeholder destination (example.com, your-domain, TODO, {{…}}, etc.).',
      fix: 'Replace the placeholder with the real URL before this is handed off.',
      snippet: clip(placeholderLink),
    });
  }

  const badButton = firstNonFunctionalButton(html);
  if (badButton) {
    findings.push({
      severity: 'P1',
      id: 'nonfunctional-button',
      message: 'A button has no working behavior: an empty onclick, or an href attribute (which <button> ignores).',
      fix: 'Wire the button to a handler / form submit, or use an <a> with a real href if it should navigate.',
      snippet: clip(badButton),
    });
  }

  return findings;
}

function firstDeadLink(html: string): string | null {
  return firstMatchingTag(html, ANCHOR_TAG_RE, (tag) => {
    const href = extractAttr(tag, HREF_ATTR_RE);
    return href !== null && DEAD_HREFS.has(href.trim().toLowerCase());
  });
}

function firstPlaceholderLink(html: string): string | null {
  return firstMatchingTag(html, ANCHOR_TAG_RE, (tag) => {
    const href = extractAttr(tag, HREF_ATTR_RE);
    return href !== null && PLACEHOLDER_HREF_RE.test(href);
  });
}

function firstNonFunctionalButton(html: string): string | null {
  return firstMatchingTag(html, BUTTON_TAG_RE, (tag) => {
    const onclick = extractAttr(tag, ONCLICK_ATTR_RE);
    const hasEmptyHandler = onclick !== null && onclick.trim().length === 0;
    const hasHref = extractAttr(tag, HREF_ATTR_RE) !== null;
    return hasEmptyHandler || hasHref;
  });
}

function firstMatchingTag(
  html: string,
  tagRe: RegExp,
  predicate: (tag: string) => boolean,
): string | null {
  tagRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[0] ?? '';
    if (predicate(tag)) return tag;
  }
  return null;
}

function extractAttr(tag: string, re: RegExp): string | null {
  const match = re.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function clip(s: string): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > 200 ? trimmed.slice(0, 197) + '…' : trimmed;
}
