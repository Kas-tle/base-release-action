import { Embed, Webhook } from '@vermaysha/discord-webhook'
import { Inputs } from '../types/inputs.js';
import { ReleaseResponse } from '../types/release.js';
import { Repo } from '../types/repo.js';
import { OctokitApi } from '../types/auth.js';

export async function sendWebhook(inp: {inputs: Inputs, api: OctokitApi, repoData: Repo, releaseResponse: ReleaseResponse | null}) {
    const { inputs, api, repoData, releaseResponse } = inp;
    
    if (!releaseResponse) {
        return;
    }

    if (!inputs.release.hook) {
        return;
    }

    const { owner, repo, url } = repoData;

    const failed = !inputs.success
    const color = failed ? '#e00016' : (inputs.release.prerelease ? '#fcbe03' : '#03fc5a');
    const updatedRelease = await api.rest.repos.getRelease({ owner, repo, release_id: releaseResponse.data.id });
    const tag = updatedRelease.data.tag_name;

    const thumbnail= `https://opengraph.githubassets.com/1/${owner}/${repo}/releases/tag/${tag}`;

    // Prepare Asset Fields (Split if > 1024)
    let assetLines: string[] = [];
    for (const asset of updatedRelease.data.assets) {
        assetLines.push(`- :page_facing_up: [${asset.name}](${asset.browser_download_url})`);
    }
    assetLines.push(`- :package: [Source code (zip)](${updatedRelease.data.zipball_url})`);
    assetLines.push(`- :package: [Source code (tar.gz)](${updatedRelease.data.tarball_url})`);

    const assetFields: { name: string; value: string; inline: boolean }[] = [];
    let currentAssetChunk = '';
    
    for (const line of assetLines) {
        if (currentAssetChunk.length + line.length + 1 > 1024) {
            assetFields.push({ name: 'Assets', value: currentAssetChunk, inline: false });
            currentAssetChunk = '';
        }
        currentAssetChunk += line + '\n';
    }
    if (currentAssetChunk) {
        assetFields.push({ name: 'Assets', value: currentAssetChunk, inline: false });
    }

    // Prepare Static Fields
    const time = Math.floor(new Date(updatedRelease.data.created_at).getTime() / 1000);
    const sha = inputs.changes[inputs.changes.length - 1].commit.slice(0, 7);
    const statusEmoji = failed ? ':red_circle:' : ':green_circle:';
    const status = failed ? 'Failed' : 'Success';
    const runID = process.env.GITHUB_RUN_ID!;

    const staticFields = [
        { name: '', value: `:watch: <t:${time}:R>`, inline: true },
        { name: '', value: `:label: [${tag}](${url}/${owner}/${repo}/tree/${tag})`, inline: true },
        { name: '', value: `:lock_with_ink_pen: [${sha}](${url}/${owner}/${repo}/commit/${sha})`, inline: true },
        { name: '', value: `${statusEmoji} [${status}](${url}/${owner}/${repo}/actions/runs/${runID})`, inline: true }
    ];

    // Enforce Field Count Limit (Max 25)
    // We have 4 static fields, leaving 21 slots for assets
    if (assetFields.length > 21) {
        assetFields.length = 21;
    }
    const allFields = [...assetFields, ...staticFields];

    // Truncate & Calculate Sizes
    // Author Name: Max 256
    const embedAuthorName = `${owner}/${repo}`.substring(0, 256);
    
    // Title: Max 256
    const embedTitle = inputs.release.name.substring(0, 256);

    // Footer: Max 2048
    let author = updatedRelease.data.author.type === 'User' ? updatedRelease.data.author.login : updatedRelease.data.author.login.replace('[bot]', '');
    const embedFooterText = `Released by ${author}`.substring(0, 2048);

    // Calculate current used size (excluding description)
    let currentTotalSize = 0;
    currentTotalSize += embedAuthorName.length;
    currentTotalSize += embedTitle.length;
    currentTotalSize += embedFooterText.length;
    
    for (const f of allFields) {
        currentTotalSize += (f.name.length || 0) + (f.value.length || 0);
    }

    // Description: Max 4096, but Total Embed must be <= 6000
    const availableForDesc = 6000 - currentTotalSize;
    const maxDesc = Math.min(4096, availableForDesc);
    const description = (inputs.release.body || '').substring(0, Math.max(0, maxDesc));

    const embed = new Embed()
        .setTimestamp()
        .setAuthor({
            name: embedAuthorName,
            url: `${url}/${owner}/${repo}`,
            icon_url: `${url}/${owner}.png`
        })
        .setColor(color)
        .setTitle(embedTitle)
        .setUrl(updatedRelease.data.html_url)
        .setDescription(description)
        .setFooter({ text: embedFooterText, icon_url: updatedRelease.data.author.avatar_url })

    for (const field of allFields) {
        embed.addField(field);
    }

    if (thumbnail) {
        embed.setImage({ url: thumbnail });
    }

    try {
        await new Webhook(inputs.release.hook)
            .setUsername('GitHub Release Action')
            .setAvatarUrl('https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')
            .addEmbed(embed)
            .send();
    } catch (error) {
        console.log('Could not send webhook: ', error);
    }
}