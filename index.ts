import * as core from '@actions/core'
import { getInputs } from './src/action/inputs.js';
import { writeRelease } from './src/action/release.js';
import { getRepoData } from './src/action/repo.js';
import { storeReleaseData } from './src/action/store.js';
import { uploadFiles } from './src/action/files.js';
import { authGithubApp } from './src/action/auth.js';
import { sendWebhook } from './src/action/hook.js';
import { setOutputs } from './src/action/output.js';

async function run(): Promise<void> {
    try {
        const baseRepoData = getRepoData();
        const { octokit, repoData } = await authGithubApp({baseRepoData});

        const inputs = await getInputs({api: octokit, repoData});
        const releaseResponse = await writeRelease({inputs, api: octokit, repoData});
        await storeReleaseData({inputs, api: octokit, repoData});
        await uploadFiles({api: octokit, inputs, release: releaseResponse, repoData});
        await sendWebhook({inputs, api: octokit, repoData, releaseResponse});
        await setOutputs({release: releaseResponse, inputs});

        console.log(`Release finished`);
    } catch (error: any) {
        console.log(error.message);
        core.setFailed(error.message)
    }
}

run();