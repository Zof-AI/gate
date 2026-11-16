# Zof gate

`@zof-ai/gate` lets any CI/CD pipeline block a deploy on the [Zof](https://zof.ai) Control Plane's
decision: one step and one secret ask Zof whether this commit may go to this environment, and the
job passes or fails on the answer.

> **Status: pre-release.** Nothing is published yet. The `v1` tag, the npm package and the
> image digests below appear with the first release.

## Embedding the command

Other Zof CLIs can import `runGateCli` from `@zof-ai/gate`. It accepts the argument array,
environment, `CliIo` and `GateDeps`, and returns the exit code without exiting the process.
This is the same command used by `zof-gate`: detection, validation, redaction, waiting and
exit-code handling stay in this package. The caller supplies file, output, network and clock
adapters and must preserve the returned exit code.

## GitHub Actions


Create a pipeline token in Zof (Settings › Pipeline tokens), save it as the repo secret
`ZOF_GATE_TOKEN`, and add this step to the deploy job before the deploy:

```yaml
- uses: zof-ai/gate@v1
  with:
    environment: production
    api-url: https://<your Zof Control Plane>
    token: ${{ secrets.ZOF_GATE_TOKEN }}
```

`api-url` is required for now; a default address lands with the first public release.

The step fails the job unless Zof allows this commit to this environment, and writes the verdict,
reasons and console link to the job summary. `api-url` can also come from `ZOF_API_URL`. Optional
inputs: `max-wait` (minutes, 1-60, default 10) and `break-glass` (a reason; needs `ZOF_BREAK_GLASS_TOKEN`).
Outputs: `result` (`pass`, `fail` or `error`), `exit-code` and `console-url`. For the strictest
pinning, use a release tag's full commit SHA instead of `@v1`.

## GitLab CI

```yaml
zof_gate:
  stage: deploy
  image: ghcr.io/zof-ai/gate:1@sha256:<digest from the release notes>
  variables:
    ZOF_API_URL: https://<your Zof Control Plane>
  script:
    - zof-gate --environment "$CI_ENVIRONMENT_NAME" --repo owner/name
```

Set `ZOF_GATE_TOKEN` as a masked, protected CI/CD variable. Pass `--repo` (the GitHub repo Zof
gates): the GitLab project path is not it.

## Any other CI

With the image (Bitbucket Pipelines, Jenkins, CircleCI, Azure Pipelines and others). The image is
linux/amd64 only for now.

```sh
docker run --rm -e ZOF_GATE_TOKEN -e ZOF_API_URL \
  ghcr.io/zof-ai/gate:1@sha256:<digest from the release notes> \
  zof-gate --environment production --repo owner/name --commit "$GIT_COMMIT" --run-id "$BUILD_ID"
```

Or with Node 22+: `npx @zof-ai/gate --environment production`.

The CLI reads the repo, commit, run and environment from GitHub Actions, GitLab CI, Bitbucket
Pipelines, Azure Pipelines, Jenkins and CircleCI. It takes a repo only from a github.com remote; on
any other CI, or when a value is missing, it exits 2 naming the flag to pass (`--repo`, `--commit`,
`--run-id`, `--environment`). `zof-gate --help` lists every flag.

## Verify what you run

Each release's notes give the image digest and these commands:

```sh
cosign verify ghcr.io/zof-ai/gate@sha256:<digest> \
  --certificate-identity https://github.com/Zof-AI/gate/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/zof-ai/gate@sha256:<digest> --repo Zof-AI/gate
npm audit signatures   # in a project that installs @zof-ai/gate
```

The npm package is published with provenance through npm trusted publishing; no npm token exists.

## Exit codes

| Code | Meaning                                                           |
| ---- | ----------------------------------------------------------------- |
| 0    | Pass: a stored Zof decision, a baseline or a recorded break-glass |
| 1    | Blocked                                                           |
| 2    | Usage or configuration error                                      |
| 3    | Zof unavailable (never a pass)                                    |
| 4    | Token problem                                                     |

There is no fail-open mode: anything other than a valid pass fails the job.

## Docs

See the Zof docs at <https://zof.ai/docs>.

## Development

Node 22 or 24.

```sh
npm ci
npm run check   # lint, typecheck, tests
npm run bundle  # rebuild dist/index.mjs (the Action) after changing src/; CI fails if it's stale
```

Releases run only from `.github/workflows/release.yml` (manual dispatch from `main`, `release`
environment approval).

The `gate.v1` contract (OpenAPI, JSON schemas and the Control Plane's fixtures) is copied byte for
byte into `fixtures/gate.v1/`, with its source commit in `SOURCE.json`. Refresh it from a
`control_plane` checkout with `npm run contract:sync -- <path> [ref]`; the contract tests fail if
the copy is edited or drifts from the schema version this client speaks.

## License

Apache-2.0. See [LICENSE](LICENSE).
