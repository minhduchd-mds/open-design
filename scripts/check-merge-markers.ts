import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  'artifacts',
  'playwright-report',
  'test-results',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx',
  '.css', '.scss', '.html', '.yml', '.yaml', '.toml', '.sql', '.sh', '.ps1',
]);

const MARKERS = ['<<<<<<< ', '=======', '>>>>>>> '];

type Finding = {
  file: string;
  line: number;
  marker: string;
};

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory)) {
    if (IGNORED_DIRS.has(entry)) continue;

    const absolute = join(directory, entry);
    const info = await stat(absolute);

    if (info.isDirectory()) {
      yield* walk(absolute);
      continue;
    }

    if (TEXT_EXTENSIONS.has(extname(entry)) || entry === 'Dockerfile') {
      yield absolute;
    }
  }
}

async function scanFile(file: string): Promise<Finding[]> {
  const source = await readFile(file, 'utf8');
  const findings: Finding[] = [];

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trimStart();
    const marker = MARKERS.find((candidate) => trimmed.startsWith(candidate));
    if (!marker) return;

    findings.push({
      file: relative(ROOT, file),
      line: index + 1,
      marker: marker.trim(),
    });
  });

  return findings;
}

const findings: Finding[] = [];
for await (const file of walk(ROOT)) {
  findings.push(...(await scanFile(file)));
}

if (findings.length > 0) {
  console.error('Unresolved merge conflict markers detected:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.marker})`);
  }
  process.exitCode = 1;
} else {
  console.log('No unresolved merge conflict markers found.');
}
