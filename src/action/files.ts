import path from "path";
import fs from "fs";
import * as parse from "../util/parse.js";
import { Inputs } from "../types/inputs.js";
import { ReleaseResponse } from "src/types/release.js";
import { Repo } from "src/types/repo.js";
import { FileInfo, UploadInfo } from "../types/files.js";
import { Readable } from "stream";
import { OctokitApi } from "../types/auth.js";

export async function uploadFiles(inp: {api: OctokitApi, inputs: Inputs, release: ReleaseResponse | null, repoData: Repo}) {
    const { api, inputs, release, repoData } = inp;

    if (inputs.release.metadata) {
        await saveOfflineMetadata({inputs, repoData});
    }

    if (!release) {
        return;
    }

    const uploads = await uploadProvidedFiles({api, inputs, release, repoData});

    if (!inputs.release.info) {
        return;
    }

    await uploadReleaseData({api, inputs, release, repoData, uploads});

    return;
}

async function uploadProvidedFiles(inp: {api: OctokitApi, inputs: Inputs, release: ReleaseResponse, repoData: Repo}): Promise<Record<string, UploadInfo>> {
    const { api, inputs, release, repoData } = inp;
    const { owner, repo } = repoData;
    const { files } = inputs;
    const uploads: Record<string, UploadInfo> = {};
    const duplicateLabels = files.map(f => f.label).some((label, index, self) => self.indexOf(label) !== index);

    next: for (const file of files) {
        if (!fs.existsSync(file.path)) {
            console.log(`File ${file.path} does not exist, skipping`);
            continue next;
        }

        const name = path.basename(file.path);
        const data = fs.createReadStream(file.path);
        const size = fs.statSync(file.path).size;

        const fileResponse = await api.rest.repos.uploadReleaseAsset({
            headers: {
                'content-length': size,
                'content-type': 'application/octet-stream',
            },
            owner,
            repo,
            release_id: release.data.id,
            name,
            data: data as any,
        });

        if (!inputs.release.info) {
            continue next;
        }

        const sha256 = await parse.hashSha256(file.path);

        const info: UploadInfo = {
            name,
            id: fileResponse.data.id.toString(),
            url: fileResponse.data.browser_download_url,
            sha256
        }

        if (duplicateLabels) {
            uploads[`${file.label}-${parse.stringHash(file.path)}`] = info;
        }

        uploads[file.label] = info;
    }

    console.log(`Uploaded ${files.length} files to ${release.data.html_url}`);
    return uploads;
}

async function uploadReleaseData(inp: {api: OctokitApi, inputs: Inputs, release: ReleaseResponse, repoData: Repo, uploads: Record<string, UploadInfo>}) {
    const { api, inputs, release, repoData, uploads } = inp;

    const { owner, repo, branch } = repoData;

    const releaseData = {
        owner,
        repo,
        branch,
        id: release.data.id.toString(),
        build: parse.isPosInteger(inputs.tag.base) ? parseInt(inputs.tag.base) : inputs.tag.base,
        tag: inputs.tag.prefix + inputs.tag.separator + inputs.tag.base,
        timestamp: Date.now().toString(),
        prerelease: inputs.release.prerelease,
        changes: inputs.changes,
        downloads: uploads
    };

    // Now upload the release data as release.json
    const data = Buffer.from(JSON.stringify(releaseData, null, 4), 'utf8');
    const name = 'release.json';
    const size = data.byteLength;

    await api.rest.repos.uploadReleaseAsset({
        headers: {
            'content-length': size,
            'content-type': 'application/octet-stream',
        },
        owner,
        repo,
        release_id: release.data.id,
        name,
        data: Readable.from(data) as any,
    });

    console.log(`Uploaded release data to ${release.data.html_url}`);
}

async function saveOfflineMetadata(inp: {inputs: Inputs, repoData: Repo}) {
    const { inputs, repoData } = inp;

    const { owner, repo, branch } = repoData;

    const downloads: Record<string, FileInfo> = {};

    for (const file of inputs.files) {
        if (!fs.existsSync(file.path)) {
            console.log(`File ${file.path} does not exist, skipping`);
            continue;
        }

        const name = path.basename(file.path);
        const sha256 = await parse.hashSha256(file.path);
        downloads[file.label] = {
            name,
            sha256
        };
    }

    const metadata = {
        owner,
        repo,
        branch,
        build: parse.isPosInteger(inputs.tag.base) ? parseInt(inputs.tag.base) : inputs.tag.base,
        tag: inputs.tag.prefix + inputs.tag.separator + inputs.tag.base,
        timestamp: Date.now().toString(),
        prerelease: inputs.release.prerelease,
        changes: inputs.changes,
        downloads
    };

    const data = Buffer.from(JSON.stringify(metadata, null, 4), 'utf8');
    fs.writeFileSync('metadata.json', data);

    console.log(`Saved metadata to metadata.json`);
}