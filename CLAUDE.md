# Project Instructions

## Git commit messages

Use Conventional Commit style with a leading icon.

Format:

```text
<icon> <type>: <summary>
```

Common types:

- `feat`: new feature
- `fix`: bug fix
- `refactor`: code restructuring without behavior change
- `build`: build system, packaging, or dependency changes
- `chore`: maintenance tasks
- `docs`: documentation-only changes
- `test`: tests only
- `style`: formatting-only changes

Recommended icons:

- `✨ feat: ...`
- `🐛 fix: ...`
- `♻️ refactor: ...`
- `📦 build: ...`
- `🔧 chore: ...`
- `📝 docs: ...`
- `✅ test: ...`
- `🎨 style: ...`

Examples:

```text
✨ feat: add ecode tree download
🐛 fix: preserve remote file text when comparing
📦 build: bundle vscode extension with esbuild
♻️ refactor: migrate sdk source to typescript
```

When creating commits for this project, follow this format unless the user explicitly asks for a different style.
