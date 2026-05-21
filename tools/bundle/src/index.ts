import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cac } from "cac";
import { build as buildWithEsbuild } from "esbuild";
import { createPackageManagerInvocation } from "@open-design/platform";
import {
  BUNDLE_DESCRIPTOR_FILE,
  BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
  BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2,
  BUNDLE_PUBLICATION_SCHEMA_VERSION,
  addBundle,
  createBundleEpochVersion,
  deleteBundle,
  listBundles,
  parseBundleEpochVersion,
  replaceBundle,
  resolveBundle,
  resolveBundleArtifact,
  validateBundleRef,
  writeBundlePublication,
  type BundleArtifact,
  type BundleArtifactDescriptor,
  type BundleEntry,
  type BundlePublication,
  type BundlePublicationResolved,
  type BundleRef,
  type BundleResolved,
} from "@open-design/bundle";

const WEB_APP = "web";
const DAEMON_APP = "daemon";
const DAEMON_BUNDLE_KEY = "od:sidecar:daemon";
const DAEMON_PACKAGE_NAME = "@open-design/daemon";
const DAEMON_RELEASE_ENTRY = "sidecar/index.mjs";
const DAEMON_RESOURCE_ROOT = "daemon/resources";
const DAEMON_SIDECAR_BUILD_ENTRY = "dist/sidecar/index.js";
const DAEMON_CLI_BUILD_ENTRY = "dist/cli.js";
const DAEMON_EXTERNAL_RUNTIME_DEPS = ["better-sqlite3", "blake3-wasm"] as const;
const DAEMON_ESM_REQUIRE_BANNER =
  'import { createRequire as __odCreateRequire } from "node:module"; const require = __odCreateRequire(import.meta.url);';
const DAEMON_RESOURCE_DEDUPE_MIN_BYTES = 16 * 1024;
const WEB_BUNDLE_KEY = "od:sidecar:web";
const WEB_PACKAGE_NAME = "@open-design/web";
const WEB_DEFAULT_ENTRY = "sidecar/index.ts";
const WEB_RELEASE_ENTRY = "sidecar/index.mjs";
const WEB_JS_ENTRY_CANDIDATES = ["sidecar/index.mjs", "sidecar/index.js"];
const WEB_STANDALONE_BUNDLE_ROOT = "web/standalone";
const WEB_STANDALONE_SOURCE_ROOT = path.join(".next", "standalone");
const WEB_STATIC_SOURCE_ROOT = path.join(".next", "static");
const WEB_PUBLIC_SOURCE_ROOT = "public";
const WORKSPACE_MARKER_FILE = "pnpm-workspace.yaml";

type BundleApp = typeof WEB_APP | typeof DAEMON_APP;

type JsonOption = {
  json?: boolean;
};

type BasePathOption = JsonOption & {
  bundleBasePath?: string;
};

type KeyOption = {
  key?: string;
};

type PackOptions = JsonOption & {
  bundleBasePath?: string;
  bundleVersion?: string;
  epoch?: string;
  key?: string;
  out?: string;
  replace?: boolean;
  replaceOutput?: boolean;
  replaceStore?: boolean;
  version?: string;
};

type AddOptions = BasePathOption & KeyOption & {
  replace?: boolean;
  version?: string;
};

type RefOptions = BasePathOption & KeyOption;

type PublishOptions = JsonOption & KeyOption & {
  bundleBasePath?: string;
  bundleVersion?: string;
  channel?: string;
  displayVersion?: string;
  pathKey?: string;
  platform?: string;
  publicationVersion?: string;
  registryBasePath?: string;
  summary?: string;
  tag?: string;
  title?: string;
  version?: string;
};

export type PackBundleInput = {
  app: string;
  key?: string;
  outPath: string;
  replace?: boolean;
  sourcePath: string;
  version?: string;
};

export type StoreBundleInput = {
  basePath: string;
  bundlePath: string;
  key?: string;
  replace?: boolean;
  version?: string;
};

export type PackBundleToStoreInput = {
  app: string;
  basePath: string;
  epoch: string;
  outPath?: string;
  replace?: boolean;
  replaceOutput?: boolean;
  sourcePath: string;
};

export type PackBundleToStoreResult = {
  artifact: BundleArtifact;
  ref: BundleRef;
  resolved: BundleResolved;
  version: string;
};

export type PublishBundleInput = {
  app: string;
  bundleBasePath: string;
  bundleVersion: string;
  channel: string;
  displayVersion?: string;
  key?: string;
  pathKey: string;
  platform?: string;
  registryBasePath: string;
  summary?: string;
  tag?: string;
  title?: string;
  version: string;
};

export type PublishBundleResult = {
  publication: BundlePublication;
  raw: BundleResolved;
  tagged?: BundlePublicationResolved;
  versioned: BundlePublicationResolved;
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function output(payload: unknown, options: JsonOption, heading: string): void {
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${heading}\n`);
  if (isBundleArtifact(payload)) {
    process.stdout.write(`bundle: ${payload.bundlePath}\n`);
    process.stdout.write(`descriptor: ${payload.descriptorPath}\n`);
    process.stdout.write(`entry: ${payload.descriptor.entry.kind} ${payload.entryPath}\n`);
    return;
  }
  if (isBundleResolved(payload)) {
    process.stdout.write(`bundle: ${payload.ref.key}@${payload.ref.version}\n`);
    process.stdout.write(`path: ${payload.path}\n`);
    process.stdout.write(`metadata: ${payload.metadataPath}\n`);
    return;
  }
  if (isPackBundleToStoreResult(payload)) {
    process.stdout.write(`bundle: ${payload.ref.key}@${payload.ref.version}\n`);
    process.stdout.write(`path: ${payload.resolved.path}\n`);
    process.stdout.write(`entry: ${payload.artifact.descriptor.entry.kind} ${payload.artifact.entryPath}\n`);
    process.stdout.write(`metadata: ${payload.resolved.metadataPath}\n`);
    return;
  }
  if (isPublishBundleResult(payload)) {
    process.stdout.write(`publication: ${payload.publication.bundle.key}\n`);
    process.stdout.write(`channel: ${payload.publication.metadata.channel}\n`);
    process.stdout.write(`version: ${payload.publication.metadata.version}\n`);
    process.stdout.write(`raw: ${payload.raw.ref.key}@${payload.raw.ref.version}\n`);
    process.stdout.write(`path: ${payload.versioned.paths.publicationPath}\n`);
    if (payload.tagged != null) {
      process.stdout.write(`tag: ${payload.tagged.paths.publicationPath}\n`);
    }
    return;
  }
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      process.stdout.write("(no bundles)\n");
      return;
    }
    for (const entry of payload) {
      const bundle = entry as BundleEntry;
      process.stdout.write(`- ${bundle.ref.key}@${bundle.ref.version} · ${bundle.path}\n`);
    }
    return;
  }
  if (typeof payload === "boolean") {
    process.stdout.write(`deleted: ${payload ? "yes" : "no"}\n`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isBundleArtifact(value: unknown): value is BundleArtifact {
  return isRecord(value) && typeof value.bundlePath === "string" && typeof value.entryPath === "string";
}

function isBundleResolved(value: unknown): value is BundleResolved {
  return isRecord(value) && isRecord(value.ref) && typeof value.path === "string" && typeof value.metadataPath === "string";
}

function isPackBundleToStoreResult(value: unknown): value is PackBundleToStoreResult {
  return isRecord(value) && isBundleArtifact(value.artifact) && isBundleResolved(value.resolved) && isRecord(value.ref);
}

function isPublishBundleResult(value: unknown): value is PublishBundleResult {
  return isRecord(value) && isRecord(value.publication) && isBundleResolved(value.raw) && isRecord(value.versioned);
}

function containsPath(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function requireSupportedApp(app: string): BundleApp {
  if (app === WEB_APP) return app;
  if (app === DAEMON_APP) return app;
  throw new Error(`unsupported bundle app: ${app} (expected: daemon or web)`);
}

function defaultKeyForApp(app: BundleApp): string {
  return app === WEB_APP ? WEB_BUNDLE_KEY : DAEMON_BUNDLE_KEY;
}

function slugForApp(app: BundleApp): string {
  return app;
}

function requireBundleVersionForApp(app: BundleApp, version: string): string {
  const parsed = parseBundleEpochVersion(version);
  const expectedSlug = slugForApp(app);
  if (parsed.slug !== expectedSlug) {
    throw new Error(`bundle version slug must be ${expectedSlug} for ${app}: ${version}`);
  }
  return parsed.version;
}

function requireOption(value: string | undefined, name: string): string {
  if (value == null || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function resolveBasePath(options: BasePathOption): string {
  return path.resolve(requireOption(options.bundleBasePath, "--bundle-base-path"));
}

function normalizeRef(input: { key?: string; refOrVersion: string }): BundleRef {
  const at = input.refOrVersion.lastIndexOf("@");
  const key = at > 0 && input.refOrVersion.slice(0, at).includes(":")
    ? input.refOrVersion.slice(0, at)
    : input.key ?? WEB_BUNDLE_KEY;
  const version = key === input.refOrVersion.slice(0, at) ? input.refOrVersion.slice(at + 1) : input.refOrVersion;
  return validateBundleRef({ key, version });
}

function descriptorRef(descriptor: BundleArtifactDescriptor): BundleRef | null {
  return descriptor.schemaVersion === BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2
    ? { key: descriptor.key, version: descriptor.version }
    : null;
}

async function assertDirectoryRoot(root: string, label: string): Promise<void> {
  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${label} missing: ${root}`);
    throw error;
  }
  if (!info.isDirectory()) throw new Error(`${label} must be a directory: ${root}`);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${root}`);
}

async function assertDirectoryWithInternalSymlinks(root: string, label: string): Promise<void> {
  await assertDirectoryRoot(root, label);
  const realRoot = await realpath(root);

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const child = await lstat(entryPath);
      if (child.isSymbolicLink()) {
        const target = await readlink(entryPath);
        if (path.isAbsolute(target)) {
          throw new Error(`${label} symlinks must be relative: ${entryPath}`);
        }

        let realTarget;
        try {
          realTarget = await realpath(entryPath);
        } catch {
          throw new Error(`${label} symlinks must not be broken: ${entryPath}`);
        }
        if (!containsPath(realRoot, realTarget)) {
          throw new Error(`${label} symlinks must stay inside the bundle: ${entryPath}`);
        }
        continue;
      }
      if (entry.isDirectory()) await walk(entryPath);
    }
  }

  await walk(root);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function detectWebSourceDescriptor(sourcePath: string): Promise<BundleArtifactDescriptor> {
  if (await pathExists(path.join(sourcePath, WEB_DEFAULT_ENTRY))) {
    return {
      entry: { kind: "tsx", path: WEB_DEFAULT_ENTRY },
      schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
    };
  }

  for (const candidate of WEB_JS_ENTRY_CANDIDATES) {
    if (await pathExists(path.join(sourcePath, candidate))) {
      return {
        entry: { kind: "js", path: candidate },
        schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
      };
    }
  }

  throw new Error(`web bundle source must contain ${WEB_DEFAULT_ENTRY} or one of: ${WEB_JS_ENTRY_CANDIDATES.join(", ")}`);
}

function quoteCommandPart(value: string): string {
  if (!/[\s"'$`\\]/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteCommandPart).join(" ");
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function relativeImportSpecifier(fromDirectory: string, targetPath: string): string {
  const specifier = toPosixPath(path.relative(fromDirectory, targetPath));
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

async function runPackageManager(workspaceRoot: string, args: string[], extraEnv: NodeJS.ProcessEnv): Promise<void> {
  const invocation = createPackageManagerInvocation(args, process.env);
  const startedAt = Date.now();
  process.stderr.write(`[tools-bundle] run ${commandLine(invocation.command, invocation.args)}\n`);

  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: workspaceRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    child.stdout?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0 && signal == null) {
        resolveCommand();
        return;
      }
      const suffix = signal == null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
      rejectCommand(new Error(`command failed with ${suffix}: ${commandLine(invocation.command, invocation.args)}`));
    });
  });

  process.stderr.write(`[tools-bundle] done ${commandLine(invocation.command, invocation.args)} durationMs=${Date.now() - startedAt}\n`);
}

async function findWorkspaceRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    if (await pathExists(path.join(current, WORKSPACE_MARKER_FILE))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readPackageName(packageRoot: string): Promise<string | null> {
  const packageJsonPath = path.join(packageRoot, "package.json");
  try {
    const value = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: unknown };
    return typeof value.name === "string" ? value.name : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function buildWebStandaloneIfWorkspaceSource(sourcePath: string): Promise<void> {
  const [packageName, workspaceRoot] = await Promise.all([
    readPackageName(sourcePath),
    findWorkspaceRoot(sourcePath),
  ]);
  if (packageName !== WEB_PACKAGE_NAME || workspaceRoot == null) return;
  await runPackageManager(workspaceRoot, ["--filter", WEB_PACKAGE_NAME, "build"], {
    OD_WEB_OUTPUT_MODE: "standalone",
  });
}

async function buildDaemonIfWorkspaceSource(sourcePath: string): Promise<void> {
  const [packageName, workspaceRoot] = await Promise.all([
    readPackageName(sourcePath),
    findWorkspaceRoot(sourcePath),
  ]);
  if (packageName !== DAEMON_PACKAGE_NAME || workspaceRoot == null) return;
  await runPackageManager(workspaceRoot, ["--filter", DAEMON_PACKAGE_NAME, "build"], {});
}

async function buildAppIfWorkspaceSource(app: BundleApp, sourcePath: string): Promise<void> {
  if (app === WEB_APP) {
    await buildWebStandaloneIfWorkspaceSource(sourcePath);
    return;
  }
  await buildDaemonIfWorkspaceSource(sourcePath);
}

async function assertSidecarEntryFile(entryPath: string, label = "sidecar entry"): Promise<void> {
  const info = await lstat(entryPath);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${entryPath}`);
  if (!info.isFile()) throw new Error(`${label} must be a file: ${entryPath}`);
}

async function emitWebSidecarEntry(input: {
  outPath: string;
  sourceDescriptor: BundleArtifactDescriptor;
  sourcePath: string;
}): Promise<BundleArtifactDescriptor> {
  const sourceEntryPath = path.join(input.sourcePath, input.sourceDescriptor.entry.path);
  await assertSidecarEntryFile(sourceEntryPath, "web sidecar entry");

  if (input.sourceDescriptor.entry.kind === "js") {
    const outfile = path.join(input.outPath, input.sourceDescriptor.entry.path);
    await mkdir(path.dirname(outfile), { recursive: true });
    await cp(sourceEntryPath, outfile, { dereference: true });
    return input.sourceDescriptor;
  }

  const outfile = path.join(input.outPath, WEB_RELEASE_ENTRY);
  await mkdir(path.dirname(outfile), { recursive: true });
  await buildWithEsbuild({
    bundle: true,
    entryPoints: [path.join(input.sourcePath, input.sourceDescriptor.entry.path)],
    format: "esm",
    outfile,
    platform: "node",
    sourcemap: true,
    target: "node24",
  });
  return {
    entry: { kind: "js", path: WEB_RELEASE_ENTRY },
    schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
  };
}

async function resolveStandaloneSourceWebRoot(standaloneRoot: string): Promise<string> {
  const nestedRoot = path.join(standaloneRoot, "apps", "web");
  if (await pathExists(path.join(nestedRoot, "server.js"))) return nestedRoot;
  if (await pathExists(path.join(standaloneRoot, "server.js"))) return standaloneRoot;
  throw new Error(`Next.js standalone server output missing under ${standaloneRoot}`);
}

async function requireWebStandaloneOutput(sourcePath: string): Promise<{
  sourceWebRoot: string;
  standaloneRoot: string;
}> {
  const standaloneRoot = path.join(sourcePath, WEB_STANDALONE_SOURCE_ROOT);
  await assertDirectoryRoot(standaloneRoot, "Next.js standalone output");
  return {
    sourceWebRoot: await resolveStandaloneSourceWebRoot(standaloneRoot),
    standaloneRoot,
  };
}

async function copyRequiredDirectory(
  sourcePath: string,
  destinationPath: string,
  label: string,
  options: { preserveSymlinks?: boolean } = {},
): Promise<void> {
  let info;
  try {
    info = await stat(sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} missing: ${sourcePath}`);
    }
    throw error;
  }
  if (!info.isDirectory()) throw new Error(`${label} must be a directory: ${sourcePath}`);

  await rm(destinationPath, { force: true, recursive: true });
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, {
    dereference: options.preserveSymlinks !== true,
    recursive: true,
    verbatimSymlinks: options.preserveSymlinks === true,
  });
}

async function copyOptionalDirectory(
  sourcePath: string,
  destinationPath: string,
  label: string,
  options: { preserveSymlinks?: boolean } = {},
): Promise<void> {
  if (!(await pathExists(sourcePath))) return;
  await copyRequiredDirectory(sourcePath, destinationPath, label, options);
}

function webStandaloneBundleRoot(outPath: string): string {
  return path.join(outPath, ...WEB_STANDALONE_BUNDLE_ROOT.split("/"));
}

async function linkRelative(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (await pathExists(destinationPath)) return false;
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const relativeTarget = path.relative(path.dirname(destinationPath), sourcePath);
  await symlink(relativeTarget.length === 0 ? "." : relativeTarget, destinationPath);
  return true;
}

async function linkPnpmPublicHoist(destinationRoot: string): Promise<void> {
  const nodeModulesRoot = path.join(destinationRoot, "node_modules");
  const hoistRoot = path.join(nodeModulesRoot, ".pnpm", "node_modules");
  const entries = await readdir(hoistRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const sourcePath = path.join(hoistRoot, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopedEntries = await readdir(sourcePath).catch(() => []);
      for (const scopedEntry of scopedEntries) {
        await linkRelative(
          path.join(sourcePath, scopedEntry),
          path.join(nodeModulesRoot, entry.name, scopedEntry),
        );
      }
      continue;
    }

    await linkRelative(sourcePath, path.join(nodeModulesRoot, entry.name));
  }
}

async function removePath(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true, recursive: true });
}

function isPrunablePnpmSharpEntry(name: string): boolean {
  return name.startsWith("sharp@") || name.startsWith("@img+colour@") || name.startsWith("@img+sharp-");
}

function isPrunableImgEntry(name: string): boolean {
  return name === "colour" || name.startsWith("sharp-");
}

async function pruneImgScope(scopePath: string): Promise<void> {
  const entries = await readdir(scopePath).catch(() => []);
  for (const entry of entries) {
    if (isPrunableImgEntry(entry)) await removePath(path.join(scopePath, entry));
  }
}

async function pruneSharp(destinationRoot: string): Promise<void> {
  const nodeModulesRoot = path.join(destinationRoot, "node_modules");
  const pnpmRoot = path.join(nodeModulesRoot, ".pnpm");

  await removePath(path.join(nodeModulesRoot, "sharp"));
  await pruneImgScope(path.join(nodeModulesRoot, "@img"));
  await removePath(path.join(pnpmRoot, "node_modules", "sharp"));
  await pruneImgScope(path.join(pnpmRoot, "node_modules", "@img"));

  const pnpmEntries = await readdir(pnpmRoot).catch(() => []);
  for (const entry of pnpmEntries) {
    if (isPrunablePnpmSharpEntry(entry)) {
      await removePath(path.join(pnpmRoot, entry));
      continue;
    }

    if (entry.startsWith("next@")) {
      await removePath(path.join(pnpmRoot, entry, "node_modules", "sharp"));
    }
  }
}

function isSourceBuildResidue(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.endsWith(".map") || normalized.endsWith(".tsbuildinfo");
}

async function pruneSourceBuildResidue(root: string): Promise<void> {
  async function walk(current: string): Promise<void> {
    const info = await lstat(current).catch(() => null);
    if (info == null || info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) await walk(path.join(current, entry.name));
      return;
    }

    const relativePath = path.relative(root, current);
    if (relativePath.length > 0 && isSourceBuildResidue(relativePath)) await rm(current, { force: true });
  }

  await walk(root);
}

async function pruneBrokenSymlinks(root: string): Promise<void> {
  async function walk(current: string): Promise<void> {
    const info = await lstat(current).catch(() => null);
    if (info == null) return;
    if (info.isSymbolicLink()) {
      try {
        await stat(current);
      } catch {
        await removePath(current);
      }
      return;
    }
    if (!info.isDirectory()) return;

    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) await walk(path.join(current, entry.name));
  }

  await walk(root);
}

async function pruneWebStandaloneRuntime(destinationRoot: string): Promise<void> {
  await pruneSharp(destinationRoot);
  await pruneSourceBuildResidue(destinationRoot);
  await pruneBrokenSymlinks(destinationRoot);
}

async function copyWebStandaloneRuntime(sourcePath: string, outPath: string): Promise<void> {
  const { sourceWebRoot, standaloneRoot } = await requireWebStandaloneOutput(sourcePath);
  const destinationRoot = webStandaloneBundleRoot(outPath);
  const preserveSymlinks = process.platform !== "win32";
  await copyRequiredDirectory(standaloneRoot, destinationRoot, "Next.js standalone output", { preserveSymlinks });

  const relativeWebRoot = path.relative(standaloneRoot, sourceWebRoot);
  const destinationWebRoot = path.join(destinationRoot, relativeWebRoot);
  await copyRequiredDirectory(
    path.join(sourcePath, WEB_STATIC_SOURCE_ROOT),
    path.join(destinationWebRoot, ".next", "static"),
    "Next.js static assets",
    { preserveSymlinks },
  );
  await copyOptionalDirectory(
    path.join(sourcePath, WEB_PUBLIC_SOURCE_ROOT),
    path.join(destinationWebRoot, "public"),
    "web public assets",
    { preserveSymlinks },
  );
  await linkPnpmPublicHoist(destinationRoot);
  await pruneWebStandaloneRuntime(destinationRoot);
  await assertDirectoryWithInternalSymlinks(destinationRoot, "packed web standalone runtime");
}

function packageDestination(nodeModulesRoot: string, packageName: string): string {
  return path.join(nodeModulesRoot, ...packageName.split("/"));
}

function resolvePackageJson(requireFrom: NodeJS.Require, packageName: string): string | null {
  try {
    return requireFrom.resolve(`${packageName}/package.json`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

async function copyPackageClosure(input: {
  nodeModulesRoot: string;
  packageName: string;
  requireFrom: NodeJS.Require;
  seen: Set<string>;
}): Promise<boolean> {
  const packageJsonPath = resolvePackageJson(input.requireFrom, input.packageName);
  if (packageJsonPath == null) return false;

  const packageRoot = path.dirname(packageJsonPath);
  const realPackageRoot = await realpath(packageRoot);
  if (input.seen.has(realPackageRoot)) return true;
  input.seen.add(realPackageRoot);

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  await copyRequiredDirectory(
    packageRoot,
    packageDestination(input.nodeModulesRoot, input.packageName),
    `${input.packageName} runtime dependency`,
  );

  const childRequire = createRequire(packageJsonPath);
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    await copyPackageClosure({
      nodeModulesRoot: input.nodeModulesRoot,
      packageName: dependencyName,
      requireFrom: childRequire,
      seen: input.seen,
    });
  }
  return true;
}

async function copyDaemonRuntimeDeps(sourcePath: string, outPath: string): Promise<void> {
  const nodeModulesRoot = path.join(outPath, "node_modules");
  const requireFromSource = createRequire(path.join(sourcePath, "package.json"));
  const seen = new Set<string>();

  for (const packageName of DAEMON_EXTERNAL_RUNTIME_DEPS) {
    await copyPackageClosure({
      nodeModulesRoot,
      packageName,
      requireFrom: requireFromSource,
      seen,
    });
  }
}

async function copyDaemonResources(sourcePath: string, outPath: string): Promise<void> {
  const workspaceRoot = await findWorkspaceRoot(sourcePath);
  if (workspaceRoot == null) return;

  const resourceRoot = path.join(outPath, ...DAEMON_RESOURCE_ROOT.split("/"));
  const preserveSymlinks = process.platform !== "win32";
  const copies: Array<{ from: string; to: string }> = [
    { from: "skills", to: "skills" },
    { from: "design-systems", to: "design-systems" },
    { from: "design-templates", to: "design-templates" },
    { from: "craft", to: "craft" },
    { from: "assets/community-pets", to: "community-pets" },
    { from: "prompt-templates", to: "prompt-templates" },
    { from: "plugins/_official", to: "plugins/_official" },
    { from: "plugins/registry", to: "plugins/registry" },
  ];

  for (const copyInfo of copies) {
    await copyOptionalDirectory(
      path.join(workspaceRoot, ...copyInfo.from.split("/")),
      path.join(resourceRoot, ...copyInfo.to.split("/")),
      `daemon resource ${copyInfo.from}`,
      { preserveSymlinks },
    );
  }
}

async function collectDedupeCandidateFiles(root: string): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = [];

  async function walk(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (metadata.isFile() && metadata.size >= DAEMON_RESOURCE_DEDUPE_MIN_BYTES) {
        files.push({ path: entryPath, size: metadata.size });
      }
    }
  }

  if (await pathExists(root)) await walk(root);
  return files;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function dedupeDaemonResourceFiles(resourceRoot: string): Promise<void> {
  if (process.platform === "win32") return;

  const filesBySize = new Map<number, string[]>();
  for (const file of await collectDedupeCandidateFiles(resourceRoot)) {
    const existing = filesBySize.get(file.size) ?? [];
    existing.push(file.path);
    filesBySize.set(file.size, existing);
  }

  for (const files of filesBySize.values()) {
    if (files.length < 2) continue;
    const canonicalByHash = new Map<string, string>();
    for (const file of files) {
      const digest = await hashFile(file);
      const canonical = canonicalByHash.get(digest);
      if (canonical == null) {
        canonicalByHash.set(digest, file);
        continue;
      }

      const relativeTarget = path.relative(path.dirname(file), canonical);
      await rm(file, { force: true });
      await symlink(relativeTarget.length === 0 ? "." : relativeTarget, file);
    }
  }
}

async function pruneDaemonRuntime(outPath: string): Promise<void> {
  const betterSqliteRoot = path.join(outPath, "node_modules", "better-sqlite3");
  await removePath(path.join(betterSqliteRoot, "deps"));
  await removePath(path.join(betterSqliteRoot, "build", "Release", "obj"));
  await pruneSourceBuildResidue(outPath);
  await pruneBrokenSymlinks(outPath);
}

function renderDaemonCliEntry(input: { entryRoot: string; sourceCliPath: string }): string {
  return [
    'import { fileURLToPath } from "node:url";',
    "const selfPath = fileURLToPath(import.meta.url);",
    "process.env.OD_BIN ??= selfPath;",
    "process.env.OD_DAEMON_CLI_PATH ??= selfPath;",
    `await import(${JSON.stringify(relativeImportSpecifier(input.entryRoot, input.sourceCliPath))});`,
    "",
  ].join("\n");
}

async function emitDaemonRuntime(sourcePath: string, outPath: string): Promise<BundleArtifactDescriptor> {
  const sourceSidecarPath = path.join(sourcePath, ...DAEMON_SIDECAR_BUILD_ENTRY.split("/"));
  const sourceCliPath = path.join(sourcePath, ...DAEMON_CLI_BUILD_ENTRY.split("/"));
  await assertSidecarEntryFile(sourceSidecarPath, "daemon sidecar build entry");
  await assertSidecarEntryFile(sourceCliPath, "daemon CLI build entry");

  const entryRoot = path.join(outPath, ".entrypoints");
  const cliEntryPath = path.join(entryRoot, "daemon-cli.mjs");
  await mkdir(entryRoot, { recursive: true });
  await writeFile(cliEntryPath, renderDaemonCliEntry({ entryRoot, sourceCliPath }), "utf8");
  await buildWithEsbuild({
    banner: { js: DAEMON_ESM_REQUIRE_BANNER },
    bundle: true,
    chunkNames: "daemon/chunks/[name]-[hash]",
    entryPoints: [
      { in: sourceSidecarPath, out: "sidecar/index" },
      { in: cliEntryPath, out: "daemon/daemon-cli" },
    ],
    external: [...DAEMON_EXTERNAL_RUNTIME_DEPS],
    format: "esm",
    outdir: outPath,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    splitting: true,
    target: "node24",
  });
  await rm(entryRoot, { force: true, recursive: true });
  await copyDaemonRuntimeDeps(sourcePath, outPath);
  await copyDaemonResources(sourcePath, outPath);
  await pruneDaemonRuntime(outPath);
  await dedupeDaemonResourceFiles(path.join(outPath, ...DAEMON_RESOURCE_ROOT.split("/")));

  return {
    entry: { kind: "js", path: DAEMON_RELEASE_ENTRY },
    schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
  };
}

async function releaseDescriptorForApp(app: BundleApp, sourcePath: string, outPath: string): Promise<BundleArtifactDescriptor> {
  if (app === WEB_APP) {
    return await emitWebSidecarEntry({
      outPath,
      sourceDescriptor: await detectWebSourceDescriptor(sourcePath),
      sourcePath,
    });
  }
  return await emitDaemonRuntime(sourcePath, outPath);
}

function releaseDescriptorWithOptionalRef(input: {
  app: BundleApp;
  descriptor: BundleArtifactDescriptor;
  key?: string;
  version?: string;
}): BundleArtifactDescriptor {
  if (input.key == null && input.version == null) return input.descriptor;
  const version = requireBundleVersionForApp(input.app, requireOption(input.version, "--version"));
  const key = validateBundleRef({ key: input.key ?? defaultKeyForApp(input.app), version }).key;
  return {
    ...input.descriptor,
    ...(input.app === WEB_APP
      ? { web: { outputMode: "standalone", standaloneRoot: WEB_STANDALONE_BUNDLE_ROOT } }
      : {}),
    key,
    schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2,
    version,
  };
}

export async function validateBundlePath(bundlePath: string): Promise<BundleArtifact> {
  return await resolveBundleArtifact(path.resolve(bundlePath));
}

export async function packBundle(input: PackBundleInput): Promise<BundleArtifact> {
  const app = requireSupportedApp(input.app);
  const sourcePath = path.resolve(input.sourcePath);
  const outPath = path.resolve(input.outPath);
  if (containsPath(sourcePath, outPath) || containsPath(outPath, sourcePath)) {
    throw new Error("bundle output path must not overlap the source path");
  }

  await assertDirectoryRoot(sourcePath, "bundle source path");
  const outputAlreadyExists = await pathExists(outPath);
  if (outputAlreadyExists) {
    if (input.replace !== true) throw new Error(`bundle output already exists: ${outPath}`);
  }
  await buildAppIfWorkspaceSource(app, sourcePath);
  if (outputAlreadyExists) {
    await rm(outPath, { force: true, recursive: true });
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(outPath, { recursive: true });
  if (app === WEB_APP) await copyWebStandaloneRuntime(sourcePath, outPath);
  const descriptor = releaseDescriptorWithOptionalRef({
    app,
    descriptor: await releaseDescriptorForApp(app, sourcePath, outPath),
    key: input.key,
    version: input.version,
  });
  // Source roots may carry a dev bundle.json; packed bundles always get a
  // release descriptor selected by tools-bundle.
  await writeFile(path.join(outPath, BUNDLE_DESCRIPTOR_FILE), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  await assertDirectoryWithInternalSymlinks(outPath, "packed bundle");
  return await validateBundlePath(outPath);
}

export async function addBundleToStore(input: StoreBundleInput): Promise<BundleResolved> {
  const bundlePath = path.resolve(input.bundlePath);
  const artifact = await validateBundlePath(bundlePath);
  const embeddedRef = descriptorRef(artifact.descriptor);
  const version = input.version ?? embeddedRef?.version;
  if (version == null) throw new Error("--version is required when bundle.json does not contain schemaVersion=2 ref metadata");
  const ref = validateBundleRef({ key: input.key ?? embeddedRef?.key ?? WEB_BUNDLE_KEY, version });
  if (embeddedRef != null && (embeddedRef.key !== ref.key || embeddedRef.version !== ref.version)) {
    throw new Error(`store ref ${ref.key}@${ref.version} must match bundle descriptor ref ${embeddedRef.key}@${embeddedRef.version}`);
  }
  const write = input.replace === true ? replaceBundle : addBundle;
  return await write({
    basePath: path.resolve(input.basePath),
    ref,
    sourcePath: bundlePath,
  });
}

async function nextBundleSequence(input: {
  basePath: string;
  epoch: string;
  key: string;
  slug: string;
}): Promise<number> {
  const entries = await listBundleStore(input.basePath);
  let maxSequence = 0;
  for (const entry of entries) {
    if (entry.ref.key !== input.key) continue;
    try {
      const parsed = parseBundleEpochVersion(entry.ref.version);
      if (parsed.epoch === input.epoch && parsed.slug === input.slug) {
        maxSequence = Math.max(maxSequence, parsed.sequence);
      }
    } catch {
      continue;
    }
  }
  return maxSequence + 1;
}

export async function packBundleToStore(input: PackBundleToStoreInput): Promise<PackBundleToStoreResult> {
  const app = requireSupportedApp(input.app);
  const basePath = path.resolve(input.basePath);
  const key = defaultKeyForApp(app);
  const slug = slugForApp(app);
  const version = createBundleEpochVersion({
    epoch: input.epoch,
    sequence: await nextBundleSequence({ basePath, epoch: input.epoch, key, slug }),
    slug,
  });
  const tempRoot = input.outPath == null ? await mkdtemp(path.join(tmpdir(), `od-tools-bundle-publish-${app}-`)) : null;
  const outPath = path.resolve(input.outPath ?? path.join(tempRoot ?? "", "bundle"));

  try {
    await packBundle({
      app,
      key,
      outPath,
      replace: input.replaceOutput,
      sourcePath: input.sourcePath,
      version,
    });
    const resolved = await addBundleToStore({
      basePath,
      bundlePath: outPath,
      key,
      replace: input.replace,
      version,
    });
    return {
      artifact: await validateBundlePath(resolved.path),
      ref: resolved.ref,
      resolved,
      version,
    };
  } finally {
    if (tempRoot != null) await rm(tempRoot, { force: true, recursive: true });
  }
}

export async function publishBundle(input: PublishBundleInput): Promise<PublishBundleResult> {
  const app = requireSupportedApp(input.app);
  const bundleVersion = requireBundleVersionForApp(app, input.bundleVersion);
  const key = validateBundleRef({ key: input.key ?? defaultKeyForApp(app), version: bundleVersion }).key;
  const raw = await resolveBundle({
    basePath: path.resolve(input.bundleBasePath),
    ref: { key, version: bundleVersion },
  });
  await validateBundlePath(raw.path);
  const parsedVersion = parseBundleEpochVersion(bundleVersion);
  const displayVersion = input.displayVersion ?? input.version;
  const publication: BundlePublication = {
    bundle: {
      key,
      pathKey: input.pathKey,
      variants: [
        {
          compatible: { hostEpoch: parsedVersion.epoch },
          platform: input.platform ?? "any",
          version: bundleVersion,
        },
      ],
    },
    metadata: {
      channel: input.channel,
      display: {
        summary: { default: input.summary ?? "" },
        title: { default: input.title ?? "" },
        version: displayVersion,
      },
      publish: {},
      version: input.version,
    },
    schemaVersion: BUNDLE_PUBLICATION_SCHEMA_VERSION,
  };

  const versioned = await writeBundlePublication({
    basePath: path.resolve(input.registryBasePath),
    publication,
  });
  const tagged = input.tag == null
    ? undefined
    : await writeBundlePublication({
      basePath: path.resolve(input.registryBasePath),
      publication,
      versionOrTag: input.tag,
    });

  return {
    publication: versioned.publication,
    raw,
    ...(tagged == null ? {} : { tagged }),
    versioned,
  };
}

export async function listBundleStore(basePath: string): Promise<BundleEntry[]> {
  return await listBundles(path.resolve(basePath));
}

export async function resolveBundleFromStore(input: {
  basePath: string;
  key?: string;
  refOrVersion: string;
}): Promise<BundleResolved & { artifact: BundleArtifact }> {
  const resolved = await resolveBundle({
    basePath: path.resolve(input.basePath),
    ref: normalizeRef({ key: input.key, refOrVersion: input.refOrVersion }),
  });
  return {
    ...resolved,
    artifact: await validateBundlePath(resolved.path),
  };
}

export async function deleteBundleFromStore(input: {
  basePath: string;
  key?: string;
  refOrVersion: string;
}): Promise<boolean> {
  return await deleteBundle({
    basePath: path.resolve(input.basePath),
    ref: normalizeRef({ key: input.key, refOrVersion: input.refOrVersion }),
  });
}

export function createCli(): ReturnType<typeof cac> {
  const cli = cac("tools-bundle");

  cli.command("validate <bundlePath>", "Validate a direct bundle root containing bundle.json")
    .option("--json", "print JSON")
    .action(async (bundlePath: string, options: JsonOption) => {
      output(await validateBundlePath(bundlePath), options, "tools-bundle validate");
    });

  cli.command("pack <app> <sourcePath>", "Create a raw app bundle, optionally adding it to a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path; with --epoch, stores the next raw bundle version")
    .option("--epoch <epoch>", "host epoch X.Y.Z or X.Y.Z-<channel>.N for stored raw bundle versions")
    .option("--out <path>", "bundle output path")
    .option("--bundle-version <version>", "emit schemaVersion=2 descriptor ref using <epoch>.<bundle_slug>.M")
    .option("--key <key>", "bundle key for schemaVersion=2 descriptor ref")
    .option("--replace", "replace an existing output path")
    .option("--replace-output", "replace an existing --out path when storing a raw bundle")
    .option("--replace-store", "replace store entry if the computed key/version already exists")
    .option("--json", "print JSON")
    .action(async (app: string, sourcePath: string, options: PackOptions) => {
      if (options.bundleBasePath != null || options.epoch != null) {
        output(await packBundleToStore({
          app,
          basePath: resolveBasePath(options),
          epoch: requireOption(options.epoch, "--epoch"),
          outPath: options.out,
          replace: options.replaceStore,
          replaceOutput: options.replaceOutput ?? options.replace,
          sourcePath,
        }), options, "tools-bundle pack");
        return;
      }

      output(await packBundle({
        app,
        key: options.key,
        outPath: requireOption(options.out, "--out"),
        replace: options.replace,
        sourcePath,
        version: options.bundleVersion ?? options.version,
      }), options, "tools-bundle pack");
    });

  cli.command("publish <app>", "Publish a registry publication record for an existing raw bundle version")
    .option("--bundle-base-path <path>", "bundle store base path containing the raw bundle version")
    .option("--registry-base-path <path>", "bundle publication registry base path")
    .option("--bundle-version <version>", "raw bundle version <epoch>.<bundle_slug>.M")
    .option("--channel <channel>", "publication channel, e.g. beta")
    .option("--publication-version <version>", "publication metadata version")
    .option("--path-key <pathKey>", "explicit registry path key, e.g. od-sidecar-web")
    .option("--platform <platform>", "publication platform variant, e.g. any or darwin-arm64 (default: any)")
    .option("--key <key>", "bundle key for the publication record")
    .option("--display-version <version>", "user-facing display version")
    .option("--title <text>", "default display title")
    .option("--summary <text>", "default display summary")
    .option("--tag <tag>", "also write the publication under a tag such as latest")
    .option("--json", "print JSON")
    .action(async (app: string, options: PublishOptions) => {
      output(await publishBundle({
        app,
        bundleBasePath: resolveBasePath(options),
        bundleVersion: requireOption(options.bundleVersion, "--bundle-version"),
        channel: requireOption(options.channel, "--channel"),
        displayVersion: options.displayVersion,
        key: options.key,
        pathKey: requireOption(options.pathKey, "--path-key"),
        platform: options.platform,
        registryBasePath: path.resolve(requireOption(options.registryBasePath, "--registry-base-path")),
        summary: options.summary,
        tag: options.tag,
        title: options.title,
        version: requireOption(options.publicationVersion ?? options.version, "--publication-version"),
      }), options, "tools-bundle publish");
    });

  cli.command("add <bundlePath>", "Add a direct bundle to a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--version <version>", "bundle version; optional when bundle.json contains schemaVersion=2 ref metadata")
    .option("--key <key>", `bundle key (default: ${WEB_BUNDLE_KEY}; daemon convention: ${DAEMON_BUNDLE_KEY})`)
    .option("--replace", "replace an existing bundle with the same key/version")
    .option("--json", "print JSON")
    .action(async (bundlePath: string, options: AddOptions) => {
      output(await addBundleToStore({
        basePath: resolveBasePath(options),
        bundlePath,
        key: options.key,
        replace: options.replace,
        version: options.version,
      }), options, "tools-bundle add");
    });

  cli.command("list", "List bundles in a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--json", "print JSON")
    .action(async (options: BasePathOption) => {
      output(await listBundleStore(resolveBasePath(options)), options, "tools-bundle list");
    });

  cli.command("resolve <ref>", "Resolve and validate a bundle from a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--key <key>", `bundle key used when <ref> is a version only (default: ${WEB_BUNDLE_KEY})`)
    .option("--json", "print JSON")
    .action(async (ref: string, options: RefOptions) => {
      output(await resolveBundleFromStore({
        basePath: resolveBasePath(options),
        key: options.key,
        refOrVersion: ref,
      }), options, "tools-bundle resolve");
    });

  cli.command("delete <ref>", "Delete a bundle from a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--key <key>", `bundle key used when <ref> is a version only (default: ${WEB_BUNDLE_KEY})`)
    .option("--json", "print JSON")
    .action(async (ref: string, options: RefOptions) => {
      output(await deleteBundleFromStore({
        basePath: resolveBasePath(options),
        key: options.key,
        refOrVersion: ref,
      }), options, "tools-bundle delete");
    });

  cli.help();
  return cli;
}

export async function main(): Promise<void> {
  createCli().parse();
}

if (process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  });
}
