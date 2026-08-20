export {
  parseGitHubRepoSpec,
  looksLikeGitHubSpec,
  GitHubSpecError,
  type GitHubRepoSpec,
} from "./spec.js";
export {
  GitHubSource,
  GitHubError,
  type GitHubErrorCode,
  type GitHubSourceOptions,
  type RepoMeta,
  type TreeBlob,
} from "./client.js";
