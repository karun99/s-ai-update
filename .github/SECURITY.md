{
  "name": "S-AI Security Policy",
  "contact": {
    "name": "Sai Karun Nandipati",
    "email": "security@s-ai.dev",
    "url": "https://github.com/karun99/s-ai-update/issues"
  },
  "policy": {
    "vulnerabilityDisclosure": {
      "description": "Report security vulnerabilities via GitHub Security Advisories",
      "url": "https://github.com/karun99/s-ai-update/security/advisories/new"
    },
    "supportedVersions": {
      "description": "Security fixes are provided for the latest major version",
      "versions": [">=6.0.0"]
    }
  },
  "dependencies": {
    "policy": "We review all dependencies for known vulnerabilities using OSV-Scanner and npm audit. Critical vulnerabilities are patched within 48 hours. High vulnerabilities within 1 week.",
    "automated": "Dependabot is configured to automatically open PRs for dependency updates across all sub-projects."
  }
}
