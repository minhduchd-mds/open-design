import { describe, expect, it } from 'vitest';

import { runArtifactChecks } from '../src/artifact-checks.js';

const DOCTYPE = '<!doctype html><html><head>';

describe('runArtifactChecks', () => {
  it('returns no findings for empty / non-string input', () => {
    expect(runArtifactChecks('')).toEqual([]);
    expect(runArtifactChecks(undefined)).toEqual([]);
    expect(runArtifactChecks(null)).toEqual([]);
  });

  it('aggregates findings from multiple checks (anti-slop + usability)', () => {
    const html = `${DOCTYPE}<style>.cta { background: #6366f1; color: white; }</style></head>
      <body><a href="#">Dead</a></body></html>`;
    const ids = runArtifactChecks(html).map((f) => f.id);
    // anti-slop catches the default-indigo accent…
    expect(ids).toContain('ai-default-indigo');
    // …and usability catches the dead link, through the same pipeline.
    expect(ids).toContain('dead-link');
  });

  it('returns only anti-slop findings when usability is clean', () => {
    const html = `${DOCTYPE}<style>.cta { background: #6366f1; }</style></head>
      <body><a href="https://real.example.org/x">ok</a></body></html>`;
    const ids = runArtifactChecks(html).map((f) => f.id);
    expect(ids).toContain('ai-default-indigo');
    expect(ids).not.toContain('dead-link');
  });

  it('returns findings in the shared LintFinding shape', () => {
    const findings = runArtifactChecks('<a href="#">x</a>');
    for (const f of findings) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.message).toBe('string');
      expect(typeof f.fix).toBe('string');
      expect(['P0', 'P1', 'P2']).toContain(f.severity);
    }
  });
});
