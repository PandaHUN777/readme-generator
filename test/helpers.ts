import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrief, type ProjectBrief } from '../src/brief.js';
import { GitHubClient } from '../src/github.js';
import { buildInventory } from '../src/inventory.js';
import type { StyleId } from '../src/styles.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface RepoFixture {
  owner: string;
  repo: string;
  repository: Record<string, unknown>;
  languages: Record<string, number>;
  releases: Array<Record<string, unknown>>;
  extraTree: Array<{ path: string; type: string; size?: number }>;
  files: Map<string, string>;
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

export function loadFixture(name: string, fileOverrides: Record<string, string | null> = {}): RepoFixture {
  const dir = path.join(FIXTURES, name);
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as Omit<RepoFixture, 'files'>;
  const files = new Map<string, string>();
  for (const rel of walk(path.join(dir, 'files'))) files.set(rel, readFileSync(path.join(dir, 'files', rel), 'utf8'));
  for (const [p, content] of Object.entries(fileOverrides)) {
    if (content === null) files.delete(p);
    else files.set(p, content);
  }
  return { ...meta, files };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface MockFetchOptions {
  /** Map of URL substring -> response factory; checked before fixture routing. */
  routes?: Array<{ match: string | RegExp; respond: (url: string, init?: RequestInit) => Response | Promise<Response> }>;
  emptyRepo?: boolean;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A fetch replacement that serves a fixture repository and records every request. Never touches the network. */
export function createMockFetch(fx: RepoFixture | null, opts: MockFetchOptions = {}) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    requests.push({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined });

    for (const r of opts.routes ?? []) {
      if (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)) return r.respond(url, init);
    }
    if (!fx) return json({ message: 'Not Found' }, 404);
    const api = `https://api.github.com/repos/${fx.owner}/${fx.repo}`;
    const branch = String(fx.repository.default_branch ?? 'main');
    const raw = `https://raw.githubusercontent.com/${fx.owner}/${fx.repo}/${branch}/`;
    if (url === api) return json(fx.repository);
    if (url === `${api}/languages`) return json(fx.languages);
    if (url.startsWith(`${api}/releases`)) return json(fx.releases);
    if (url.startsWith(`${api}/git/trees/`)) {
      if (opts.emptyRepo) return json({ message: 'Git Repository is empty.' }, 409);
      const tree: Array<{ path: string; type: string; size?: number }> = [];
      const dirs = new Set<string>();
      for (const [p, c] of fx.files) {
        tree.push({ path: p, type: 'blob', size: Buffer.byteLength(c) });
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      for (const d of dirs) tree.push({ path: d, type: 'tree' });
      tree.push(...fx.extraTree);
      return json({ sha: 'abc', tree, truncated: false });
    }
    if (url.startsWith(raw)) {
      const p = decodeURIComponent(url.slice(raw.length));
      const content = fx.files.get(p);
      return content === undefined ? new Response('404: Not Found', { status: 404 }) : new Response(content, { status: 200 });
    }
    return new Response('unexpected URL in test: ' + url, { status: 599 });
  };
  return { fetch: fetchImpl, requests };
}

/** Build fake credentials at runtime so no secret-looking literal is committed. */
export const fakeSecrets = {
  githubToken: () => 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  awsKey: () => 'AK' + 'IA' + 'ZQ3XH7KD2LMN5RTW',
  xaiKey: () => 'xa' + 'i-' + 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jh1Gf0',
  privateKey: () => '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END ' + 'RSA PRIVATE KEY-----',
};

export function captureIO() {
  let out = '';
  let err = '';
  return {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

/** Run the real retrieval + inventory + brief pipeline against a fixture repository. */
export async function briefFor(fx: RepoFixture, style: StyleId = 'professional'): Promise<ProjectBrief> {
  const mock = createMockFetch(fx);
  const client = new GitHubClient({ fetch: mock.fetch });
  const ref = { owner: fx.owner, repo: fx.repo };
  const meta = await client.getRepo(ref);
  const tree = await client.getTree(ref, meta.defaultBranch);
  const inventory = buildInventory(tree.entries, tree.truncated);
  const contents = new Map<string, string>();
  for (const f of inventory.selected) {
    const t = await client.getRawFile(ref, meta.defaultBranch, f.path, 60_000);
    if (t !== null) contents.set(f.path, t);
  }
  return buildBrief({ ref, meta, languages: await client.getLanguages(ref), release: await client.getLatestRelease(ref), inventory, contents, style });
}

