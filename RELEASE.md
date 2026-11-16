# Release: 1.0.2

This source prepares one version for npm, the Action and the container. It does not publish
a package, create tags, enable a gate or change account settings.

| Surface       | This release                                                    |
| ------------- | --------------------------------------------------------------- |
| npm           | `@zof-ai/gate@1.0.2`                                            |
| GitHub Action | `Zof-AI/gate@v1.0.2`, moving alias `v1`                         |
| Container     | `ghcr.io/zof-ai/gate:1.0.2`, aliases `1.0` and `1`; linux/amd64 |
| CLI wrapper   | `@zof-ai/cli` depends on `@zof-ai/gate@1.0.2`                   |

## Public API address

From 1.0.1 the CLI and Action default to `https://control.zof.ai`, a fixed constant. The
`--api-url` flag, the `api-url` input or `ZOF_API_URL` override it (flag or input first, then the
environment) and must be https; plain http is accepted only for localhost. An invalid override
fails closed with exit 2 and sends nothing.

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
   the workflow's version check (`scripts/version-check.mjs`) ignores it and other prereleases,
   comparing only against real `x.y.z` releases. Do not treat a staged placeholder as a completed
   release.

See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[trusted publishers](https://docs.npmjs.com/trusted-publishers/) and
[staged publishing](https://docs.npmjs.com/staged-publishing/).

## Candidate and publication

After the URL and owner setup are resolved, dispatch `release.yml` from the reviewed final
`main` revision with `version=1.0.2`, `publish=false`. Record the exact source SHA, workflow
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
