# Project Management

## Native Open

The desktop `Open` command uses a Windows native file picker filtered to `project.json`. Selecting the file inside any `.kr8` directory opens that project directly, preserving its directory as the base for relative audio, cover, video, lyrics and export paths.

Kr8 validates and deserializes the selected project before switching the active workspace. Cancelling the dialog leaves the current project untouched. When the current project has unsaved changes, the editor asks for confirmation before opening the picker.

## Server And Non-Windows Fallback

Native Windows dialogs belong to the host running Kr8 and are not suitable for a headless VPS. On unsupported hosts the existing manual-path flow remains available. In Server Mode, project paths continue to be constrained by `KR8_PROJECTS_ROOT`.

The future project browser and `/mobile` companion should list projects through a provider-neutral backend endpoint rather than expose arbitrary filesystem browsing. This will preserve the current `.kr8` format while supporting local audio and lyrics projects after the TKMusic source dependency is removed.
