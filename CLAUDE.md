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

## Workbuddy memory format

Project work summaries should be stored under `.workbuddy/memory/` as individual Markdown files, not directly in `.workbuddy/`.

Use this format:

```markdown
---
name: short-kebab-case-name
description: one-line Chinese summary of what this memory records
metadata:
  type: project
---

# 中文标题

## 工作内容

- 用中文总结完成的主要改动。
- 记录关键包、脚本、配置和打包方式。

## 已验证命令

- `pnpm build`
- `pnpm test`
- `pnpm lint`

## 注意事项

- 记录后续 AI 需要遵循的项目约定或容易踩坑的上下文。

**Why:** 说明为什么这条记忆重要。

**How to apply:** 说明后续处理相关任务时应该如何使用这条记忆。
```

Memory filenames should use `YYYY-MM-DD.md`, for example `.workbuddy/memory/2026-06-26.md`. Prefer Chinese for the body content unless the user asks otherwise.
