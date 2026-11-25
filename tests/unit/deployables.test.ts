/**
 * Static gate for the four deployables (Issue #965).
 *
 * The API used to be the only entrypoint the image could run: the Dockerfile
 * ended with `CMD ["node", "dist/index.js"]` and nothing defined how the
 * worker, indexer or scheduler were built, started or probed. These assertions
 * keep the Dockerfile targets, the compose services, the package scripts and
 * the health probes from drifting apart again.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

interface Stage {
  name: string;
  body: string;
}

function dockerStages(dockerfile: string): Stage[] {
  const stages: Stage[] = [];
  const lines = dockerfile.split('\n');
  let current: Stage | null = null;

  for (const line of lines) {
    const from = /^FROM\s+\S+\s+AS\s+(\w+)\s*$/i.exec(line.trim());
    if (from) {
      current = { name: from[1], body: '' };
      stages.push(current);
      continue;
    }
    if (current) current.body += `${line}\n`;
  }

  return stages;
}

const HEALTH_PORTS = { worker: 9466, indexer: 9467, scheduler: 9468, api: 4000 } as const;

const dockerfile = read('Dockerfile');
const stages = dockerStages(dockerfile);
const stageOf = (name: string): Stage => {
  const stage = stages.find((s) => s.name === name);
  if (!stage) throw new Error(`Dockerfile has no stage named "${name}"`);
  return stage;
};

// CORE_SCHEMA keeps the loader to plain maps/scalars — no tagged types.
const compose = yaml.load(read('docker-compose.yml'), { schema: yaml.CORE_SCHEMA }) as {
  services: Record<string, Record<string, unknown>>;
  volumes: Record<string, unknown>;
};
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('Dockerfile build targets (#965)', () => {
  it('defines the shared builder and runtime stages', () => {
    expect(stageOf('builder').body).toContain('npm run build');
    expect(stageOf('runtime').body).toContain('npm ci --omit=dev');
  });

  it.each(['worker', 'indexer', 'scheduler', 'api'] as const)(
    'stage "%s" builds on the shared runtime',
    (name) => {
      expect(dockerfile).toMatch(new RegExp(`FROM runtime AS ${name}\\b`));
    },
  );

  it('makes api the last stage so `docker build .` (deploy.yml) still ships the API', () => {
    expect(stages[stages.length - 1].name).toBe('api');
  });

  it.each(Object.entries(HEALTH_PORTS))(
    'stage %s runs its compiled entrypoint and probes %i',
    (name, port) => {
      const body = stageOf(name).body;
      expect(body).toContain(`HEALTH_PORT=${port}`);
      expect(body).toContain(`localhost:${port}/health/live`);

      const cmd = /CMD\s+\[\s*"node"\s*,\s*"([^"]+)"\s*\]/.exec(body);
      expect(cmd).not.toBeNull();
      const compiled = cmd![1];
      expect(compiled).toMatch(/^dist\/.+\.js$/);

      const source = compiled.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(fs.existsSync(path.join(ROOT, source))).toBe(true);
    },
  );
});

describe('package.json starts the compiled deployables (#965)', () => {
  it.each([
    ['start:worker', 'dist/workers/songWorkerMain.js'],
    ['start:indexer', 'dist/workers/indexer/index.js'],
    ['start:scheduler', 'dist/workers/scheduler.js'],
  ])('%s runs %s', (script, target) => {
    expect(packageJson.scripts[script]).toBe(`node ${target}`);
    expect(
      fs.existsSync(path.join(ROOT, target.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'))),
    ).toBe(true);
  });

  it('keeps the ts-node variants for development', () => {
    expect(packageJson.scripts['dev:scheduler']).toBe('ts-node src/workers/scheduler.ts');
  });
});

describe('docker-compose services (#965)', () => {
  it.each(['worker', 'indexer', 'scheduler'] as const)(
    'builds "%s" from its own target',
    (name) => {
      const service = compose.services[name];
      expect(service).toBeDefined();
      expect(service.build).toMatchObject({ context: '.', dockerfile: 'Dockerfile', target: name });
    },
  );

  it.each(['worker', 'indexer', 'scheduler'] as const)('probes "%s" on its health port', (name) => {
    const healthcheck = compose.services[name].healthcheck as { test: string[] };
    expect(healthcheck).toBeDefined();
    expect(healthcheck.test.join(' ')).toContain(`localhost:${HEALTH_PORTS[name]}/health/live`);
    expect(compose.services[name].environment).toMatchObject({ HEALTH_PORT: HEALTH_PORTS[name] });
  });

  it('runs the compiled indexer, not a dev-only ts-node script, in the image', () => {
    const command = compose.services.indexer.command;
    expect(command).toBeUndefined();
  });

  it('gives the scheduler a persisted backup directory', () => {
    expect(compose.services.scheduler.environment).toMatchObject({ BACKUP_DIR: '/app/backups' });
    expect(compose.services.scheduler.volumes).toContain('backupdata:/app/backups');
    expect(compose.volumes).toHaveProperty('backupdata');
  });

  it('keeps the API service building the default (api) target', () => {
    expect(compose.services.backend.build).toMatchObject({
      context: '.',
      dockerfile: 'Dockerfile',
    });
    expect((compose.services.backend.build as { target?: string }).target).toBeUndefined();
  });
});
