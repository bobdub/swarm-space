# Settings maintenance

- Free up space lives only in the personal exporter (`AccountExportModal`): it unlocks after the zip is downloaded or shared and clears just the archive's `summary.contents` via `clearArchivedLocal` (engraved files, identity, keys, wallet and coins stay). Settings > Storage has no separate cleanup or raw Data Archive.
- Test Connect (Account tab) shares the mesh peer ID, so it pauses the mesh without persisting that preference, resumes it on stop, and compares reached peers against the pre-test mesh snapshot.
