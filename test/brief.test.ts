import { describe, expect, it } from 'vitest';
import { extractDocCommands } from '../src/brief.js';
import { briefFor, fakeSecrets, loadFixture } from './helpers.js';

describe('buildBrief', () => {
  it('produces evidence-backed facts and commands for a Node project', async () => {
    const brief = await briefFor(loadFixture('widget'));
    expect(brief.repo).toMatchObject({ fullName: 'acme/widget', license: { spdxId: 'MIT' }, languages: ['TypeScript', 'Shell'] });
    const cmd = (c: string) => brief.commands.find((x) => x.command === c);
    expect(cmd('npm install')).toMatchObject({ confidence: 'evidence', purpose: 'install' });
    expect(cmd('npm install')?.evidence).toContain('package-lock.json');
    expect(cmd('npm run build')).toMatchObject({ confidence: 'evidence', evidence: ['package.json'] });
    expect(cmd('npm test')?.confidence).toBe('evidence');
    // Documented in README, so the registry install becomes evidence-backed.
    expect(cmd('npm install --global @acme/widget')).toMatchObject({ confidence: 'evidence' });
    expect(cmd('npm install --global @acme/widget')?.evidence).toEqual(expect.arrayContaining(['package.json', 'README.md']));
    expect(cmd('widget render --config widget.config.json')?.evidence).toEqual(['README.md']);
    expect(cmd('npm ci')?.evidence).toEqual(['.github/workflows/ci.yml']);
    expect(brief.facts.find((f) => f.key === 'node-version')?.statement).toBe('Requires Node.js >=20');
    expect(brief.facts.find((f) => f.key === 'license')?.evidence).toEqual(['github:metadata', 'LICENSE']);
    expect(brief.evidenceUrls).toEqual(expect.arrayContaining(['https://github.com/acme/widget', 'https://widget.acme.dev', 'https://img.shields.io/npm/v/@acme/widget']));
    expect(brief.unknowns.some((u) => /published/.test(u))).toBe(false);
    expect(brief.style.id).toBe('professional');
  });

  it('never includes excluded files and records unknowns for a sparse Python project', async () => {
    const brief = await briefFor(loadFixture('pyapp'));
    expect(brief.files.map((f) => f.path)).toEqual(expect.arrayContaining(['pyproject.toml', 'Makefile', 'pyapp/__main__.py']));
    expect(brief.unknowns).toEqual(
      expect.arrayContaining([
        'The repository has no GitHub description.',
        'No license was detected. Do not state or imply a license.',
        'The repository has no existing README.',
        'Whether "pyapp" is published to PyPI was not verified.',
      ]),
    );
    expect(brief.commands.find((c) => c.command === 'make test')).toMatchObject({ confidence: 'evidence', purpose: 'test' });
    expect(brief.commands.find((c) => c.command === 'pip install .')).toMatchObject({ confidence: 'inferred' });
    expect(brief.facts.find((f) => f.key === 'python-version')?.statement).toBe('Requires Python >=3.11');
    expect(brief.warnings.some((w) => /archived/.test(w))).toBe(true);
  });

  it('excludes .env files and binaries from brief files', async () => {
    const brief = await briefFor(loadFixture('widget'));
    const paths = brief.files.map((f) => f.path);
    expect(paths).not.toContain('.env');
    expect(paths).toContain('.env.example');
    expect(JSON.stringify(brief)).not.toContain('fixture-env-file-sentinel-value');
  });

  it('redacts secrets found in file content before they enter the brief', async () => {
    const key = fakeSecrets.awsKey();
    const tok = fakeSecrets.githubToken();
    const fx = loadFixture('widget', { 'docs/configuration.md': `Use key ${key} and token ${tok}.\n${fakeSecrets.privateKey()}\n` });
    const brief = await briefFor(fx);
    const serialized = JSON.stringify(brief);
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain(tok);
    expect(serialized).not.toContain('PRIVATE KEY-----\\nMII');
    expect(brief.files.find((f) => f.path === 'docs/configuration.md')?.redactions).toBe(3);
    expect(brief.warnings.some((w) => /Redacted 3 potential secret/.test(w))).toBe(true);
  });
});

describe('extractDocCommands', () => {
  it('reads shell blocks and prompt lines, ignoring code in other languages', () => {
    const md = ['```bash', '# comment', 'npm install foo', '```', '```js', 'const x = require("foo")', '```', '```', '$ foo --help', 'some output', '```', '```console', '$ make build', 'building...', '```'].join('\n');
    expect(extractDocCommands(md)).toEqual(['npm install foo', 'foo --help', 'make build']);
  });
});

describe('CI command extraction', () => {
  it('ignores block scalars, runner-specific steps, and does not treat CI steps as usage', async () => {
    const ci = ['jobs:', '  x:', '    steps:', '      - run: >', '          echo folded', '      - run: |', '          echo literal', '      - run: echo "A=1" >> $GITHUB_ENV', '      - run: npm run build', '      - run: ./scripts/release.sh'].join('\n');
    const brief = await briefFor(loadFixture('widget', { '.github/workflows/ci.yml': ci }));
    const fromCi = brief.commands.filter((c) => c.evidence.includes('.github/workflows/ci.yml'));
    expect(fromCi.map((c) => c.command)).toEqual(['npm run build', './scripts/release.sh']);
    expect(fromCi.find((c) => c.command === './scripts/release.sh')?.purpose).toBe('other');
  });
});
