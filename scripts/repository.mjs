// The one place the GitHub repository is read from package.json `repository` (KTD2).
// Shared by build-plugin.mjs and update-marketplace.mjs so the slug is never typed twice.

/** The `owner/name` slug of the GitHub repository named by package.json `repository`; throws a plain Error. */
export function repositorySlug(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (typeof raw !== 'string' || raw === '') throw new Error('package.json has no repository url');
  const match = raw.match(/^(?:git\+)?(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/|github:)?([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`cannot read a GitHub repository from package.json repository "${raw}"`);
  return match[1];
}

/** The canonical https URL of that repository. */
export function repositoryUrl(repository) {
  return `https://github.com/${repositorySlug(repository)}`;
}
