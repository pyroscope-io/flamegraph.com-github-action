# flamegraph.com github action
Use this action to upload a flamegraph to [flamegraph.com](https://flamegraph.com/)

For examples, check the file at `.github/workflows/upload-test.yml`

# Development
## Running locally

You can use [`act`](https://github.com/nektos/act)

`yarn build`
`act --container-architecture linux/amd64  --workflows .github/workflows/upload-test.yml`

If you use `colima`, don't forget to specify the `DOCKER_HOST`:
`DOCKER_HOST="unix://$HOME/.colima/docker.sock" act --container-architecture linux/amd64  --workflows .github/workflows/upload-test.yml`

## Testing
There's a test github action workflow, so feel free to open a PR and iterate there.

# Publishing
Run `yarn build`, and commit the `dist` directory.
