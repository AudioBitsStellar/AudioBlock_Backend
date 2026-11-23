/**
 * Container hardening assertions (#966).
 *
 * The runtime guarantees live in YAML, so the only way to keep them is to read
 * the manifests back and assert them the way `docker compose config` resolves
 * them. Every expectation here mirrors a setting that was verified to boot
 * against the pinned images, so a regression is a real deployment failure
 * rather than a lint complaint.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.join(__dirname, '..');

type ComposeService = Record<string, unknown>;
type ComposeDoc = { services?: Record<string, ComposeService> };
type VolumeItem = string | { target?: string; type?: string };
type ResourceLimits = { pids?: unknown; memory?: unknown; cpus?: unknown };

function load(file: string): ComposeDoc {
  return (yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8')) || {}) as ComposeDoc;
}

/** The two manifests that describe a deployed environment. */
const OVERLAYS = ['docker-compose.prod.yml', 'docker-compose.staging.yml'];

/** Services that must carry the full hardening set in both overlays. */
const HARDENED = ['backend', 'db', 'redis', 'rabbitmq'];

/**
 * The keys a deployment can regress on. Parity compares these and nothing
 * else, so resource ceilings — which differ legitimately between environments
 * — stay out of the comparison.
 */
const HARDENING_KEYS = ['read_only', 'cap_drop', 'cap_add', 'security_opt', 'tmpfs'];

function service(file: string, name: string): ComposeService {
  const doc = load(file);
  const svc = doc.services?.[name];
  if (!svc) throw new Error(`${file} does not define service "${name}"`);
  return svc;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The container path each volume entry lands on, in either short or long form. */
function volumeTargets(value: unknown): string[] {
  return (list(value) as VolumeItem[]).map((item) =>
    typeof item === 'string' ? (item.split(':')[1] ?? item) : (item.target ?? ''),
  );
}

function resourceLimits(file: string, name: string): ResourceLimits {
  const deploy = service(file, name).deploy as { resources?: { limits?: ResourceLimits } };
  return deploy?.resources?.limits ?? {};
}

/**
 * What the kernel is being told to refuse on the container's behalf.
 *
 * A plain function rather than one long `describe.each` callback, so the same
 * spec runs against every manifest without the assertion list outliving the
 * repository's per-function size limit.
 */
function kernelHardeningSpecs(file: string): void {
  it.each(HARDENED)('runs %s on a read-only root filesystem', (name) => {
    expect(service(file, name).read_only).toBe(true);
  });

  it.each(HARDENED)('drops every Linux capability for %s', (name) => {
    const svc = service(file, name);
    expect(list(svc.cap_drop)).toEqual(['ALL']);
    // Anything re-added has to be justified in the manifest comment; the
    // backend itself must stay at zero capabilities.
    const added = list(svc.cap_add).map(String);
    if (name === 'backend') expect(added).toEqual([]);
  });

  it.each(HARDENED)('forbids privilege escalation in %s', (name) => {
    expect(list(service(file, name).security_opt)).toContain('no-new-privileges:true');
  });

  it.each(HARDENED)('caps the process count for %s', (name) => {
    const limits = resourceLimits(file, name);
    expect(typeof limits.pids).toBe('number');
    expect(limits.memory).toBeTruthy();
    expect(limits.cpus).toBeTruthy();
  });
}

/**
 * How the container starts and what it may write to — the half of #966 that
 * the base file and Compose's merge rules can silently undo.
 */
function mountAndStartupSpecs(file: string): void {
  it('gives the backend no writable path other than uploads and tmp', () => {
    const items = list(service(file, 'backend').volumes) as VolumeItem[];
    expect(volumeTargets(items).sort()).toEqual(['/app/uploads', '/tmp']);
    // A `type: bind` entry here is a host mount over the hardened image root.
    for (const item of items) {
      if (typeof item !== 'string') expect(item.type).not.toBe('bind');
    }
  });

  it('starts the server with node rather than through a shell', () => {
    // `sh -c "npm start"` intercepts SIGTERM, so the graceful drain never
    // runs, and npm needs a writable cache the read-only root does not give.
    expect(service(file, 'backend').command).toEqual(['node', 'dist/index.js']);
  });

  it('does not hard-depend on the profile-gated rabbitmq service', () => {
    // The base file puts rabbitmq behind `profiles`, so a mandatory dependency
    // makes `docker compose -f ... -f ... config` fail outright. `required:
    // false` keeps the start order when the queue profile is enabled and still
    // validates for the minimal API + DB + Redis stack.
    const depends = (service(file, 'backend').depends_on ?? {}) as Record<
      string,
      { required?: boolean }
    >;
    expect(depends.rabbitmq?.required).toBe(false);
  });
}

describe.each(OVERLAYS)('%s (#966)', (file) => {
  kernelHardeningSpecs(file);
  mountAndStartupSpecs(file);
});

describe('staging/production parity (#966)', () => {
  it.each(HARDENED)('hardens %s identically in both manifests', (name) => {
    const shape = (svc: ComposeService): string[] =>
      HARDENING_KEYS.filter((key) => key in svc)
        .sort()
        .map((key) => `${key}=${JSON.stringify(svc[key])}`);

    expect(shape(service('docker-compose.staging.yml', name))).toEqual(
      shape(service('docker-compose.prod.yml', name)),
    );
  });
});

describe('base topology and image (#966)', () => {
  it('does not bind-mount the source tree', () => {
    // Compose merges `volumes` by target path, so a source mount declared in
    // the base file is inherited by every overlay that does not redeclare that
    // exact target — which would hand production a writable /app over the
    // hardened image root. The hot-reload mounts belong in
    // docker-compose.override.yml, which is never loaded for an explicit
    // `-f docker-compose.yml -f docker-compose.prod.yml` invocation.
    const targets = volumeTargets(load('docker-compose.yml').services?.backend?.volumes);
    expect(targets).not.toContain('/app');
    expect(targets).not.toContain('/app/node_modules');
  });

  it('runs the image as a non-root user and keeps dev tooling out of it', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const finalStage = dockerfile.split(/^FROM /m).slice(-1)[0];
    expect(finalStage).toMatch(/^USER appuser/m);
    expect(finalStage).toMatch(/HEALTHCHECK /);
    // A `RUN npm ci` in the runtime stage reinstalls from the registry and
    // executes the root `prepare` script — husky, a devDependency that
    // `--omit=dev` has just removed, which is why the baseline image never
    // built (npm error code 127). Only the instruction line matters.
    expect(finalStage).not.toMatch(/^RUN npm ci/m);
    expect(finalStage).toMatch(/^COPY --from=builder \/app\/dist \.\/dist/m);
  });
});
