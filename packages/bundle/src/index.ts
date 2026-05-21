import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const BUNDLE_BASE_PATH_ENV = "OD_BUNDLE_BASE_PATH";
export const BUNDLE_DESCRIPTOR_FILE = "bundle.json";
export const BUNDLE_DESCRIPTOR_SCHEMA_VERSION = 1;
export const BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2 = 2;
export const BUNDLE_METADATA_FILE = "metadata.json";
export const BUNDLE_OBJECTS_DIR = "objects";
export const BUNDLE_PUBLICATION_DIGEST_FILE = "publication.json.sha256";
export const BUNDLE_PUBLICATION_FILE = "publication.json";
export const BUNDLE_PUBLICATION_LATEST_TAG = "latest";
export const BUNDLE_PUBLICATION_SCHEMA_VERSION = 1;
export const BUNDLE_STAGING_DIR = ".staging";
export const BUNDLE_STORE_VERSION = 1;

const BUNDLE_EPOCH_PATTERN = "\\d+\\.\\d+\\.\\d+(?:-[A-Za-z][A-Za-z0-9-]*\\.(?:0|[1-9]\\d*))?";
const BUNDLE_EPOCH_RE = new RegExp(`^${BUNDLE_EPOCH_PATTERN}$`);
const BUNDLE_EPOCH_VERSION_RE = new RegExp(`^(${BUNDLE_EPOCH_PATTERN})\\.([a-z][a-z0-9-]*)\\.([1-9]\\d*)$`);
const BUNDLE_PUBLICATION_PATH_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/;
const BUNDLE_PUBLICATION_PLATFORM_RE = /^(?:any|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;
const BUNDLE_SLUG_RE = /^[a-z][a-z0-9-]*$/;

export type BundleRef = {
  key: string;
  version: string;
};

export type BundleEntryKind = "js" | "tsx";

export type BundleArtifactDescriptorV1 = {
  entry: {
    kind: BundleEntryKind;
    path: string;
  };
  schemaVersion: typeof BUNDLE_DESCRIPTOR_SCHEMA_VERSION;
};

export type BundleArtifactDescriptorV2 = Record<string, unknown> & {
  entry: {
    kind: BundleEntryKind;
    path: string;
  };
  key: string;
  schemaVersion: typeof BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2;
  version: string;
};

export type BundleArtifactDescriptor = BundleArtifactDescriptorV1 | BundleArtifactDescriptorV2;

export type BundleEpochVersion = {
  epoch: string;
  sequence: number;
  slug: string;
  version: string;
};

export type BundleArtifact = {
  bundlePath: string;
  descriptor: BundleArtifactDescriptor;
  descriptorPath: string;
  entryPath: string;
};

export type BundleEntry = {
  createdAt: string;
  digest: {
    algorithm: "sha256";
    value: string;
  };
  path: string;
  ref: BundleRef;
};

export type BundleStoreMetadata = {
  bundles: BundleEntry[];
  version: typeof BUNDLE_STORE_VERSION;
};

export type BundleStorePaths = {
  basePath: string;
  metadataPath: string;
};

export type BundlePublicationLocalizedText = {
  default: string;
} & Record<string, string>;

export type BundlePublicationDisplay = {
  summary: BundlePublicationLocalizedText;
  title: BundlePublicationLocalizedText;
  version: string;
};

export type BundlePublicationVariant = {
  compatible: {
    hostEpoch: string;
  };
  platform: string;
  version: string;
};

export type BundlePublication = {
  bundle: {
    key: string;
    pathKey: string;
    variants: BundlePublicationVariant[];
  };
  metadata: {
    channel: string;
    display: BundlePublicationDisplay;
    publish: Record<string, unknown>;
    version: string;
  };
  schemaVersion: typeof BUNDLE_PUBLICATION_SCHEMA_VERSION;
};

export type BundlePublicationPaths = {
  basePath: string;
  digestPath: string;
  directory: string;
  publicationPath: string;
};

export type BundlePublicationDigest = {
  algorithm: "sha256";
  value: string;
};

export type BundlePublicationResolved = {
  digest: BundlePublicationDigest;
  paths: BundlePublicationPaths;
  publication: BundlePublication;
};

export type BundleResolved = {
  basePath: string;
  entry: BundleEntry;
  metadataPath: string;
  path: string;
  ref: BundleRef;
};

export type BundleBasePathInput = {
  env?: NodeJS.ProcessEnv;
  envName?: string;
  explicitBasePath?: string | null;
  namespaceDataPath: string;
};

export type BundleWriteInput = {
  basePath: string;
  now?: () => Date;
  ref: BundleRef;
  sourcePath: string;
};

export class BundleStoreError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BundleStoreError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set<string>(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new BundleStoreError("bundle-shape-invalid", `${label} contains unsupported fields: ${unexpected.join(", ")}`);
  }
}

function containsPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel));
}

function assertNoNullBytes(value: string, label: string): void {
  if (value.includes("\0")) throw new BundleStoreError("bundle-path-invalid", `${label} must not contain null bytes`);
}

function resolveAbsolutePath(value: string, label: string): string {
  assertNoNullBytes(value, label);
  if (!isAbsolute(value)) throw new BundleStoreError("bundle-path-not-absolute", `${label} must be absolute`);
  return resolve(value);
}

export function validateBundleKey(key: string): string {
  if (!/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/.test(key)) {
    throw new BundleStoreError(
      "bundle-key-invalid",
      `bundle key must use a colon-separated lowercase namespace pattern: ${key}`,
    );
  }
  return key;
}

export function validateBundleVersion(version: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    throw new BundleStoreError(
      "bundle-version-invalid",
      `bundle version must be a safe path segment: ${version}`,
    );
  }
  return version;
}

export function validateBundlePublicationPathKey(pathKey: string): string {
  if (
    !BUNDLE_PUBLICATION_PATH_SEGMENT_RE.test(pathKey) ||
    pathKey === "." ||
    pathKey === ".."
  ) {
    throw new BundleStoreError(
      "bundle-publication-path-key-invalid",
      `bundle publication pathKey must be a lowercase safe path segment: ${pathKey}`,
    );
  }
  return pathKey;
}

export function validateBundlePublicationChannel(channel: string): string {
  if (
    !BUNDLE_PUBLICATION_PATH_SEGMENT_RE.test(channel) ||
    channel === "." ||
    channel === ".."
  ) {
    throw new BundleStoreError(
      "bundle-publication-channel-invalid",
      `bundle publication channel must be a lowercase safe path segment: ${channel}`,
    );
  }
  return channel;
}

export function validateBundlePublicationVersionOrTag(versionOrTag: string): string {
  return validateBundleVersion(versionOrTag);
}

export function validateBundlePublicationPlatform(platform: string): string {
  if (!BUNDLE_PUBLICATION_PLATFORM_RE.test(platform)) {
    throw new BundleStoreError(
      "bundle-publication-platform-invalid",
      `bundle publication platform must be any or a lowercase platform tag: ${platform}`,
    );
  }
  return platform;
}

export function validateBundleEpoch(epoch: string): string {
  if (!BUNDLE_EPOCH_RE.test(epoch)) {
    throw new BundleStoreError(
      "bundle-epoch-invalid",
      `bundle epoch must use X.Y.Z or X.Y.Z-<channel>.N: ${epoch}`,
    );
  }
  return epoch;
}

export function parseBundleEpochVersion(version: string): BundleEpochVersion {
  const safeVersion = validateBundleVersion(version);
  const match = BUNDLE_EPOCH_VERSION_RE.exec(safeVersion);
  if (match == null) {
    throw new BundleStoreError(
      "bundle-version-invalid",
      `bundle version must use <epoch>.<bundle_slug>.M with epoch X.Y.Z or X.Y.Z-<channel>.N: ${version}`,
    );
  }

  const sequence = Number(match[3]);
  if (!Number.isSafeInteger(sequence)) {
    throw new BundleStoreError("bundle-version-invalid", `bundle version sequence is too large: ${version}`);
  }

  return {
    epoch: validateBundleEpoch(match[1] ?? ""),
    sequence,
    slug: match[2] ?? "",
    version: safeVersion,
  };
}

export function createBundleEpochVersion(input: {
  epoch: string;
  sequence: number;
  slug: string;
}): string {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new BundleStoreError("bundle-version-invalid", `bundle version sequence must be a positive integer: ${input.sequence}`);
  }
  if (!BUNDLE_SLUG_RE.test(input.slug)) {
    throw new BundleStoreError("bundle-version-invalid", `bundle slug must be lowercase alphanumeric or hyphenated: ${input.slug}`);
  }
  return parseBundleEpochVersion(`${validateBundleEpoch(input.epoch)}.${input.slug}.${input.sequence}`).version;
}

export function validateBundleRef(ref: BundleRef): BundleRef {
  if (!isRecord(ref)) {
    throw new BundleStoreError("bundle-ref-invalid", "bundle ref must be an object");
  }
  return {
    key: validateBundleKey(ref.key),
    version: validateBundleVersion(ref.version),
  };
}

function validateBundleDescriptorEntry(value: unknown): BundleArtifactDescriptor["entry"] {
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-descriptor-invalid", "bundle descriptor entry must be an object");
  }

  if (value.kind !== "js" && value.kind !== "tsx") {
    throw new BundleStoreError("bundle-entry-kind-invalid", "bundle descriptor entry kind must be js or tsx");
  }

  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new BundleStoreError("bundle-entry-path-invalid", "bundle descriptor entry path must be a non-empty string");
  }
  assertNoNullBytes(value.path, "bundle descriptor entry path");
  if (isAbsolute(value.path)) {
    throw new BundleStoreError("bundle-entry-path-invalid", "bundle descriptor entry path must be relative");
  }

  return {
    kind: value.kind,
    path: value.path.split("\\").join("/"),
  };
}

export function validateBundleDescriptor(value: unknown): BundleArtifactDescriptor {
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-descriptor-invalid", "bundle descriptor must contain schemaVersion=1 or schemaVersion=2");
  }
  if (value.schemaVersion !== BUNDLE_DESCRIPTOR_SCHEMA_VERSION && value.schemaVersion !== BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2) {
    throw new BundleStoreError("bundle-descriptor-invalid", "bundle descriptor must contain schemaVersion=1 or schemaVersion=2");
  }

  const entry = validateBundleDescriptorEntry(value.entry);

  if (value.schemaVersion === BUNDLE_DESCRIPTOR_SCHEMA_VERSION) {
    return {
      entry,
      schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
    };
  }

  if (typeof value.key !== "string") {
    throw new BundleStoreError("bundle-descriptor-invalid", "schemaVersion=2 bundle descriptor key must be a string");
  }
  if (typeof value.version !== "string") {
    throw new BundleStoreError("bundle-descriptor-invalid", "schemaVersion=2 bundle descriptor version must be a string");
  }

  return {
    ...value,
    entry,
    key: validateBundleKey(value.key),
    schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2,
    version: parseBundleEpochVersion(value.version).version,
  } as BundleArtifactDescriptorV2;
}

function validateBundlePublicationLocalizedText(value: unknown, label: string): BundlePublicationLocalizedText {
  if (value == null) return { default: "" };
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-publication-invalid", `${label} must be an object`);
  }

  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (key.length === 0 || key.includes("\0")) {
      throw new BundleStoreError("bundle-publication-invalid", `${label} keys must be non-empty strings`);
    }
    if (typeof text !== "string") {
      throw new BundleStoreError("bundle-publication-invalid", `${label}.${key} must be a string`);
    }
    assertNoNullBytes(text, `${label}.${key}`);
    result[key] = text;
  }
  return { ...result, default: result.default ?? "" };
}

function validateBundlePublicationDisplay(value: unknown, metadataVersion: string): BundlePublicationDisplay {
  if (value == null) {
    return {
      summary: { default: "" },
      title: { default: "" },
      version: metadataVersion,
    };
  }
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication metadata.display must be an object");
  }
  assertKnownKeys(value, ["summary", "title", "version"], "bundle publication metadata.display");

  const version = value.version == null ? metadataVersion : value.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication display.version must be a non-empty string");
  }
  assertNoNullBytes(version, "bundle publication display.version");

  return {
    summary: validateBundlePublicationLocalizedText(value.summary, "bundle publication display.summary"),
    title: validateBundlePublicationLocalizedText(value.title, "bundle publication display.title"),
    version,
  };
}

function validateBundlePublicationMetadata(value: unknown): BundlePublication["metadata"] {
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication metadata must be an object");
  }
  assertKnownKeys(value, ["channel", "display", "publish", "version"], "bundle publication metadata");
  if (typeof value.channel !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication metadata.channel must be a string");
  }
  if (typeof value.version !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication metadata.version must be a string");
  }
  const publish = value.publish == null ? {} : value.publish;
  if (!isRecord(publish)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication metadata.publish must be an object");
  }
  const version = validateBundlePublicationVersionOrTag(value.version);
  return {
    channel: validateBundlePublicationChannel(value.channel),
    display: validateBundlePublicationDisplay(value.display, version),
    publish: { ...publish },
    version,
  };
}

function validateBundlePublicationVariant(value: unknown): BundlePublicationVariant {
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication variant must be an object");
  }
  assertKnownKeys(value, ["compatible", "platform", "version"], "bundle publication variant");
  if (typeof value.platform !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication variant.platform must be a string");
  }
  if (typeof value.version !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication variant.version must be a string");
  }
  if (!isRecord(value.compatible)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication variant.compatible must be an object");
  }
  assertKnownKeys(value.compatible, ["hostEpoch"], "bundle publication variant.compatible");
  if (typeof value.compatible.hostEpoch !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication variant.compatible.hostEpoch must be a string");
  }

  const hostEpoch = validateBundleEpoch(value.compatible.hostEpoch);
  const parsedVersion = parseBundleEpochVersion(value.version);
  if (parsedVersion.epoch !== hostEpoch) {
    throw new BundleStoreError(
      "bundle-publication-host-epoch-mismatch",
      `bundle publication variant ${parsedVersion.version} must match compatible.hostEpoch ${hostEpoch}`,
    );
  }

  return {
    compatible: { hostEpoch },
    platform: validateBundlePublicationPlatform(value.platform),
    version: parsedVersion.version,
  };
}

function validateBundlePublicationBundle(value: unknown): BundlePublication["bundle"] {
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication bundle must be an object");
  }
  assertKnownKeys(value, ["key", "pathKey", "variants"], "bundle publication bundle");
  if (typeof value.key !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication bundle.key must be a string");
  }
  if (typeof value.pathKey !== "string") {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication bundle.pathKey must be a string");
  }
  if (!Array.isArray(value.variants) || value.variants.length === 0) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication bundle.variants must be a non-empty array");
  }

  const variants = value.variants.map(validateBundlePublicationVariant);
  const seen = new Set<string>();
  for (const variant of variants) {
    const identity = `${variant.compatible.hostEpoch}\0${variant.platform}`;
    if (seen.has(identity)) {
      throw new BundleStoreError(
        "bundle-publication-variant-duplicate",
        `bundle publication contains duplicate variant for ${variant.platform} ${variant.compatible.hostEpoch}`,
      );
    }
    seen.add(identity);
  }

  return {
    key: validateBundleKey(value.key),
    pathKey: validateBundlePublicationPathKey(value.pathKey),
    variants,
  };
}

export function validateBundlePublication(value: unknown): BundlePublication {
  if (!isRecord(value)) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication must be a JSON object");
  }
  assertKnownKeys(value, ["bundle", "metadata", "schemaVersion"], "bundle publication");
  if (value.schemaVersion !== BUNDLE_PUBLICATION_SCHEMA_VERSION) {
    throw new BundleStoreError("bundle-publication-invalid", "bundle publication must contain schemaVersion=1");
  }

  return {
    bundle: validateBundlePublicationBundle(value.bundle),
    metadata: validateBundlePublicationMetadata(value.metadata),
    schemaVersion: BUNDLE_PUBLICATION_SCHEMA_VERSION,
  };
}

export function selectBundlePublicationVariant(input: {
  hostEpoch: string;
  key: string;
  platform: string;
  publication: unknown;
}): BundlePublicationVariant {
  const publication = validateBundlePublication(input.publication);
  const key = validateBundleKey(input.key);
  if (publication.bundle.key !== key) {
    throw new BundleStoreError(
      "bundle-publication-key-mismatch",
      `bundle publication key ${publication.bundle.key} does not match requested key ${key}`,
    );
  }

  const hostEpoch = validateBundleEpoch(input.hostEpoch);
  const platform = validateBundlePublicationPlatform(input.platform);
  const hostMatches = publication.bundle.variants.filter((variant) => variant.compatible.hostEpoch === hostEpoch);
  const exactMatches = hostMatches.filter((variant) => variant.platform === platform);
  if (exactMatches.length === 1) return exactMatches[0] as BundlePublicationVariant;
  if (exactMatches.length > 1) {
    throw new BundleStoreError(
      "bundle-publication-variant-ambiguous",
      `bundle publication has multiple variants for ${platform} ${hostEpoch}`,
    );
  }

  const anyMatches = hostMatches.filter((variant) => variant.platform === "any");
  if (anyMatches.length === 1) return anyMatches[0] as BundlePublicationVariant;
  if (anyMatches.length > 1) {
    throw new BundleStoreError(
      "bundle-publication-variant-ambiguous",
      `bundle publication has multiple any-platform variants for ${hostEpoch}`,
    );
  }

  throw new BundleStoreError(
    "bundle-publication-variant-not-found",
    `bundle publication has no variant for ${key} on ${platform} with host epoch ${hostEpoch}`,
  );
}

export function bundleRefsEqual(left: BundleRef, right: BundleRef): boolean {
  return left.key === right.key && left.version === right.version;
}

export function resolveBundleBasePath(input: BundleBasePathInput): string {
  const env = input.env ?? process.env;
  const envName = input.envName ?? BUNDLE_BASE_PATH_ENV;
  const configured = input.explicitBasePath ?? env[envName] ?? join(input.namespaceDataPath, "bundles");
  return resolveAbsolutePath(configured, "bundle base path");
}

export function bundleStorePaths(basePath: string): BundleStorePaths {
  const resolvedBasePath = resolveAbsolutePath(basePath, "bundle base path");
  return {
    basePath: resolvedBasePath,
    metadataPath: join(resolvedBasePath, BUNDLE_METADATA_FILE),
  };
}

export function bundlePublicationPaths(input: {
  basePath: string;
  channel: string;
  pathKey: string;
  versionOrTag: string;
}): BundlePublicationPaths {
  const basePath = resolveAbsolutePath(input.basePath, "bundle publication base path");
  const directory = join(
    basePath,
    validateBundlePublicationPathKey(input.pathKey),
    validateBundlePublicationChannel(input.channel),
    validateBundlePublicationVersionOrTag(input.versionOrTag),
  );
  return {
    basePath,
    digestPath: join(directory, BUNDLE_PUBLICATION_DIGEST_FILE),
    directory,
    publicationPath: join(directory, BUNDLE_PUBLICATION_FILE),
  };
}

export function bundlePublicationPathsForPublication(input: {
  basePath: string;
  publication: unknown;
  versionOrTag?: string;
}): BundlePublicationPaths {
  const publication = validateBundlePublication(input.publication);
  return bundlePublicationPaths({
    basePath: input.basePath,
    channel: publication.metadata.channel,
    pathKey: publication.bundle.pathKey,
    versionOrTag: input.versionOrTag ?? publication.metadata.version,
  });
}

export function resolveBundleEntryPath(input: {
  bundlePath: string;
  descriptor: BundleArtifactDescriptor;
}): string {
  const bundlePath = resolveAbsolutePath(input.bundlePath, "bundle path");
  const descriptor = validateBundleDescriptor(input.descriptor);
  const entryPath = resolve(bundlePath, descriptor.entry.path);
  if (!containsPath(bundlePath, entryPath)) {
    throw new BundleStoreError("bundle-entry-path-escaped", "bundle descriptor entry path escaped the bundle path");
  }
  return entryPath;
}

export async function readBundleDescriptor(bundlePath: string): Promise<BundleArtifactDescriptor> {
  const resolvedBundlePath = resolveAbsolutePath(bundlePath, "bundle path");
  try {
    return validateBundleDescriptor(JSON.parse(await readFile(join(resolvedBundlePath, BUNDLE_DESCRIPTOR_FILE), "utf8")));
  } catch (error) {
    if (error instanceof BundleStoreError) throw error;
    throw new BundleStoreError("bundle-descriptor-read-failed", error instanceof Error ? error.message : String(error));
  }
}

export async function resolveBundleArtifact(bundlePath: string): Promise<BundleArtifact> {
  const resolvedBundlePath = resolveAbsolutePath(bundlePath, "bundle path");
  const bundleInfo = await lstat(resolvedBundlePath);
  if (!bundleInfo.isDirectory()) throw new BundleStoreError("bundle-path-not-directory", "bundle path must resolve to a directory");
  if (bundleInfo.isSymbolicLink()) throw new BundleStoreError("bundle-path-symlink", "bundle path must not be a symlink");

  const descriptor = await readBundleDescriptor(resolvedBundlePath);
  const entryPath = resolveBundleEntryPath({ bundlePath: resolvedBundlePath, descriptor });
  let entryInfo;
  try {
    entryInfo = await lstat(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BundleStoreError("bundle-entry-not-found", "bundle descriptor entry path does not exist");
    }
    throw error;
  }
  if (!entryInfo.isFile()) throw new BundleStoreError("bundle-entry-not-file", "bundle descriptor entry path must resolve to a file");
  if (entryInfo.isSymbolicLink()) throw new BundleStoreError("bundle-entry-symlink", "bundle descriptor entry path must not be a symlink");

  return {
    bundlePath: resolvedBundlePath,
    descriptor,
    descriptorPath: join(resolvedBundlePath, BUNDLE_DESCRIPTOR_FILE),
    entryPath,
  };
}

function objectId(ref: BundleRef): string {
  return createHash("sha256").update(`${ref.key}\0${ref.version}`).digest("hex").slice(0, 24);
}

function operationId(): string {
  return `${Date.now()}-${process.pid}-${randomBytes(6).toString("hex")}`;
}

function objectContentPath(basePath: string, ref: BundleRef, operation = operationId()): string {
  return join(basePath, BUNDLE_OBJECTS_DIR, objectId(ref), operation, "content");
}

function relativeStorePath(basePath: string, candidate: string): string {
  const rel = relative(basePath, candidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new BundleStoreError("bundle-path-escaped", "bundle object path escaped the bundle base path");
  }
  return rel.split("\\").join("/");
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const tmp = `${path}.${operationId()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

async function writeJsonAtomic(path: string, payload: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export function bundlePublicationDigest(content: string | Buffer): BundlePublicationDigest {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(content).digest("hex"),
  };
}

export function parseBundlePublicationDigest(content: string): BundlePublicationDigest {
  const digest = content.trim().split(/\s+/)[0] ?? "";
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw new BundleStoreError("bundle-publication-digest-invalid", "bundle publication digest must contain a sha256 hex value");
  }
  return {
    algorithm: "sha256",
    value: digest.toLowerCase(),
  };
}

export async function writeBundlePublication(input: {
  basePath: string;
  publication: unknown;
  versionOrTag?: string;
}): Promise<BundlePublicationResolved> {
  const publication = validateBundlePublication(input.publication);
  const paths = bundlePublicationPathsForPublication({
    basePath: input.basePath,
    publication,
    versionOrTag: input.versionOrTag,
  });
  const content = `${JSON.stringify(publication, null, 2)}\n`;
  const digest = bundlePublicationDigest(content);
  await writeTextAtomic(paths.publicationPath, content);
  await writeTextAtomic(paths.digestPath, `${digest.value}  ${BUNDLE_PUBLICATION_FILE}\n`);
  return { digest, paths, publication };
}

export async function readBundlePublication(input: {
  basePath: string;
  channel: string;
  pathKey: string;
  verifyDigest?: boolean;
  versionOrTag: string;
}): Promise<BundlePublicationResolved> {
  const paths = bundlePublicationPaths(input);
  let content: string;
  try {
    content = await readFile(paths.publicationPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BundleStoreError("bundle-publication-not-found", `bundle publication not found: ${paths.publicationPath}`);
    }
    throw error;
  }

  const digest = bundlePublicationDigest(content);
  if (input.verifyDigest !== false) {
    let digestContent: string;
    try {
      digestContent = await readFile(paths.digestPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BundleStoreError("bundle-publication-digest-missing", `bundle publication digest missing: ${paths.digestPath}`);
      }
      throw error;
    }
    const expected = parseBundlePublicationDigest(digestContent);
    if (expected.value !== digest.value) {
      throw new BundleStoreError(
        "bundle-publication-digest-mismatch",
        `bundle publication digest mismatch for ${paths.publicationPath}`,
      );
    }
  }

  return {
    digest,
    paths,
    publication: validateBundlePublication(JSON.parse(content)),
  };
}

function parseMetadata(value: unknown): BundleStoreMetadata {
  if (!isRecord(value) || value.version !== BUNDLE_STORE_VERSION || !Array.isArray(value.bundles)) {
    throw new BundleStoreError("bundle-metadata-invalid", "bundle metadata has an unsupported shape");
  }

  const bundles = value.bundles.map((entry): BundleEntry => {
    if (!isRecord(entry)) throw new BundleStoreError("bundle-metadata-invalid", "bundle entry must be an object");
    const refValue = entry.ref;
    const digestValue = entry.digest;
    if (!isRecord(refValue)) throw new BundleStoreError("bundle-metadata-invalid", "bundle entry ref must be an object");
    if (!isRecord(digestValue)) throw new BundleStoreError("bundle-metadata-invalid", "bundle entry digest must be an object");
    if (digestValue.algorithm !== "sha256" || typeof digestValue.value !== "string" || digestValue.value.length === 0) {
      throw new BundleStoreError("bundle-metadata-invalid", "bundle entry digest must be sha256");
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new BundleStoreError("bundle-metadata-invalid", "bundle entry path must be a string");
    }
    if (typeof entry.createdAt !== "string" || entry.createdAt.length === 0) {
      throw new BundleStoreError("bundle-metadata-invalid", "bundle entry createdAt must be a string");
    }
    return {
      createdAt: entry.createdAt,
      digest: {
        algorithm: "sha256",
        value: digestValue.value,
      },
      path: entry.path,
      ref: validateBundleRef(refValue as BundleRef),
    };
  });

  return { bundles, version: BUNDLE_STORE_VERSION };
}

export async function readBundleStore(basePath: string): Promise<BundleStoreMetadata> {
  const paths = bundleStorePaths(basePath);
  try {
    return parseMetadata(JSON.parse(await readFile(paths.metadataPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bundles: [], version: BUNDLE_STORE_VERSION };
    }
    if (error instanceof BundleStoreError) throw error;
    throw new BundleStoreError("bundle-metadata-read-failed", error instanceof Error ? error.message : String(error));
  }
}

async function writeBundleStore(basePath: string, metadata: BundleStoreMetadata): Promise<void> {
  const paths = bundleStorePaths(basePath);
  await writeJsonAtomic(paths.metadataPath, metadata);
}

async function assertDirectoryWithInternalSymlinks(root: string): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory()) throw new BundleStoreError("bundle-source-not-directory", "bundle source path must be a directory");
  if (info.isSymbolicLink()) throw new BundleStoreError("bundle-source-symlink", "bundle source path must not be a symlink");
  const realRoot = await realpath(root);

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const child = await lstat(path);
      if (child.isSymbolicLink()) {
        const target = await readlink(path);
        if (isAbsolute(target)) {
          throw new BundleStoreError("bundle-source-symlink", "bundle source symlinks must be relative");
        }

        let realTarget;
        try {
          realTarget = await realpath(path);
        } catch {
          throw new BundleStoreError("bundle-source-symlink", "bundle source symlinks must not be broken");
        }
        if (!containsPath(realRoot, realTarget)) {
          throw new BundleStoreError("bundle-source-symlink", "bundle source symlinks must stay inside the source tree");
        }
        continue;
      }
      if (entry.isDirectory()) await walk(path);
    }
  }

  await walk(root);
}

async function digestDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).split("\\").join("/");
      const info = await lstat(path);
      hash.update(entry.isDirectory() ? "dir\0" : "file\0");
      hash.update(rel);
      hash.update("\0");
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        hash.update(await readFile(path));
      } else if (entry.isSymbolicLink()) {
        hash.update(await readlink(path));
      } else {
        throw new BundleStoreError("bundle-source-invalid-entry", `unsupported bundle source entry: ${rel}`);
      }
      hash.update("\0");
      hash.update(String(info.mode));
      hash.update("\0");
    }
  }

  await walk(root);
  return hash.digest("hex");
}

function entryPath(basePath: string, entry: BundleEntry): string {
  const abs = resolve(basePath, entry.path);
  if (!containsPath(basePath, abs)) {
    throw new BundleStoreError("bundle-path-escaped", "bundle entry path escaped the bundle base path");
  }
  return abs;
}

export async function listBundles(basePath: string): Promise<BundleEntry[]> {
  return (await readBundleStore(basePath)).bundles;
}

export async function resolveBundle(input: { basePath: string; ref: BundleRef }): Promise<BundleResolved> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const metadata = await readBundleStore(paths.basePath);
  const entry = metadata.bundles.find((candidate) => bundleRefsEqual(candidate.ref, ref));
  if (entry == null) {
    throw new BundleStoreError("bundle-not-found", `bundle not found for ${ref.key} ${ref.version}`);
  }
  const path = entryPath(paths.basePath, entry);
  const resolvedRealBase = await realpath(paths.basePath);
  const resolvedRealPath = await realpath(path);
  if (!containsPath(resolvedRealBase, resolvedRealPath)) {
    throw new BundleStoreError("bundle-path-escaped", "bundle resolved outside the bundle base path");
  }
  const info = await stat(path);
  if (!info.isDirectory()) throw new BundleStoreError("bundle-path-not-directory", "bundle path must resolve to a directory");
  return {
    basePath: paths.basePath,
    entry,
    metadataPath: paths.metadataPath,
    path,
    ref,
  };
}

export async function addBundle(input: BundleWriteInput): Promise<BundleResolved> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const sourcePath = resolveAbsolutePath(input.sourcePath, "bundle source path");
  await assertDirectoryWithInternalSymlinks(sourcePath);
  const metadata = await readBundleStore(paths.basePath);
  if (metadata.bundles.some((entry) => bundleRefsEqual(entry.ref, ref))) {
    throw new BundleStoreError("bundle-already-exists", `bundle already exists for ${ref.key} ${ref.version}`);
  }

  await mkdir(paths.basePath, { recursive: true });
  const stagingPath = join(paths.basePath, BUNDLE_STAGING_DIR, operationId());
  const finalPath = objectContentPath(paths.basePath, ref);
  await mkdir(resolve(stagingPath, ".."), { recursive: true });
  await cp(sourcePath, stagingPath, { recursive: true, verbatimSymlinks: true });
  await mkdir(resolve(finalPath, ".."), { recursive: true });
  await rename(stagingPath, finalPath);

  const entry: BundleEntry = {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    digest: {
      algorithm: "sha256",
      value: await digestDirectory(finalPath),
    },
    path: relativeStorePath(paths.basePath, finalPath),
    ref,
  };
  await writeBundleStore(paths.basePath, {
    bundles: [...metadata.bundles, entry].sort((a, b) => `${a.ref.key}\0${a.ref.version}`.localeCompare(`${b.ref.key}\0${b.ref.version}`)),
    version: BUNDLE_STORE_VERSION,
  });
  return await resolveBundle({ basePath: paths.basePath, ref });
}

export async function replaceBundle(input: BundleWriteInput): Promise<BundleResolved> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const sourcePath = resolveAbsolutePath(input.sourcePath, "bundle source path");
  await assertDirectoryWithInternalSymlinks(sourcePath);
  const metadata = await readBundleStore(paths.basePath);
  const existing = metadata.bundles.find((entry) => bundleRefsEqual(entry.ref, ref));
  const existingPath = existing == null ? null : entryPath(paths.basePath, existing);

  await mkdir(paths.basePath, { recursive: true });
  const stagingPath = join(paths.basePath, BUNDLE_STAGING_DIR, operationId());
  const finalPath = objectContentPath(paths.basePath, ref);
  await mkdir(resolve(stagingPath, ".."), { recursive: true });
  await cp(sourcePath, stagingPath, { recursive: true, verbatimSymlinks: true });
  await mkdir(resolve(finalPath, ".."), { recursive: true });
  await rename(stagingPath, finalPath);

  const nextEntry: BundleEntry = {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    digest: {
      algorithm: "sha256",
      value: await digestDirectory(finalPath),
    },
    path: relativeStorePath(paths.basePath, finalPath),
    ref,
  };
  await writeBundleStore(paths.basePath, {
    bundles: [
      ...metadata.bundles.filter((entry) => !bundleRefsEqual(entry.ref, ref)),
      nextEntry,
    ].sort((a, b) => `${a.ref.key}\0${a.ref.version}`.localeCompare(`${b.ref.key}\0${b.ref.version}`)),
    version: BUNDLE_STORE_VERSION,
  });
  if (existingPath != null) {
    await rm(existingPath, { force: true, recursive: true }).catch(() => undefined);
  }
  return await resolveBundle({ basePath: paths.basePath, ref });
}

export async function deleteBundle(input: { basePath: string; ref: BundleRef }): Promise<boolean> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const metadata = await readBundleStore(paths.basePath);
  const existing = metadata.bundles.find((entry) => bundleRefsEqual(entry.ref, ref));
  if (existing == null) return false;
  const existingPath = entryPath(paths.basePath, existing);
  await writeBundleStore(paths.basePath, {
    bundles: metadata.bundles.filter((entry) => !bundleRefsEqual(entry.ref, ref)),
    version: BUNDLE_STORE_VERSION,
  });
  await rm(existingPath, { force: true, recursive: true }).catch(() => undefined);
  return true;
}

export async function deleteBundleKey(input: { basePath: string; key: string }): Promise<number> {
  const key = validateBundleKey(input.key);
  const paths = bundleStorePaths(input.basePath);
  const metadata = await readBundleStore(paths.basePath);
  const removed = metadata.bundles.filter((entry) => entry.ref.key === key);
  if (removed.length === 0) return 0;
  const removedPaths = removed.map((entry) => entryPath(paths.basePath, entry));
  await writeBundleStore(paths.basePath, {
    bundles: metadata.bundles.filter((entry) => entry.ref.key !== key),
    version: BUNDLE_STORE_VERSION,
  });
  await Promise.all(removedPaths.map((path) => rm(path, { force: true, recursive: true }).catch(() => undefined)));
  return removed.length;
}
