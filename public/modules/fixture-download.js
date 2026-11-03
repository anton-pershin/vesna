export async function runFixtureDownload({
  currentVersion,
  downloadVersion,
  pause,
  replace,
  reload,
  verify,
}) {
  const versionChanges = downloadVersion !== currentVersion;
  if (versionChanges) pause();
  const published = await replace();
  if (versionChanges) {
    reload();
    return { published, reloaded: true };
  }
  await verify(published);
  return { published, reloaded: false };
}
