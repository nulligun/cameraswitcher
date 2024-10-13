const { Client, Events, GatewayIntentBits,ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle, Partials,
    PermissionFlagsBits, GuildChannelTypes, ChannelType,
    SlashCommandBuilder } = require('discord.js');
require('dotenv').config();
const OBSWebSocket = require('obs-websocket-js').OBSWebSocket;
const {joinVoiceChannel, VoiceConnectionStatus} = require('@discordjs/voice');

const obs = new OBSWebSocket();

const client = new Client({partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    intents: ["DirectMessages", "DirectMessageReactions", "Guilds", "GuildBans",
        "GuildInvites", "GuildMembers", "GuildMessages", "GuildMessageReactions",
        "GuildVoiceStates"],
    restWsBridgeTimeout: 60000,
    ws: {version: 8}});

let connected = false;
async function waitForConnection() {
    if (!connected) {
        console.log('Detected disconnect or boot, trying to get it back');
        while (!connected) {
            try {
                const {
                    obsWebSocketVersion,
                    negotiatedRpcVersion
                } = await obs.connect(process.env.websocket_url, process.env.websocket_password);
                connected = true;
                console.log(`Connected to server ${obsWebSocketVersion} (using RPC ${negotiatedRpcVersion})`)

                obs.call('GetVersion').then(data => {
                    console.log('OBS Version Information:', data);
                });

                obs.on('ConnectionError', async (error) => {
                    console.error('WebSocket error:', error.message);
                    await obs.disconnect(); // Close the connection to trigger the onclose event
                });

                obs.on('ConnectionClosed', async () => {
                    console.log('WebSocket closed with code');
                    console.log('Reconnecting in ${reconnectInterval / 1000} seconds...');
                    connected = false;

                    await waitForConnection();
                });

            } catch (e) {
                // sleep for 2000 ms
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log("Error trying to reconnect to OBS");
                console.log(e);
            }
        }
    }
}

async function switchScene(sceneName) {
    try {
        console.log("Switch to sceneName: " + sceneName);
        await obs.call('SetCurrentProgramScene', {'sceneName': sceneName});
    } catch (e) {
        console.log("error switching scene");
        console.log(e);
    }
}

let connections = {};

function startListening(connection) {
    const receiver = connection.receiver;

    receiver.speaking.on('start', async (userId) => {
        const user = client.users.cache.get(userId);
        console.log(`${user.displayName} started speaking`);
        // remove all non-alphanumeric characters
        const sceneName = user.displayName.replace(/[^a-zA-Z]/g, '').toLowerCase()
        await switchScene(sceneName);
    });

    receiver.speaking.on('end', async (userId) => {
        const user = client.users.cache.get(userId);
        console.log(`${user.displayName} stopped speaking`);
        const sceneName = user.displayName.replace(/[^a-zA-Z]/g, '').toLowerCase()
        await switchScene(sceneName);
    });
}

client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    let voiceChannelJoinPromises = [];

    function doJoinGuildBasedChannel(voiceChannel) {
        return new Promise((resolve3, reject) => {
            connections[voiceChannel.guild.id] = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });
            resolve3();
        });
    }

    client.guilds.cache.forEach((g) => {
        g.channels.cache.forEach((c) => {
            if (c.type === ChannelType.GuildVoice) {
                if (process.env.voice_channel === c.id) {
                    voiceChannelJoinPromises.push(doJoinGuildBasedChannel(c));
                }
            }
        });
    });

    Promise.all(voiceChannelJoinPromises).then(() => {
        const connection = connections[process.env.guild_id];

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('The bot has connected to the channel!');
            startListening(connection);
        });

        connection.on('stateChange', (old_state, new_state) => {
            if (old_state.status === VoiceConnectionStatus.Ready && new_state.status === VoiceConnectionStatus.Connecting) {
                connection.configureNetworking();
            }
        })
    });

    await waitForConnection();
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_PRIVATE_TOKEN);