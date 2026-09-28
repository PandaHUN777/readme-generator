#!/usr/bin/env node
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`readme-gen requires Node.js 22 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

let cli;
try {
  cli = await import('../dist/cli.js');
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('readme-gen: dist/ is missing. Run `npm run build` in the readme-gen checkout first.');
    process.exit(1);
  }
  throw err;
}

cli.main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`readme-gen: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
