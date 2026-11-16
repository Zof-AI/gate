# First release: 1.0.0

This source prepares one version for npm, the Action and the container. It does not publish
a package, create tags, enable a gate or change account settings.

| Surface | First release |
| --- | --- |
| npm | `@zof-ai/gate@1.0.0` |
| GitHub Action | `Zof-AI/gate@v1.0.0`, moving alias `v1` |
| Container | `ghcr.io/zof-ai/gate:1.0.0`, aliases `1.0` and `1`; linux/amd64 |
| CLI wrapper | `@zof-ai/cli` depends on `@zof-ai/gate@1.0.0` |

## Blocking source decision: public API address

The production Control Plane URL required by gate spec §8 has not been verified for this
release. The current CLI and Action require `--api-url`, the `api-url` input, or `ZOF_API_URL`;
an omitted URL fails closed with exit 2. No address is inferred from an internal listener,
temporary tunnel, dashboard URL or example.

Before publication, the Control Plane owner must identify the canonical public HTTPS origin
and the production revision serving `/v1/gate/checks`. A reviewed follow-up must add that
default, retain explicit flag/input precedence over the environment and default, and test
failure and response-validation behavior. Until then, this is release preparation only.

## Owner setup

1. The GitHub owner creates the `release` environment, requires reviewer approval, and limits
   its deployments to `main`. Confirm public GHCR publication and the permissions declared in
   `.github/workflows/release.yml`. The environment was absent when checked on 2026-11-16.
2. The npm owner establishes the first package, then configures its trusted publisher:
   organization `Zof-AI`, repository `gate`, filename `release.yml`, environment `release`,
   allowing the direct `npm publish` operation used by this workflow. The package did not
   exist when checked. npm requires an existing package for trust setup, so first-publication
   bootstrap needs an owner-approved procedure before this workflow can publish over OIDC.
3. npm's staged-publication option creates a public `0.0.0-stage` placeholder. If selected,
   review bootstrap support first: the current workflow's latest-version check accepts only
   `x.y.z`. Do not treat a staged placeholder as a completed 1.0.0 release.

See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[trusted publishers](https://docs.npmjs.com/trusted-publishers/) and
[staged publishing](https://docs.npmjs.com/staged-publishing/).

## Candidate and publication

After the URL and owner setup are resolved, dispatch `release.yml` from the reviewed final
`main` revision with `version=1.0.0`, `publish=false`. Record the exact source SHA, workflow
run and `npm-tarball` SHA256. The candidate checks source, generated Action bundle, packed
package, image version and non-root execution. A local validation tarball is not a release
artifact.

Publication needs explicit authorization and `release` approval. The workflow publishes the
checked tarball with provenance, then signs and attests the image; Git tags and release notes
follow only after both publishing jobs succeed. Record the npm integrity and GHCR digest,
verify npm signatures, cosign and GitHub provenance, and confirm the Action tag's exact SHA.

If npm succeeds but image publication or tagging fails, inspect the partial release and
prepare a reviewed recovery: a normal rerun rejects an already-published version. Never
republish an immutable npm version or move a release tag without checking the existing bytes.

After the real package is available, the CLI owner refreshes its registry lockfile integrity
and runs normal Node 22/24 CI before releasing the wrapper. Creation and production gate
activation are separate from publishing these clients.
