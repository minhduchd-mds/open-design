import { describe, expect, it } from 'vitest';

import { checkUsability } from '../src/check-usability.js';
import type { LintFinding } from '../src/lint-artifact.js';

function ids(findings: LintFinding[]): string[] {
  return findings.map((f) => f.id);
}

describe('checkUsability — dead links', () => {
  it('flags an empty href', () => {
    expect(ids(checkUsability('<a href="">Home</a>'))).toContain('dead-link');
  });

  it('flags a "#" href', () => {
    expect(ids(checkUsability('<a class="nav" href="#">Docs</a>'))).toContain('dead-link');
  });

  it('flags a javascript: no-op href', () => {
    expect(ids(checkUsability('<a href="javascript:void(0)">Click</a>'))).toContain('dead-link');
  });

  it('does not flag a real destination', () => {
    expect(ids(checkUsability('<a href="https://example.org/real">Go</a>'))).not.toContain('dead-link');
    expect(ids(checkUsability('<a href="/pricing">Pricing</a>'))).not.toContain('dead-link');
  });

  it('does not flag an in-page anchor with a target', () => {
    expect(ids(checkUsability('<a href="#features">Features</a>'))).not.toContain('dead-link');
  });
});

describe('checkUsability — placeholder links', () => {
  it('flags an example.com destination', () => {
    expect(ids(checkUsability('<a href="https://example.com/buy">Buy</a>'))).toContain('placeholder-link');
  });

  it('flags a your-domain placeholder', () => {
    expect(ids(checkUsability('<a href="https://your-domain.com">Site</a>'))).toContain('placeholder-link');
  });

  it('flags an unrendered template token', () => {
    expect(ids(checkUsability('<a href="{{ctaUrl}}">CTA</a>'))).toContain('placeholder-link');
  });

  it('does not flag a normal absolute URL', () => {
    expect(ids(checkUsability('<a href="https://openai.com">x</a>'))).not.toContain('placeholder-link');
  });
});

describe('checkUsability — non-functional buttons', () => {
  it('flags an empty onclick handler', () => {
    expect(ids(checkUsability('<button onclick="">Save</button>'))).toContain('nonfunctional-button');
  });

  it('flags a <button> with an href attribute', () => {
    expect(ids(checkUsability('<button href="/next">Next</button>'))).toContain('nonfunctional-button');
  });

  it('does not flag a wired button', () => {
    expect(ids(checkUsability('<button onclick="save()">Save</button>'))).not.toContain('nonfunctional-button');
  });

  it('does not flag a submit button', () => {
    expect(ids(checkUsability('<button type="submit">Send</button>'))).not.toContain('nonfunctional-button');
  });
});

describe('checkUsability — guards and shape', () => {
  it('returns no findings for empty / non-string input', () => {
    expect(checkUsability('')).toEqual([]);
    expect(checkUsability(undefined)).toEqual([]);
    expect(checkUsability(null)).toEqual([]);
    expect(checkUsability(42)).toEqual([]);
  });

  it('returns at most one finding per rule even with repeats', () => {
    const html = '<a href="#">a</a><a href="#">b</a><a href="#">c</a>';
    const dead = checkUsability(html).filter((f) => f.id === 'dead-link');
    expect(dead).toHaveLength(1);
  });

  it('produces findings carrying a snippet and a fix', () => {
    const findings = checkUsability('<a href="#">Home</a>');
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;
    expect(finding.snippet).toBeTruthy();
    expect(finding.fix).toBeTruthy();
    expect(['P0', 'P1', 'P2']).toContain(finding.severity);
  });
});
