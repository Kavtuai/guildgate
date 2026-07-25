# Setup and first release

## 1. Prepare the repository

```bash
unzip guildgate-0.1.0.zip
cd guildgate-0.1.0
npm install
npm test
```

`npm install` creates `package-lock.json` on the first connected development machine. Commit that lockfile before the first pull request so CI and contributors install the same dependency graph.

## 2. Run the deployment check

Copy `.env.example` to a private local environment file and fill the values. Generate separate random values for each secret.

```bash
node ./bin/guildgate-doctor.mjs
```

Use `GUILDGATE_ENVIRONMENT=production` for the final check. Production mode verifies HTTPS, the origin allowlist, secret lengths, and the token encryption key format.

## 3. Create the GitHub repository

Create an empty public repository named `guildgate` under the `kavtuai` account. Do not add a remote README or license because the archive already contains both.

```bash
git init
git branch -M main
git add .
git commit -m "feat: initial GuildGate release"
git remote add origin git@github.com:kavtuai/guildgate.git
git push -u origin main
```

Enable these repository settings:

- Branch protection for `main`.
- Required CI and CodeQL checks.
- Pull-request review before merge.
- Secret scanning and push protection where available.
- Private vulnerability reporting.
- Dependabot alerts and security updates.

## 4. Reserve and configure the npm package

The package name in `package.json` is `@kavtuai/guildgate`. The `kavtuai` npm organization or user scope must exist and permit public scoped packages.

Configure npm trusted publishing for this repository and the `.github/workflows/publish.yml` workflow. The workflow uses GitHub OIDC and does not need a long-lived npm token when trusted publishing is active.

Before release:

```bash
npm login
npm whoami
npm run pack:check
```

`npm pack --dry-run` shows the exact files that npm will receive.

## 5. Publish through a GitHub release

Update `CHANGELOG.md`, commit the version, and create a signed or protected tag:

```bash
npm version 0.1.0 --no-git-tag-version
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v0.1.0"
git tag -s v0.1.0 -m "GuildGate 0.1.0"
git push origin main v0.1.0
```

Create a GitHub release from `v0.1.0`. The publish workflow runs tests and then sends the package to npm.

Do not publish from a workstation after trusted publishing is configured unless an incident procedure explicitly requires it.

## 6. Test an installed package

Create a separate empty directory:

```bash
mkdir guildgate-consumer-test
cd guildgate-consumer-test
npm init -y
npm install @kavtuai/guildgate@0.1.0
node -e "import('@kavtuai/guildgate').then(m => console.log(typeof m.createGuildGate))"
```

The command should print `function`.

## 7. First application integration

Use this order:

1. Select durable and short-lived stores.
2. Configure the kernel and run the doctor command.
3. Add Discord OAuth start and callback routes.
4. Add a session bootstrap endpoint that returns the CSRF token to the signed-in frontend.
5. Add one read action and one idempotent write action.
6. Add live guild authorization to the write action.
7. Add audit and outbox retention jobs.
8. Connect the realtime hub only after HTTP authorization works.
9. Test role removal, bot removal, session revocation, Redis loss, database timeout, and duplicate writes.
