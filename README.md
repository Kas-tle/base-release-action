# base-release-action
You can join the [Discord](https://discord.gg/5z4GuSnqmQ) for help with this project. An action to create incremented releases in a similar style to Jenkins

## Usage

This action requires a GitHub App with permissions for the repository in which the action will be run. The permissions required are:
- Contents: `Read and Write` (for creating releases and uploading assets)
- Metadata: `Read-only` (required for all GitHub Apps)
- Variables: `Read and Write` (for tracking release data accross runs)
- Actions: `Read-only` (for querying the status of the current action)

The key is provided in the PEM format and can be directly downloaded from the GitHub App settings page. The contents of this file should be stored in full as a secret in the repository or organization.

Data about the previous release for each branch is stored under the `RELEASEACTION_PREVRELEASE` actions variable. This can be manually modified if needed so long as the format and proper JSON syntax is preserved.

### Minimal Configuration

```yaml
- uses: Kas-tle/base-release-action@ # use latest commit hash
  if: always() # If you wish to run even when previous steps have failed
  with:
    files: | # Newline-separated list of files to upload with optional "label:" prefix
      testa:file_a.json
      testb:file_b.json
    appID: ${{ secrets.RELEASE_APP_ID }} # The ID of the GitHub App to manage the release system
    appPrivateKey: ${{ secrets.RELEASE_APP_PK }} # The private key of the GitHub App in PEM format
```

Note that when using the `push` trigger, given this action creates a tag using a bot token, GitHub will retrigger this action since that is considered a push event. This is, of course, generally not the desired outcome. This can be avoided by specifying that the action should only run on push to branches:
```yaml
on:
  push:
    branches:
      - "*"
```

### Inputs

| Input                                 | Description                                                                                                                                            | Default | Required |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | -------- |
| `appID`                               | ID of the GitHub App to manage the release system.                                                                                                     |         | `true`   |
| `appPrivateKey`                       | Private key of the GitHub App to manage the release system.                                                                                            |         | `true`   |
| `files`                               | Comma-separated or newline-separated list of release files with optional "label:" prefix.                                                              |         | `true`   |
| `discordWebhook`                      | Discord webhook to post the release to.                                                                                                                | `none`  | `false`  |
| `discussionCategory`                  | The category to use for the discussion. Defaults to "none" if not specified.                                                                           | `none`  | `false`  |
| `draftRelease`                        | Whether or not the release should be a draft. Defaults to false if not specified.                                                                      | `false` | `false`  |
| `ghApiUrl`                            | The GitHub API URL to use. Defaults to the api. plus the repo domain if not specified.                                                                 | `auto`  | `false`  |
| `ghReleaseNotes`                      | Whether or not to let GitHub auto-generate its release notes. Defaults to false if not specified.                                                      | `false` | `false`  |
| `includeReleaseInfo`                  | Whether or not to include the asset hashes in a release.json file. Defaults to true if not specified.                                                  | `true`  | `false`  |
| `lastCommit`                          | The last commit hash to use for the release. Defaults to the commit that triggered the workflow if not specified.                                      | `auto`  | `false`  |
| `latestRelease`                       | Whether or not the release should be marked as the latest release. Defaults to auto if not specified, which will be true unless this is a pre-release. | `auto`  | `false`  |
| `preRelease`                          | Whether or not the release is a pre-release. Inferred by the branch if not specified.                                                                  | `auto`  | `false`  |
| `releaseBody`                         | A file containing the body of the release. Defaults to the commit changelog if not specified.                                                          | `auto`  | `false`  |
| `releaseBodyDependencyUsage`          | Whether or not to include the dependency usage in the release body. Defaults to "none" if not specified. Currently accepts "java" or "nodejs".         | `none`  | `false`  |
| `releaseBodyDependencyJavaArtifactId` | The artifact ID to use for the Java dependency usage.                                                                                                  | ``      | `false`  |
| `releaseBodyDependencyJavaGroupId`    | The group ID to use for the Java dependency usage.                                                                                                     | ``      | `false`  |
| `releaseBodyDependencyJavaMavenRepo`  | The Maven repo to use for Java dependency usage.                                                                                                       | ``      | `false`  |
| `releaseBodyDependencyJavaVersion`    | The version to use for Java dependency usage.                                                                                                          | ``      | `false`  |
| `releaseBodyDependencyNodejsPackage`  | The package to use for Node.js dependency usage.                                                                                                       | ``      | `false`  |
| `releaseBodyDependencyNodejsVarName`  | The variable name to use for Node.js dependency usage.                                                                                                 | ``      | `false`  |
| `releaseBodyDependencyNodejsVersion`  | The version to use for Node.js dependency usage.                                                                                                       | ``      | `false`  |
| `releaseChangeLimit`                  | The maximum number of changes to include in the release body. Defaults to 15 if not specified. Set to -1 to include all changes.                       | `15`    | `false`  |
| `releaseEnabled`                      | Whether or not the release should be created. Defaults to true if not specified.                                                                       | `true`  | `false`  |
| `releaseName`                         | The title of the release. Defaults to "Build ${tagBase} (${branch})" if not specified.                                                                 | `auto`  | `false`  |
| `saveMetadata`                        | Whether or not to save the offline release metadata to metadata.json. Defaults to false if not specified.                                              | `false` | `false`  |
| `tagBase`                             | The tag base to use for the release. Auto increment from the last tag will be used if not specified.                                                   | `auto`  | `false`  |
| `tagIncrement`                        | If the build tag should be incremented. Defaults to true if not specified and tag is a number.                                                         | `true`  | `false`  |
| `tagPrefix`                           | The prefix to use for the tag. Defaults to the branch if not specified.                                                                                | `auto`  | `false`  |
| `tagSeparator`                        | The separator to use between the tag prefix and the tag base. Defaults to "-" if not specified.                                                        | `-`     | `false`  |
| `updateReleaseData`                   | Whether or not to update the release data in repository variable storage. Defaults to true if not specified                                            | `true`  | `false`  | 

### Outputs

| Output              | Description                              |
| ------------------- | ---------------------------------------- |
| `releaseID`         | The ID of the release.                   |
| `releaseAPIURL`     | The API URL of the release.              |
| `releaseAssetsURL`  | The asset URL for the release.           |
| `releaseBrowserURL` | The browser URL of the release.          |
| `tag`               | The tag of the release.                  |
| `tagBase`           | The base of the tag of the release.      |
| `tagPrefix`         | The prefix of the tag of the release.    |
| `tagSeparator`      | The separator of the tag of the release. |
| `uploadAssetsURL`   | The asset upload URL for the release.    |
