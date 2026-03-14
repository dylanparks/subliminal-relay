import { GitHubConfig, SubliminalTokenExport } from '../../types';

const GITHUB_API = 'https://api.github.com';

/**
 * Pushes the token export as a JSON file to the specified GitHub repository.
 * Creates the file if it does not exist; updates (commits) it if it does.
 */
export async function pushToGitHub(
  config: GitHubConfig,
  tokens: SubliminalTokenExport,
): Promise<void> {
  const { token, owner, repo, branch, filePath } = config;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Check if file already exists (to get its SHA for update)
  let existingSha: string | undefined;

  const checkRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers },
  );

  if (checkRes.ok) {
    const existing = await checkRes.json();
    existingSha = existing.sha;
  } else if (checkRes.status !== 404) {
    const err = await checkRes.json().catch(() => ({}));
    throw new Error(`GitHub API error (${checkRes.status}): ${err.message || checkRes.statusText}`);
  }

  // Encode content as base64
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(tokens, null, 2))));

  const commitMessage = `chore(tokens): update Subliminal tokens [${new Date().toISOString()}]`;

  const body: Record<string, unknown> = {
    message: commitMessage,
    content,
    branch,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const putRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(`Failed to push file (${putRes.status}): ${err.message || putRes.statusText}`);
  }
}
