# Contributing to Cubiq

We welcome contributions! Please follow these guidelines to ensure a smooth process.

## Branch Workflow

1. **Fork** the repository.
2. Create a **feature branch** (`git checkout -b feat/amazing-feature`).
3. **Commit** your changes (`git commit -m 'Add some amazing feature'`).
4. **Push** to the branch (`git push origin feat/amazing-feature`).
5. Open a **Pull Request**.

## Commit Message Style

We prefer [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` for new features.
- `fix:` for bug fixes.
- `docs:` for documentation changes.
- `refactor:` for code changes that neither fix a bug nor add a feature.
- `chore:` for updating build tasks, package manager configs, etc.

## Code Quality

### Frontend (React/TS)
- Run `pnpm lint` to check for ESLint errors.
- Ensure TypeScript types are correctly defined.

### Backend (Rust)
- Run `cargo fmt` to format your code.
- Run `cargo clippy` to check for common mistakes and improvements.
- Ensure all new commands are reflected in the CLI subcommands in `src-tauri/src/bin/cubiq.rs`.

## Pull Request Checklist

Before submitting your PR, please ensure:
- [ ] The app builds successfully (`pnpm tauri build`).
- [ ] The CLI sidecar script runs without errors (`.\scripts\build-cli-sidecar.ps1`).
- [ ] You have tested both the GUI and the CLI for regression.
- [ ] You have updated the documentation in `docs/` if you added new features or changed behaviors.
- [ ] Your commits follow the conventional style.

## Testing Your Changes
- **GUI**: Test both the Main window and the QuickAsk popup.
- **CLI**: Test `cubiq status` and `cubiq ask` as a baseline.
- **Database**: Ensure any schema changes include a new migration in `src/db.rs`.
