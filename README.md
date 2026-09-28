# readme-gen

Point `readme-gen` at a public GitHub repository and it writes a polished `README.md` draft locally, in one of four styles: **professional**, **trendy**, **minimalist** or **comprehensive**.

It works from evidence. It reads a bounded set of high-signal files (manifests, docs, CI, entry points) through the GitHub API, builds a structured project brief, and asks a text-generation model to write only what that brief supports. Then it checks the result. Commands, links, badges and license statements that can't be traced back to the repository go into a **Verify before publishing** checklist.

> [!IMPORTANT]
> readme-gen never clones, commits to, pushes to or otherwise changes the target repository. It writes `README.generated.md` next to you by default, so an existing README is never overwritten by accident. Always review the draft before you use it.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Styles](#styles)
- [GitHub token (optional)](#github-token-optional)
- [Generation provider](#generation-provider)
- [Options](#options)
- [Review workflow](#review-workflow)
- [Data handling](#data-handling)
- [How it works](#how-it-works)
- [Exit codes](#exit-codes)
- [Development](#development)
- [Limitations](#limitations)
- [License](#license)

## Requirements

- Node.js 22 or newer
- An API key for an OpenAI-compatible chat-completions endpoint (xAI by default). See [Generation provider](#generation-provider).
- Optional: a `GITHUB_TOKEN` for higher GitHub rate limits

## Install

From a clone of this repository:

```sh
git clone https://github.com/SM260845/readme-gen.git
cd readme-gen
npm install        # also builds dist/ via the prepare script
npm link           # puts `readme-gen` on your PATH
```

Or install straight from GitHub:

```sh
npm install --global github:SM260845/readme-gen
```

## Quick start

Interactive:

```console
$ readme-gen
? GitHub repository URL: https://github.com/acme/widget
? Style: Professional
? Output path: README.generated.md
Analyzing repository acme/widget…
Generating Professional README with grok-4.6 via api.x.ai (key from READMEGEN_API_KEY)…
Created README.generated.md
```

Non-interactive:

```sh
readme-gen https://github.com/acme/widget --style professional --output README.generated.md
```

Preview without writing a file (the README goes to stdout, progress and the summary go to stderr):

```sh
readme-gen https://github.com/acme/widget --style minimalist --dry-run > preview.md
```

## Styles

| Style | What you get |
| --- | --- |
| `professional` | A clear value proposition, restrained design and the standard technical sections. |
| `trendy` | Strong visual hierarchy, compact badges and callouts, and a modern, friendly tone. |
| `minimalist` | Only the essential sections, with short copy and little decoration. |
| `comprehensive` | Detailed setup, configuration, architecture, contribution and troubleshooting sections, wherever the repository has evidence for them. |

Every style follows the same rule: a section only appears when the repository has evidence for it.

## GitHub token (optional)

Anonymous access gets 60 GitHub API requests per hour. A typical run uses about 4 API requests; file contents come from `raw.githubusercontent.com`, which doesn't count against that limit. If you hit the limit, the error tells you when it resets. To raise the limit to 5,000 requests per hour, set a token:

```sh
export GITHUB_TOKEN=...   # classic token with no scopes, or fine-grained with "Public repositories (read-only)"
```

The token is only read from the environment. It is sent only to GitHub, as an `Authorization` header, and never printed or logged. readme-gen only makes `GET` requests. It has no code path that writes to GitHub.

## Generation provider

readme-gen calls any OpenAI-compatible `/chat/completions` endpoint and asks for a strict JSON-schema response (`title`, `sections[]`, `warnings[]`).

| Variable | Purpose | Default |
| --- | --- | --- |
| `READMEGEN_API_KEY` | API key (takes precedence) | |
| `XAI_API_KEY` | Used if `READMEGEN_API_KEY` is unset | |
| `OPENAI_API_KEY` | Used if neither of the above is set | |
| `READMEGEN_BASE_URL` | Endpoint base URL; must be `https` (plain `http` is allowed only for `localhost`) | `https://api.x.ai/v1` |
| `READMEGEN_MODEL` | Model name | `grok-4.6` |

To keep an OpenAI key from being sent to another vendor: when the only key set is `OPENAI_API_KEY` and `READMEGEN_BASE_URL` is unset, readme-gen uses `https://api.openai.com/v1` with `gpt-4.1-mini`.

Examples:

```sh
# xAI (default)
export READMEGEN_API_KEY=...            # or XAI_API_KEY

# OpenAI
export OPENAI_API_KEY=...
export READMEGEN_MODEL=gpt-4.1          # optional

# Any OpenAI-compatible server (OpenRouter, a local gateway, ...)
export READMEGEN_API_KEY=...
export READMEGEN_BASE_URL=https://openrouter.ai/api/v1
export READMEGEN_MODEL=some/model
```

The model must support `response_format: { type: "json_schema" }`. Keys are read only from the environment and never logged. If an error message from the provider echoes your key back, readme-gen redacts it.

## Options

```text
readme-gen [url] [options]

  -s, --style <style>     professional | trendy | minimalist | comprehensive
  -o, --output <path>     output file (default README.generated.md); an explicit path may overwrite an existing file
  -f, --force             overwrite README.generated.md if it already exists
      --dry-run           print the README to stdout, write nothing
      --max-files <n>     maximum files to read (default 40)
      --max-bytes <n>     maximum total bytes read (default 250000)
      --max-file-bytes <n> skip files larger than this (default 60000)
      --timeout <ms>      GitHub request timeout (default 15000)
      --gen-timeout <ms>  generation request timeout (default 120000)
  -v, --verbose           list every GitHub request made
  -h, --help / -V, --version
```

Overwrite rules: the default `README.generated.md` is never replaced unless you pass `--force`. Naming a file with `--output` counts as asking to write there, so an existing file at that path will be replaced. Writes are atomic: readme-gen writes a temp file in the same directory, then renames it into place.

## Review workflow

1. Run readme-gen and read the summary it prints. The summary lists the files it inspected, what it excluded and why, any warnings, and every claim it could not trace.
2. Open the generated file. If anything couldn't be traced to the repository, the file ends with a `## Verify before publishing` checklist:
   ```markdown
   - [ ] **Badge** `https://img.shields.io/badge/license-MIT-blue` (line 7): generated badge; confirm the service and value are correct
   - [ ] **Command** `pip install .` (line 21): conventional for the toolchain (pyproject.toml) but not documented in the repository
   ```
3. Check each item. Fix it or delete it, then delete the checklist section and the `<!-- Generated by readme-gen … -->` comment at the top.
4. Copy the result into the target repository's `README.md` yourself, through your normal review process.

What counts as traced:

- **Commands** appear verbatim in an inspected file, or come directly from one (for example `npm run build` from `package.json` scripts, or `make test` from a `Makefile` target). Conventional toolchain commands such as `cargo test` or `pip install .` are flagged.
- **Links** appear in the repository metadata or in inspected files. Also accepted: standard repository pages (`/issues`, `/releases`, …) and links to files that exist in the tree.
- **Badges** count as traced only if the repository already uses that badge URL. Any badge the model invents is flagged.
- **License statements** must match the license GitHub detects for the repository. If there is no detected license, any license claim is flagged.

The draft is rejected outright, with nothing written, if it has no `#` title, has more than one, leaves a code fence unclosed, or contains unresolved template text (`{{…}}`, `TODO`, `lorem ipsum`, `[insert …]`, `your-username`, …).

## Data handling

- **What is read:** repository metadata, topics, languages, the latest release, the file tree, and up to `--max-files` high-signal files: README and docs, LICENSE, manifests and lockfiles, config examples (`.env.example`, `*.sample`), CI workflows, Docker and build files, and source entry points.
- **What is never read:** secrets (`.env*` other than the example variants, `*.pem`, `*.key`, `id_rsa`, `.npmrc`, `credentials*`, `secrets.*`, `*.tfstate`, …), binaries and media, dependency directories (`node_modules`, `.venv`, `vendor`, `third_party`, …), build output (`dist`, `build`, `target`, …), minified bundles, and files over the size limits.
- **Secret scanning:** every file is scanned before it enters the brief. Private keys, cloud and API tokens, JWTs, credentials in URLs and hard-coded passwords are replaced with `[REDACTED]`, and a warning names the file. The generated README is scanned again before it is written.
- **Where data goes:** the brief (metadata plus the redacted file excerpts) is sent only to the generation endpoint you configured. Nothing is sent anywhere else, and nothing is cached or stored besides the output file.
- **Prompt-injection hardening:** the model is told that repository content is untrusted data, and every command, link, badge and license claim in its output is checked against the evidence anyway.

## How it works

```text
src/
  cli.ts        argument parsing, prompts, orchestration, summary
  github.ts     URL validation and a read-only GitHub client (REST + raw URLs, timeouts, pagination, error mapping)
  inventory.ts  file classification, exclusion rules and selection limits
  brief.ts      the structured project brief: facts, commands and evidence, unknowns, warnings
  generator.ts  provider adapter: generateReadme(brief, style); OpenAI-compatible + fixture providers
  validate.ts   rendering, structure and placeholder checks, secret redaction, claim tracing
  output.ts     overwrite protection, atomic write, summary formatting
  secrets.ts    secret-pattern scanner
  styles.ts     style definitions
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected error |
| 2 | Usage error (bad URL, missing style, missing API key) |
| 3 | GitHub error (not found or private, 401, 403, rate limited, empty repository, timeout) |
| 4 | Generation failed (auth, rate limit, timeout, invalid response) |
| 5 | The generated README failed validation; nothing was written |
| 6 | Output error (file exists without `--force`, not writable) |
| 130 | Cancelled at a prompt |

## Development

```sh
npm install
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest; all network calls are mocked with fixtures
npm run build       # compile to dist/
```

Tests live in `test/`, and the fixture repositories in `test/fixtures/`. A hidden `--provider fixture` flag swaps in a deterministic generator, so you can exercise real GitHub retrieval without an LLM key:

```sh
node bin/readme-gen.js https://github.com/sindresorhus/is-plain-obj --style comprehensive --dry-run --provider fixture --verbose
```

CI runs lint, typecheck, test and build on Node 22. The workflow definition is in [docs/ci-workflow.yml](docs/ci-workflow.yml). To enable it, copy it to `.github/workflows/ci.yml` (pushing workflow files requires a token with the `workflow` scope):

```sh
mkdir -p .github/workflows && cp docs/ci-workflow.yml .github/workflows/ci.yml
```

## Limitations

- Public github.com repositories only. Private repositories and OAuth are out of scope for v1.
- No pull-request creation, images, themes or localization (deferred).
- Monorepos are summarised from the root. Package-level manifests deeper in the tree get lower priority.

## License

[MIT](LICENSE)
