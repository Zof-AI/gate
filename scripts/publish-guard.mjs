// prepublishOnly: a folder publish from a laptop is refused; releases go through release.yml,
// which publishes a checked tarball with provenance over OIDC.
const ref = process.env.GITHUB_WORKFLOW_REF ?? "";
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  !/^Zof-AI\/gate\/\.github\/workflows\/release\.yml@/.test(ref)
) {
  console.error(
    "@zof-ai/gate is published only by the release workflow (.github/workflows/release.yml).",
  );
  process.exit(1);
}
