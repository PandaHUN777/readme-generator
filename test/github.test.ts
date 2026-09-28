import { describe, expect, it } from 'vitest';
import { GitHubError, UsageError } from '../src/errors.js';
import { GitHubClient, parseNextLink, parseRepoUrl } from '../src/github.js';
import { createMockFetch, fakeSecrets, json, loadFixture } from './helpers.js';

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/acme/widget', 'acme', 'widget'],
    ['https://github.com/acme/widget/', 'acme', 'widget'],
    ['https://github.com/acme/widget.git', 'acme', 'widget'],
    ['http://www.github.com/Acme-Co/my.repo_1', 'Acme-Co', 'my.repo_1'],
    ['github.com/acme/widget', 'acme', 'widget'],
    ['  https://github.com/acme/widget  ', 'acme', 'widget'],
  ])('accepts %s', (input, owner, repo) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo });
  });

  it.each([
    ['', /No repository URL/],
    ['not a url at all', /not a valid|does not name/],
    ['https://gitlab.com/acme/widget', /Only github\.com/],
    ['https://github.com/acme', /does not name a repository/],
    ['https://github.com/acme/widget/tree/main/src', /points inside a repository/],
    ['git@github.com:acme/widget.git', /SSH remote/],
    ['ftp://github.com/acme/widget', /Unsupported URL scheme/],
    ['https://user:pass@github.com/acme/widget', /credentials/],
    ['https://github.com/-bad-/widget', /not a valid GitHub owner/],
    ['https://github.com/acme/wid get', /not a valid GitHub repository name|does not name|points inside/],
    ['https://github.com/acme/widget?tab=readme', /query string/],
  ])('rejects %j', (input, message) => {
    expect(() => parseRepoUrl(input)).toThrow(UsageError);
    expect(() => parseRepoUrl(input)).toThrow(message);
  });
});

describe('GitHubClient', () => {
  const ref = { owner: 'acme', repo: 'widget' };

  it('fetches metadata and only issues GET requests', async () => {
    const fx = loadFixture('widget');
    const mock = createMockFetch(fx);
    const client = new GitHubClient({ fetch: mock.fetch });
    const meta = await client.getRepo(ref);
    expect(meta).toMatchObject({ fullName: 'acme/widget', defaultBranch: 'main', topics: ['cli', 'widgets'], license: { spdxId: 'MIT' } });
    const tree = await client.getTree(ref, 'main');
    expect(tree.entries.some((e) => e.path === 'package.json')).toBe(true);
    expect(await client.getLatestRelease(ref)).toMatchObject({ tagName: 'v1.2.0' });
    expect(await client.getRawFile(ref, 'main', 'package.json', 10_000)).toContain('@acme/widget');
    expect(mock.requests.every((r) => r.method === 'GET' && r.body === undefined)).toBe(true);
  });

  it('sends the token as a bearer header but never includes it in errors', async () => {
    const token = fakeSecrets.githubToken();
    const mock = createMockFetch(null, { routes: [{ match: 'api.github.com', respond: () => json({ message: 'Bad credentials' }, 401) }] });
    const client = new GitHubClient({ fetch: mock.fetch, token });
    const err = await client.getRepo(ref).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).kind).toBe('unauthorized');
    expect(mock.requests[0]?.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.stringify({ m: (err as Error).message, h: (err as GitHubError).hint })).not.toContain(token);
  });

  it('omits Authorization when no token is set', async () => {
    const mock = createMockFetch(loadFixture('widget'));
    await new GitHubClient({ fetch: mock.fetch }).getRepo(ref);
    expect(mock.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('maps 404 to a not-found/private message', async () => {
    const mock = createMockFetch(null);
    const err = (await new GitHubClient({ fetch: mock.fetch }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('not_found');
    expect(err.message).toMatch(/not found, or it is private/);
    expect(err.exitCode).toBe(3);
  });

  it('maps a 403 rate limit to rate_limited with the reset time', async () => {
    const reset = Math.floor(Date.UTC(2030, 0, 1, 12, 0, 0) / 1000);
    const mock = createMockFetch(null, {
      routes: [
        {
          match: 'api.github.com',
          respond: () => json({ message: 'API rate limit exceeded for 1.2.3.4.' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
        },
      ],
    });
    const err = (await new GitHubClient({ fetch: mock.fetch }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('rate_limited');
    expect(err.resetAt?.getTime()).toBe(reset * 1000);
    expect(err.message).toMatch(/resets at 20\d\d-\d\d-\d\d \d\d:\d\d:\d\d \(UTC[+-]\d\d:\d\d\)/);
    expect(err.hint).toMatch(/GITHUB_TOKEN/);
  });

  it('maps a plain 403 to forbidden', async () => {
    const mock = createMockFetch(null, { routes: [{ match: 'api.github.com', respond: () => json({ message: 'Repository access blocked' }, 403, { 'x-ratelimit-remaining': '55' }) }] });
    const err = (await new GitHubClient({ fetch: mock.fetch }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('forbidden');
    expect(err.message).toMatch(/Repository access blocked/);
  });

  it('maps 429 with retry-after', async () => {
    const mock = createMockFetch(null, { routes: [{ match: 'api.github.com', respond: () => json({ message: 'slow down' }, 429, { 'retry-after': '60' }) }] });
    const err = (await new GitHubClient({ fetch: mock.fetch }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('rate_limited');
    expect(err.resetAt).toBeInstanceOf(Date);
  });

  it('maps 5xx to server errors', async () => {
    const mock = createMockFetch(null, { routes: [{ match: 'api.github.com', respond: () => new Response('oops', { status: 502 }) }] });
    const err = (await new GitHubClient({ fetch: mock.fetch }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('server');
  });

  it('rejects private repositories even when visible to the token', async () => {
    const fx = loadFixture('widget');
    fx.repository.private = true;
    const err = (await new GitHubClient({ fetch: createMockFetch(fx).fetch }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('private_repo');
  });

  it('reports empty repositories (409 from the trees API)', async () => {
    const mock = createMockFetch(loadFixture('widget'), { emptyRepo: true });
    const err = (await new GitHubClient({ fetch: mock.fetch }).getTree(ref, 'main').catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('empty_repo');
    expect(err.message).toMatch(/is empty/);
  });

  it('times out slow requests', async () => {
    const slow = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const err = (await new GitHubClient({ fetch: slow, timeoutMs: 20 }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('timeout');
    expect(err.hint).toMatch(/--timeout/);
  });

  it('maps network failures', async () => {
    const failing = async () => {
      throw new TypeError('getaddrinfo ENOTFOUND api.github.com');
    };
    const err = (await new GitHubClient({ fetch: failing }).getRepo(ref).catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('network');
  });

  it('follows Link pagination up to maxPages', async () => {
    let calls = 0;
    const mock = createMockFetch(null, {
      routes: [
        {
          match: '/releases',
          respond: (url) => {
            calls++;
            const page = Number(new URL(url).searchParams.get('page') ?? '1');
            const headers: Record<string, string> = page < 5 ? { link: `<https://api.github.com/repos/acme/widget/releases?page=${page + 1}>; rel="next"` } : {};
            return json([{ tag_name: `v${page}` }], 200, headers);
          },
        },
      ],
    });
    const items = await new GitHubClient({ fetch: mock.fetch }).getPaginated<{ tag_name: string }>('/repos/acme/widget/releases?page=1', ref, 3);
    expect(items.map((i) => i.tag_name)).toEqual(['v1', 'v2', 'v3']);
    expect(calls).toBe(3);
  });

  it('parseNextLink handles multiple rels', () => {
    expect(parseNextLink('<https://x/a?page=1>; rel="prev", <https://x/a?page=3>; rel="next"')).toBe('https://x/a?page=3');
    expect(parseNextLink(null)).toBeNull();
  });

  it('skips binary and oversized raw files', async () => {
    const fx = loadFixture('widget', { 'bin.dat': 'abc\u0000def', 'big.md': 'x'.repeat(5000) });
    const client = new GitHubClient({ fetch: createMockFetch(fx).fetch });
    expect(await client.getRawFile(ref, 'main', 'bin.dat', 10_000)).toBeNull();
    expect(await client.getRawFile(ref, 'main', 'big.md', 1000)).toBeNull();
    expect(await client.getRawFile(ref, 'main', 'missing.md', 1000)).toBeNull();
  });
});
