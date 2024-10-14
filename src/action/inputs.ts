import * as core from '@actions/core'
import fs from 'fs';
import { Inputs, PreviousRelease } from '../types/inputs.js';
import * as parse from '../util/parse.js';
import { Repo } from '../types/repo.js';
import os from 'os';
import path from 'path';
import { OctokitApi } from '../types/auth.js';
import markdownEscape from 'markdown-escape';
import { globSync } from 'glob';

export async function getInputs(inp: {api: OctokitApi, repoData: Repo}): Promise<Inputs> {
    const { api, repoData } = inp;

    const prevRelease: PreviousRelease = await getPrevRelease({api, repoData});

    const files = getFiles();
    const changes = await getChanges({api, prevRelease, repoData});
    const tag = await getTag({repoData, prevRelease});
    const success = await getSuccess({api, repoData});
    const release = await getRelease({api, changes, tag, repoData, success});

    console.log(`Using ${files.length} files, ${changes.length} changes, tag ${tag.base}, release ${release.name}`);
    return { files, changes, tag, release, success };
}

async function getPrevRelease(inp: {api: OctokitApi, repoData: Repo}): Promise<PreviousRelease> {
    const { api, repoData } = inp;

    const { owner, repo, branch } = repoData;
    const variable = 'releaseAction_prevRelease';

    try {
        const varResponse = await api.rest.actions.getRepoVariable({ owner, repo, name: variable });
        const reponse: Record<string, { c: string, t: string } | undefined> = JSON.parse(varResponse.data.value);
        const prevRelease = reponse[branch];
        
        if (prevRelease == null) {
            return { commit: undefined, baseTag: undefined };
        }

        return { commit: prevRelease.c, baseTag: prevRelease.t };
    } catch (error) {
        await api.rest.actions.createRepoVariable({ owner, repo, name: variable, value: '{}' });
        return { commit: undefined, baseTag: undefined };
    }

}

function getFiles(): Inputs.File[] {
    const files = core.getInput('files');

    if (files === '') {
        return [];
    }

    const inputFiles: Inputs.File[] = [];

    for (const file of parse.parseMultiInput(files)) {
        let label: string;
        let filePath: string;

        if (!file.includes(':')) {
            label = path.parse(file).name.toLowerCase();
            filePath = file;
        } else {
            label = file.split(':')[0];
            filePath = file.split(':').slice(1).join(':');
        }

        const files = globSync(filePath);

        if (files.length > 1) {
            for (const file of files) {
                const fileName = path.parse(file).name;
                inputFiles.push({ label: `${label}-${fileName}`, path: file });
            }
        } else if (files.length === 1) {
            inputFiles.push({ label, path: files[0] });
        } else {
            console.log(`File ${label} not found at ${filePath}`);
            core.setFailed(`File ${label} not found at ${filePath}`);
        }
    }

    return inputFiles;
}

async function getRelease(inp: {api: OctokitApi, changes: Inputs.Change[], tag: Inputs.Tag, repoData: Repo, success: boolean}): Promise<Inputs.Release> {
    const { api, changes, tag, repoData, success } = inp;

    const { owner, repo, branch } = repoData;

    const body_dependency_usage = getBodyDependencyUsage();
    const body = await getReleaseBody({repoData, changes, usageExamples: body_dependency_usage, tag});
    const prerelease = await getPreRelease({repoData});
    const name = getName({tag, branch});
    const draft = core.getBooleanInput('draftRelease');
    const generate_release_notes = core.getBooleanInput('ghReleaseNotes');
    const discussion_category_name = await getDiscussionCategory({api, owner, repo});
    const make_latest = getMakeLatest({prerelease, success});
    const info = core.getBooleanInput('includeReleaseInfo');
    const hook = core.getInput('discordWebhook') == 'none' ? undefined : core.getInput('discordWebhook');
    const enabled = core.getBooleanInput('releaseEnabled');
    const metadata = core.getBooleanInput('saveMetadata');
    const update_release_data = core.getBooleanInput('updateReleaseData');

    console.log(`Using release name ${name} with prerelease: ${prerelease}, draft: ${draft}, generate release notes: ${generate_release_notes}, discussion category: ${discussion_category_name}, make latest: ${make_latest}, include release info: ${info}`);
    return { name, body, prerelease, draft, generate_release_notes, discussion_category_name, make_latest, info, hook, enabled, metadata, update_release_data, body_dependency_usage };
}

async function getSuccess(inp: {api: OctokitApi, repoData: Repo}): Promise<boolean> {
    const { api, repoData } = inp;

    const { owner, repo } = repoData;

    const runID = process.env.GITHUB_RUN_ID!;
    const statusResponse = await api.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: parseInt(runID) });
    const success = statusResponse.data.jobs.filter(job => job.conclusion === 'failure').length === 0;
    console.log(`Workflow status is: ${success ? 'success' : 'failure'}`);

    return success;
}
async function getTag(inp: {repoData: Repo, prevRelease: PreviousRelease}): Promise<Inputs.Tag> {
    const { repoData, prevRelease } = inp;

    const { branch } = repoData;

    const base = core.getInput('tagBase');
    const separator = core.getInput('tagSeparator');
    const prefix = core.getInput('tagPrefix') == 'auto' ? branch : core.getInput('tagPrefix');
    const increment = core.getBooleanInput('tagIncrement');

    if (base === 'auto') {
        if (prevRelease.baseTag != null && parse.isPosInteger(prevRelease.baseTag)) {
            const buildNumber = parseInt(prevRelease.baseTag) + (increment ? 1 : 0);
            return { base: buildNumber.toString(), prefix, separator, increment };
        }

        if (prevRelease.baseTag == null) {
            return { base: '1', prefix, separator, increment };
        }
    }

    if (parse.isPosInteger(base) && increment) {
        const buildNumber = parseInt(base) + 1;
        return { base: buildNumber.toString(), prefix, separator, increment };
    }

    console.log(`Using release tag ${prefix}${separator}${base} with increment: ${increment}`);
    return { base, prefix, separator, increment };
}

async function getChanges(inp: {api: OctokitApi, prevRelease: PreviousRelease, repoData: Repo}): Promise<Inputs.Change[]> {
    const { api, prevRelease, repoData } = inp;

    const { branch, defaultBranch, lastCommit } = repoData;
    let firstCommit = '';

    try {
        if (prevRelease.commit == null) {
            if (branch === defaultBranch) {
                firstCommit = `${lastCommit}^`;
            } else {
                const compareReponse = await api.rest.repos.compareCommits({ owner: repoData.owner, repo: repoData.repo, base: defaultBranch, head: branch });
                try {
                    firstCommit = `${compareReponse.data.commits[0].sha}^`;
                } catch (error) {
                    firstCommit = `${lastCommit}^`;
                }
            }
        } else {
            firstCommit = prevRelease.commit;
        }
    
        const changes: Inputs.Change[] = [];
    
        const compareReponse = await api.rest.repos.compareCommits({ owner: repoData.owner, repo: repoData.repo, base: firstCommit, head: lastCommit, page: 1, per_page: 9999 });
        const commits = compareReponse.data.commits;
    
        for (const c of commits) {
            const commit = c.sha;
            const summary = c.commit.message.split('\n')[0];
            const message = c.commit.message;
            const timestamp = c.commit.committer && c.commit.committer.date ? new Date(c.commit.committer.date).getTime().toString() : '';
            const author = c.author ? c.author.login : '';
            const coauthors = c.commit.message.match(/Co-authored-by: (.*) <(.*)>/g)
                ?.map((coauthor) => coauthor.replace(/Co-authored-by: (.*) <(.*)>/, '$1'))
                .filter((value, index, array) => array.indexOf(value) === index)
                .filter((coauthor) => coauthor !== '') ?? [];
    
            changes.push({ commit, summary, message, timestamp, author, coauthors });
        }
    
        console.log('');
        console.log(`Found ${changes.length} changes in commit range ${firstCommit}...${lastCommit}`);
        return changes;
    } catch (error) {
        console.log(`Using empty changes as they could not be found.`);
        return [];
    }
}

async function getReleaseBody(inp: {repoData: Repo, changes: Inputs.Change[], usageExamples: Inputs.Release['body_dependency_usage'], tag: Inputs.Tag}): Promise<string> {
    const { repoData, changes, usageExamples, tag } = inp;

    const bodyPath = core.getInput('releaseBodyPath');

    if (!fs.existsSync(bodyPath)) {
        // Generate release body ourselves
        if (changes.length === 0) {
            return '';
        }

        let body = '';
        
        const { owner, repo, url } = repoData;
        const firstCommit = changes[0].commit.slice(0, 7);
        const lastCommit = changes[changes.length - 1].commit.slice(0, 7);
        const diffURL = `${url}/${owner}/${repo}/compare/${firstCommit}^...${lastCommit}`;

        body += `## Changes: [\`${firstCommit}...${lastCommit}\`](${diffURL})${os.EOL}`;

        const changeLimit = core.getInput('releaseChangeLimit');
        let truncatedChanges = 0;
        if (parse.isPosInteger(changeLimit)) {
            truncatedChanges = changes.length - parseInt(changeLimit); 
            changes.length = Math.min(changes.length, parseInt(changeLimit));
        }

        
        for (const change of changes) {
            let authors = '';
            switch (change.coauthors.length) {
                case 0:
                    authors = `@${change.author}`;
                    break;
                case 1:
                    authors = `@${change.author} & @${change.coauthors[0]}`;
                    break;
                default:
                    const allAuthors = [change.author, ...change.coauthors].map(author => `@${author}`);
                    authors = `${allAuthors.slice(0, allAuthors.length - 1).join(', ')} & ${allAuthors[allAuthors.length - 1]}`;
                    break;
            }
            const sha = change.commit.slice(0, 7);
            body += `- ${markdownEscape(change.summary)} ([\`${sha}\`](${url}/${owner}/${repo}/commit/${sha})) by ${markdownEscape(authors)}${os.EOL}`;
        }

        if (truncatedChanges > 0) {
            body += `... and ${truncatedChanges} more${os.EOL}`;
        }

        if (usageExamples.type !== 'none') {
            switch (usageExamples.type) {
                case 'java':
                    if (!usageExamples.java) break;
                    if (!usageExamples.java.group_id || !usageExamples.java.artifact_id) break;

                    body += `## Usage${os.EOL}`;

                    let { group_id, artifact_id, version: javaVersion, maven_repo } = usageExamples.java;

                    if (!javaVersion) {
                        javaVersion = tag.base;
                    };

                    body += `### Gradle (Kotlin DSL)${os.EOL}`;
                    body += '```kotlin' + os.EOL;
                    if (maven_repo) {
                        body += `repositories {` + os.EOL;
                        body += `    maven("${maven_repo}")` + os.EOL;
                        body += `}` + os.EOL;
                        body += os.EOL;
                    }
                    body += `implementation("${group_id}:${artifact_id}:${javaVersion}")` + os.EOL;
                    body += '```' + os.EOL;

                    body += `### Gradle (Groovy)${os.EOL}`;
                    body += '```groovy' + os.EOL;
                    if (maven_repo) {
                        body += `repositories {` + os.EOL;
                        body += `    maven { url "${maven_repo}" }` + os.EOL;
                        body += `}` + os.EOL;
                        body += os.EOL;
                    }
                    body += `implementation '${group_id}:${artifact_id}:${javaVersion}'` + os.EOL;
                    body += '```' + os.EOL;

                    body += `### Maven${os.EOL}`;
                    body += '```xml' + os.EOL;
                    if (maven_repo) {
                        body += `<repositories>` + os.EOL;
                        body += `    <repository>` + os.EOL;
                        body += `        <id>${repoData.owner}</id>` + os.EOL;
                        body += `        <url>${maven_repo}</url>` + os.EOL;
                        body += `    </repository>` + os.EOL;
                        body += `</repositories>` + os.EOL;
                        body += os.EOL;
                    }
                    body += `<dependency>` + os.EOL;
                    body += `    <groupId>${group_id}</groupId>` + os.EOL;
                    body += `    <artifactId>${artifact_id}</artifactId>` + os.EOL;
                    body += `    <version>${javaVersion}</version>` + os.EOL;
                    body += `</dependency>` + os.EOL;
                    body += '```' + os.EOL;

                    break;
                case 'nodejs':
                    if (!usageExamples.nodejs) break;
                    if (!usageExamples.nodejs.package || !usageExamples.nodejs.var_name) break;

                    body += `## Usage${os.EOL}`;

                    let { package: packageName, version: nodejsVersion, var_name } = usageExamples.nodejs;

                    if (!nodejsVersion) {
                        nodejsVersion = tag.base;
                    };

                    body += `### Install${os.EOL}`;
                    body += '```bash' + os.EOL;
                    body += `npm install ${packageName}@${nodejsVersion}` + os.EOL;
                    body += `yarn add ${packageName}@${nodejsVersion}` + os.EOL;
                    body += `pnpm add ${packageName}@${nodejsVersion}` + os.EOL;
                    body += '```' + os.EOL;

                    body += `### Import${os.EOL}`;
                    body += '```js' + os.EOL;
                    body += `const ${var_name} = require('${packageName}');` + os.EOL;
                    body += `import ${var_name} from '${packageName}';` + os.EOL;
                    body += '```' + os.EOL;
                    break;
            }
        }

        return body;
    }

    return fs.readFileSync(bodyPath, { encoding: 'utf-8' });
}

async function getPreRelease(inp: {repoData: Repo}): Promise<boolean> {
    const { repoData } = inp;

    const { branch, defaultBranch } = repoData;

    const preRelease = core.getInput('preRelease');

    if (preRelease === 'auto') {
        return defaultBranch !== branch;
    }

    return preRelease === 'true';
}

function getName(inp: {tag: Inputs.Tag, branch: string}): string {
    const { tag, branch } = inp;

    const name = core.getInput('releaseName')
        .replace('${tagBase}', tag.base)
        .replace('${tagPrefix}', tag.prefix)
        .replace('${tagSeparator}', tag.separator)
        .replace('${branch}', branch);

    if (name === 'auto') {
        return `Build ${tag.base} (${branch})`;
    }

    return name;
}

async function getDiscussionCategory(inp: {api: OctokitApi, owner: string, repo: string}): Promise<string | undefined> {
    const category = core.getInput('discussionCategory');

    // Currently the api to create one if it doesn't exist is not available
    // Add here when it is

    if (category === 'none') {
        return undefined;
    }

    return category;
}

function getMakeLatest(inp: {prerelease: boolean, success: boolean}): "true" | "false" | "legacy" | undefined {
    const { prerelease, success } = inp;

    if (!success) {
        return "false";
    }
    
    const make_latest = core.getInput('latestRelease');

    switch (make_latest) {
        case "true":
        case "false":
        case "legacy":
            break;
        case "auto":
            return prerelease ? "false" : "true";
        default:
            return undefined;
    }

    return make_latest;
}

function getBodyDependencyUsage(): Inputs.Release['body_dependency_usage'] {
    const dependency_usage_examples = core.getInput('releaseBodyDependencyUsage');

    switch (dependency_usage_examples) {
        case "java":
            return {
                type: "java",
                java: {
                    group_id: core.getInput('releaseBodyDependencyJavaGroupId') || undefined,
                    artifact_id: core.getInput('releaseBodyDependencyJavaArtifactId') || undefined,
                    version: core.getInput('releaseBodyDependencyJavaVersion') || undefined,
                    maven_repo: core.getInput('releaseBodyDependencyJavaMavenRepo') || undefined
                }
            }
        case "nodejs":
            return {
                type: "nodejs",
                nodejs: {
                    package: core.getInput('releaseBodyDependencyNodejsPackage') || undefined,
                    version: core.getInput('releaseBodyDependencyNodejsVersion') || undefined,
                    var_name: core.getInput('releaseBodyDependencyNodejsVarName') || undefined
                }
            }
        case "none":
        default:
            return {
                type: "none"
            };
    }
}