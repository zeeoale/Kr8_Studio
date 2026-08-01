# Project Management

## Native Open

The desktop `Open` command uses a Windows native file picker filtered to `project.json`. Selecting a `.kr8` project inside the approved `KR8_PROJECTS_ROOT` opens it directly, preserving its directory as the base for relative audio, cover, video, lyrics and export paths. A selection outside that root is rejected.

Kr8 validates and deserializes the selected project before switching the active workspace. Cancelling the dialog leaves the current project untouched. When the current project has unsaved changes, the editor asks for confirmation before opening the picker.

## Server And Non-Windows Fallback

Native Windows dialogs belong to the host running Kr8 and are not suitable for a headless VPS. On unsupported hosts, enter a project identifier relative to `KR8_PROJECTS_ROOT`; absolute filesystem paths are not accepted. Server Mode uses the same approved-root boundary.

The desktop library and `/mobile` companion list projects through provider-neutral backend endpoints rather than expose arbitrary filesystem browsing. This preserves the current `.kr8` format while supporting local audio and lyrics projects after the TKMusic source dependency is removed.
