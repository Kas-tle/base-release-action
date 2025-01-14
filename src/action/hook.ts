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

    let assets = '';
    for (const asset of updatedRelease.data.assets) {
        assets += `- :page_facing_up: [${asset.name}](${asset.browser_download_url})\n`;
    }
    assets += `- :package: [Source code (zip)](${updatedRelease.data.zipball_url})\n`;
    assets += `- :package: [Source code (tar.gz)](${updatedRelease.data.tarball_url})\n`;

    const time = Math.floor(new Date(updatedRelease.data.created_at).getTime() / 1000);
    const author = updatedRelease.data.author.type === 'User' ? updatedRelease.data.author.login : updatedRelease.data.author.login.replace('[bot]', '');
    const sha = inputs.changes[inputs.changes.length - 1].commit.slice(0, 7);
    const statusEmoji = failed ? ':red_circle:' : ':green_circle:';
    const status = failed ? 'Failed' : 'Success';
    const runID = process.env.GITHUB_RUN_ID!;

    const embed = new Embed()
        .setTimestamp()
        .setAuthor({
            name: `${owner}/${repo}`,
            url: `${url}/${owner}/${repo}`,
            icon_url: `${url}/${owner}.png`
        })
        .setColor(color)
        .setTitle(inputs.release.name)
        .setUrl(updatedRelease.data.html_url)
        .setDescription(inputs.release.body)
        .addField({ name: 'Assets', value: assets, inline: false })
        .addField({ name: '', value: `:watch: <t:${time}:R>`, inline: true })
        .addField({ name: '', value: `:label: [${tag}](${url}/${owner}/${repo}/tree/${tag})`, inline: true })
        .addField({ name: '', value: `:lock_with_ink_pen: [${sha}](${url}/${owner}/${repo}/commit/${sha})`, inline: true })
        .addField({ name: '', value: `${statusEmoji} [${status}](${url}/${owner}/${repo}/actions/runs/${runID})`, inline: true })
        .setFooter({ text: `Released by ${author}`, icon_url: updatedRelease.data.author.avatar_url })

    if (thumbnail) {
        embed.setImage({ url: thumbnail });
    }

    try {
        new Webhook(inputs.release.hook)
            .setUsername('GitHub Release Action')
            .setAvatarUrl('https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')
            .addEmbed(embed)
            .send();
    } catch (error) {
        console.log('Could not send webhook: ', error);
    }
}