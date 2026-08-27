#!/usr/bin/env node
import { runCli } from '../dist/cli.js';

runCli(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error('openworker:', err && err.message ? err.message : err);
    process.exit(1);
  }
);
