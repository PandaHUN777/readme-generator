#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`readme-gen: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
