import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  BundleStoreError,
  parseBundleEpochVersion,
  resolveBundle,
  resolveBundleArtifact,
  validateBundleRef,
  type BundleRef,
} from "@open-design/bundle";
import { SIDECAR_ENV, type PackagedBundlePresentationSnapshot, type SidecarImplementationSnapshot } from "@open-design/sidecar-proto";

import type { PackagedNamespacePaths } from "./paths.js";

export const PACKAGED_WEB_SIDECAR_BUNDLE_KEY = "od:sidecar:web";
export const PACKAGED_WEB_SIDECAR_BUNDLE_SLUG = "web";
export const SIDECAR_IMPLEMENTATION_ENV = SIDECAR_ENV.IMPLEMENTATION;

const PACKAGED_WEB_STANDALONE_BUNDLE_ROOT = "web/standalone";

export type PackagedBundleActivationFile =
  | {
      bundle: {
        key: typeof PACKAGED_WEB_SIDECAR_BUNDLE_KEY;
        source: "builtin";
      };
      presentation?: PackagedBundlePresentationSnapshot;
      schemaVersion: 1;
    }
  | {
      bundle: {
        key: typeof PACKAGED_WEB_SIDECAR_BUNDLE_KEY;
        version: string;
      };
      presentation?: PackagedBundlePresentationSnapshot;
      schemaVersion: 1;
    };

export type PackagedWebSidecarImplementation =
  | {
      entryPath: string | null;
      implementation: Extract<SidecarImplementationSnapshot, { source: "builtin" }>;
      webStandaloneRoot: null;
    }
  | {
      entryPath: string;
      implementation: Extract<SidecarImplementationSnapshot, { source: "bundle" }>;
      webStandaloneRoot: string;
    };

type ParsedActivation =
  | { presentation?: PackagedBundlePresentationSnapshot; type: "builtin" }
  | { presentation?: PackagedBundlePresentationSnapshot; ref: BundleRef; type: "bundle" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function containsPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel));
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set<string>(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
}

function parseLocalizedPresentationText(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (key.length === 0) throw new Error(`${label} keys must not be empty`);
    if (typeof text !== "string") throw new Error(`${label}.${key} must be a string`);
    result[key] = text;
  }
  return result;
}

function parsePresentation(value: unknown): PackagedBundlePresentationSnapshot | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new Error("packaged bundle presentation must be an object");
  assertKnownKeys(value, ["channel", "display", "version"], "packaged bundle presentation");
  if (!isRecord(value.display)) throw new Error("packaged bundle presentation display must be an object");
  assertKnownKeys(value.display, ["summary", "title", "version"], "packaged bundle presentation display");
  const channel = stringField(value, "channel");
  const version = stringField(value, "version");
  const displayVersion = stringField(value.display, "version");
  if (channel == null || version == null || displayVersion == null) {
    throw new Error("packaged bundle presentation must contain channel, version, and display.version");
  }
  return {
    channel,
    display: {
      summary: parseLocalizedPresentationText(value.display.summary, "packaged bundle presentation display.summary"),
      title: parseLocalizedPresentationText(value.display.title, "packaged bundle presentation display.title"),
      version: displayVersion,
    },
    version,
  };
}

function parseSimpleActivationFile(value: Record<string, unknown>): ParsedActivation {
  assertKnownKeys(value, ["bundle", "presentation", "schemaVersion"], "packaged bundle activation");
  if (value.schemaVersion !== 1) {
    throw new Error("packaged bundle activation must contain schemaVersion=1");
  }
  if (!isRecord(value.bundle)) {
    throw new Error("packaged bundle activation bundle must be an object");
  }
  assertKnownKeys(value.bundle, ["key", "source", "version"], "packaged bundle activation bundle");
  if (value.bundle.key !== PACKAGED_WEB_SIDECAR_BUNDLE_KEY) {
    throw new Error(`packaged bundle activation key must be ${PACKAGED_WEB_SIDECAR_BUNDLE_KEY}`);
  }

  const presentation = parsePresentation(value.presentation);
  if (value.bundle.source === "builtin") {
    if (value.bundle.version != null) throw new Error("packaged bundle activation source=builtin must not contain version");
    return {
      ...(presentation == null ? {} : { presentation }),
      type: "builtin",
    };
  }

  const version = stringField(value.bundle, "version");
  if (version == null) {
    throw new Error("packaged bundle activation must contain key/version or key/source=builtin");
  }
  return {
    ...(presentation == null ? {} : { presentation }),
    ref: validateBundleRef({ key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version }),
    type: "bundle",
  };
}

function parseActivationFile(value: unknown): ParsedActivation {
  if (!isRecord(value)) throw new Error("packaged bundle activation must be a JSON object");
  return parseSimpleActivationFile(value);
}

async function readActivation(path: string): Promise<ParsedActivation | null> {
  try {
    return parseActivationFile(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function builtin(entryPath: string | null, fallbackReason?: string): PackagedWebSidecarImplementation {
  return {
    entryPath,
    implementation: {
      source: "builtin",
      ...(entryPath == null ? {} : { entryPath }),
      ...(fallbackReason == null ? {} : { fallbackReason }),
    },
    webStandaloneRoot: null,
  };
}

function webStandaloneRootFromDescriptor(input: {
  bundlePath: string;
  descriptor: Record<string, unknown>;
}): string {
  const web = isRecord(input.descriptor.web) ? input.descriptor.web : {};
  const outputMode = stringField(web, "outputMode");
  if (outputMode != null && outputMode !== "standalone") {
    throw new Error(`bundle web outputMode must be standalone: ${outputMode}`);
  }

  const standaloneRoot = stringField(web, "standaloneRoot") ?? PACKAGED_WEB_STANDALONE_BUNDLE_ROOT;
  if (isAbsolute(standaloneRoot)) throw new Error("bundle web standaloneRoot must be relative");
  const root = resolve(input.bundlePath, standaloneRoot);
  if (!containsPath(input.bundlePath, root)) {
    throw new Error("bundle web standaloneRoot escaped the bundle path");
  }
  return root;
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error(`${label} must be a directory`);
}

async function resolveParsedPackagedWebSidecarImplementation(options: {
  activation: ParsedActivation;
  builtinEntryPath: string | null;
  bundleEpoch: string | null;
  paths: PackagedNamespacePaths;
}): Promise<PackagedWebSidecarImplementation> {
  if (options.activation.type === "builtin") return builtin(options.builtinEntryPath, "binding-builtin");

  try {
    if (options.bundleEpoch == null) return builtin(options.builtinEntryPath, "host-epoch-missing");
    const parsedVersion = parseBundleEpochVersion(options.activation.ref.version);
    if (parsedVersion.slug !== PACKAGED_WEB_SIDECAR_BUNDLE_SLUG) {
      return builtin(options.builtinEntryPath, `bundle-slug-mismatch:${parsedVersion.slug}`);
    }
    if (parsedVersion.epoch !== options.bundleEpoch) {
      return builtin(options.builtinEntryPath, `bundle-epoch-mismatch:${parsedVersion.epoch}`);
    }

    const resolved = await resolveBundle({
      basePath: options.paths.bundleBasePath,
      ref: options.activation.ref,
    });
    const artifact = await resolveBundleArtifact(resolved.path);
    if (artifact.descriptor.schemaVersion !== 2) {
      return builtin(options.builtinEntryPath, "bundle-descriptor-unsupported");
    }
    if (artifact.descriptor.key !== options.activation.ref.key || artifact.descriptor.version !== options.activation.ref.version) {
      return builtin(options.builtinEntryPath, "bundle-descriptor-ref-mismatch");
    }

    const webStandaloneRoot = webStandaloneRootFromDescriptor({
      bundlePath: artifact.bundlePath,
      descriptor: artifact.descriptor,
    });
    await assertDirectory(webStandaloneRoot, "bundle web standaloneRoot");

    return {
      entryPath: artifact.entryPath,
      implementation: {
        basePath: resolved.basePath,
        bundlePath: artifact.bundlePath,
        descriptorPath: artifact.descriptorPath,
        entryPath: artifact.entryPath,
        metadataPath: resolved.metadataPath,
        ref: resolved.ref,
        source: "bundle",
      },
      webStandaloneRoot,
    };
  } catch (error) {
    const reason = error instanceof BundleStoreError ? `${error.code}:${error.message}` : error instanceof Error ? error.message : String(error);
    return builtin(options.builtinEntryPath, `bundle-unresolved:${reason}`);
  }
}

export async function resolvePackagedWebSidecarImplementation(options: {
  builtinEntryPath: string | null;
  bundleEpoch: string | null;
  paths: PackagedNamespacePaths;
}): Promise<PackagedWebSidecarImplementation> {
  let activation: ParsedActivation | null;
  try {
    activation = await readActivation(options.paths.bundleActivationPath);
  } catch (error) {
    return builtin(options.builtinEntryPath, `activation-invalid:${error instanceof Error ? error.message : String(error)}`);
  }

  if (activation == null) return builtin(options.builtinEntryPath, "activation-missing");
  return await resolveParsedPackagedWebSidecarImplementation({
    ...options,
    activation,
  });
}

export async function resolvePackagedWebSidecarImplementationForActivation(options: {
  activation: PackagedBundleActivationFile;
  builtinEntryPath: string | null;
  bundleEpoch: string | null;
  paths: PackagedNamespacePaths;
}): Promise<PackagedWebSidecarImplementation> {
  return await resolveParsedPackagedWebSidecarImplementation({
    ...options,
    activation: parseActivationFile(options.activation),
  });
}

export function sidecarImplementationEnv(
  implementation: SidecarImplementationSnapshot,
): NodeJS.ProcessEnv {
  return {
    [SIDECAR_IMPLEMENTATION_ENV]: JSON.stringify(implementation),
  };
}

export function createPackagedBundleActivationFile(input: {
  web: "builtin" | { presentation?: PackagedBundlePresentationSnapshot; version: string };
}): PackagedBundleActivationFile {
  return input.web === "builtin"
    ? {
      bundle: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, source: "builtin" },
      schemaVersion: 1,
    }
    : {
      bundle: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version: input.web.version },
      ...(input.web.presentation == null ? {} : { presentation: input.web.presentation }),
      schemaVersion: 1,
    };
}

export async function readPackagedBundleActivationFile(
  paths: Pick<PackagedNamespacePaths, "bundleActivationPath">,
): Promise<PackagedBundleActivationFile | null> {
  const activation = await readActivation(paths.bundleActivationPath);
  if (activation == null) return null;
  return activation.type === "builtin"
    ? {
      bundle: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, source: "builtin" },
      ...(activation.presentation == null ? {} : { presentation: activation.presentation }),
      schemaVersion: 1,
    }
    : {
      bundle: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version: activation.ref.version },
      ...(activation.presentation == null ? {} : { presentation: activation.presentation }),
      schemaVersion: 1,
    };
}

export async function writePackagedBundleActivationFile(options: {
  activation: PackagedBundleActivationFile;
  paths: Pick<PackagedNamespacePaths, "bundleActivationPath">;
}): Promise<void> {
  await mkdir(dirname(options.paths.bundleActivationPath), { recursive: true });
  await writeFile(
    options.paths.bundleActivationPath,
    `${JSON.stringify(options.activation, null, 2)}\n`,
    "utf8",
  );
}

export function packagedBundleActivationPath(paths: Pick<PackagedNamespacePaths, "dataRoot">): string {
  return join(paths.dataRoot, "bundle-activation.json");
}
