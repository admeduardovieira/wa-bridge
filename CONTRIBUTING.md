# Contributing to wa-bridge

Thank you for your interest in contributing! This document outlines the
process for contributing to wa-bridge.

## Development Setup

```bash
git clone https://github.com/admeduardovieira/wa-bridge.git
cd wa-bridge
./setup.sh
```

Or manually:

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
```

## Project Structure

```
wa-bridge/
├── index.js           # Main application (single-file)
├── package.json       # Dependencies and scripts
├── .env.example       # Environment variable template
├── .gitignore
├── LICENSE            # MIT License
├── CLAUDE.md          # Project context for Claude Code
├── setup.sh           # Bootstrap script
├── test/              # Unit tests
│   └── index.test.js
└── .github/
    └── ISSUE_TEMPLATE/
        ├── bug_report.md
        └── feature_request.md
```

## Coding Standards

- **No hardcoded secrets** — all credentials via environment variables
- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `refactor:`, etc.
- **Functions < 50 lines** — keep functions focused and small
- **Error handling** — always handle errors; never silently swallow exceptions
- **Input validation** — validate all user input and external data

## Testing

All new code should include tests. Run tests before submitting a PR:

```bash
npm test
```

## Git Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes and commit: `git commit -m "feat: add my feature"`
4. Push: `git push origin feat/my-feature`
5. Open a Pull Request

### Commit Format

```
type(scope): description

Optional body explaining what and why.

Closes #123
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure lint passes: `npm run lint`
3. Add tests for any new functionality
4. Update documentation if needed
5. Use a clear PR title and description

## Reporting Issues

- **Bug reports**: Use the "Bug Report" issue template
- **Feature requests**: Use the "Feature Request" issue template
- **Security vulnerabilities**: See [Security](#security) section below

## Security

**Do NOT report security vulnerabilities via public issue tracker.**

If you discover a security vulnerability, please:
1. Do NOT open a public issue
2. Contact: eduardovieira@gmail.com
3. Include: description, reproduction steps, impact assessment

You will receive a response within 48 hours.

## Disclosure Policy

- You will receive acknowledgment within 48 hours
- We will investigate and provide a fix or workaround
- We will not take legal action against security researchers who act in good faith
