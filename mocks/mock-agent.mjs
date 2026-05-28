#!/usr/bin/env node
/**
 * mock-agent.mjs — pretends to be one of OD's supported agent CLIs
 * (claude / opencode / codex / deepseek / qwen / grok) by streaming a
 * pre-recorded session in that CLI's native stdout protocol. Zero LLM
 * tokens.
 *
 * Usage (driven by the wrappers in bin/, not directly):
 *   ./mock-agent.mjs --as opencode [--no-delay] [--report-file <path>]
 *
 * Recording selection — see lib/recording-picker.mjs. The wrappers
 * announce the picked trace id on stderr.
 *
 * Trace data: ./recordings/<trace-id>.jsonl (anonymized exports from
 * Langfuse). Index: ./recordings/index.json.
 */

import { pickRecording, readRecording } from './lib/recording-picker.mjs';
import { renderAsOpencode }    from './lib/format-opencode.mjs';
import { renderAsCodex }       from './lib/format-codex.mjs';
import { renderAsClaude }      from './lib/format-claude.mjs';
import { renderAsGemini }      from './lib/format-gemini.mjs';
import { renderAsCursorAgent } from './lib/format-cursor-agent.mjs';
import { renderAsPlain }       from './lib/format-plain.mjs';
import { runAcpServer }        from './lib/format-acp.mjs';

function parseArgs(argv) {
  const opts = { as: null, noDelay: false, reportFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--as' || a === '--agent') { opts.as = argv[++i]; continue; }
    if (a === '--no-delay')              { opts.noDelay = true; continue; }
    if (a === '--report-file')           { opts.reportFile = argv[++i]; continue; }
    // We deliberately ignore everything else — model flags, permission
    // modes, output formats — the mock doesn't honor them and the
    // wrapper scripts translate any that matter into env vars before
    // exec'ing us.
  }
  if (process.env.SYNCLO_EXPLORE_MOCK_NO_DELAY === '1') opts.noDelay = true;
  return opts;
}

async function readStdinIfPiped() {
  if (process.stdin.isTTY) return '';
  return new Promise(resolve => {
    let acc = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', c => { acc += c; });
    process.stdin.on('end',  () => resolve(acc));
    process.stdin.on('error', () => resolve(acc));
    // Safety timeout in case the parent never closes stdin (PTY).
    setTimeout(() => resolve(acc), 1500);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.as) {
    process.stderr.write(
      'mock-agent: --as <agent> required\n' +
      '  supported: opencode | claude | codex | gemini | cursor-agent |\n' +
      '             deepseek | qwen | grok | plain |\n' +
      '             devin | hermes | kilo | kimi | kiro | vibe   (ACP)\n',
    );
    process.exit(2);
  }

  // ACP agents read JSON-RPC messages off stdin one line at a time, so the
  // bulk-prompt buffering logic below doesn't apply — pickRecording sees no
  // prompt for hash-mode (use SYNCLO_EXPLORE_MOCK_TRACE or _POOL instead).
  const ACP_AGENTS = new Set(['devin', 'hermes', 'kilo', 'kimi', 'kiro', 'vibe']);
  const isAcp = ACP_AGENTS.has(opts.as);
  const prompt = isAcp ? '' : await readStdinIfPiped();
  const picked = await pickRecording({ prompt });
  if (!picked) {
    process.stderr.write(
      'mock-agent: no recordings available under ./recordings/.\n' +
      'Set SYNCLO_EXPLORE_MOCK_RECORDINGS_DIR to override the path.\n',
    );
    process.exit(3);
  }

  process.stderr.write(
    `[mock-${opts.as}] picked ${picked.traceId.slice(0, 8)}… via ${picked.method}` +
    (picked.pool ? ` (pool="${picked.pool}")` : '') +
    '\n',
  );

  const events = await readRecording(picked.path);
  const renderOpts = { noDelay: opts.noDelay, reportFile: opts.reportFile };

  switch (opts.as) {
    case 'opencode':     await renderAsOpencode(events, renderOpts);    break;
    case 'codex':        await renderAsCodex(events, renderOpts);       break;
    case 'claude':       await renderAsClaude(events, renderOpts);      break;
    case 'gemini':       await renderAsGemini(events, renderOpts);      break;
    case 'cursor-agent': await renderAsCursorAgent(events, renderOpts); break;
    case 'deepseek':
    case 'qwen':
    case 'grok':
    case 'plain':        await renderAsPlain(events, renderOpts);       break;
    // ACP family — JSON-RPC server over stdio.
    case 'devin':
    case 'hermes':
    case 'kilo':
    case 'kimi':
    case 'kiro':
    case 'vibe':         await runAcpServer(events, renderOpts);        break;
    default:
      process.stderr.write(`mock-agent: unknown agent "${opts.as}"\n`);
      process.exit(2);
  }
}

main().catch(err => {
  process.stderr.write(`mock-agent: ${err.message}\n`);
  process.exit(1);
});
