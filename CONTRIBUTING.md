# Contributing to S-AI v6.1

Thanks for wanting to help. This release hardens the S-AI swarm for
production; security invariants are the review bar.

## Ground rules

- **Security first.** SSRF protection, filesystem/shell sandboxing, bearer-token
  auth, rate limiting, and registry-bound execution must never regress.
- Open an issue before opening a pull request so the design is discussed once.
- Every feature ships with a test and passes `npm test`
  (`node --test dist/test/**/*.test.js`).
- Readiness claims (TRL/MRL/IRL) must trace to CI evidence, not prose.

## Verifying

```sh
npm install
npm run build
npm test
```

The security CI (gitleaks, OSV-Scanner, govulncheck, Semgrep, npm audit) runs
on every push.

## Reporting bugs

Search the issues list first. Include the command you ran, the Node version,
and the first ~30 lines of the error.

## Support expectations

Maintained by a single maintainer in spare time. Issues are the channel for
help; expect answers within a week, not minutes.

## License

By contributing you agree that your contributions are licensed under the same
MIT license as the rest of the project.