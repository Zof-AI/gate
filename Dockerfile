# The zof-gate CLI for GitLab CI, Bitbucket Pipelines and any CI that runs a container.
# Both stages use the same digest-pinned base; bump the tag and digest together.
ARG NODE_IMAGE=node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE}
ARG VERSION=1.0.0
LABEL org.opencontainers.image.title="zof-gate" \
      org.opencontainers.image.description="Block a CI/CD deploy on the Zof Control Plane's decision." \
      org.opencontainers.image.source="https://github.com/Zof-AI/gate" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Zof AI, Inc." \
      org.opencontainers.image.version="${VERSION}"
# The CLI has no runtime dependencies, so the package managers only add attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg
COPY --from=build /src/package.json /opt/zof-gate/package.json
COPY --from=build /src/lib /opt/zof-gate/lib
RUN chmod 0755 /opt/zof-gate/lib/bin.js && ln -s /opt/zof-gate/lib/bin.js /usr/local/bin/zof-gate
USER node
WORKDIR /home/node
# No entrypoint: GitLab and Bitbucket run their script through the image's shell.
ENTRYPOINT []
CMD ["zof-gate", "--help"]
