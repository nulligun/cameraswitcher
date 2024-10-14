const { Client, Events, GatewayIntentBits,ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle, Partials, REST, Routes,
    PermissionFlagsBits, GuildChannelTypes, ChannelType,
    SlashCommandBuilder } = require('discord.js');
require('dotenv').config();
const OBSWebSocket = require('obs-websocket-js').OBSWebSocket;
const {joinVoiceChannel, VoiceConnectionStatus} = require('@discordjs/voice');
async function loadAnyAscii() {
    const { default: anyAscii } = await import('any-ascii');
    return anyAscii;
}

let currentScene = process.env.default_scene;
let currentSource = process.env.default_source;
let sourceQueue = [];

let connections = {};
let isCameraOn = true;


const commands = [
    {name: 'scene',
        description: 'Set the scene to manage',
        options: [
            {
                name: 'scene',
                type: 3, // 3 is the type for a string
                description: 'The scene you are managing',
                required: true, // It's required, so the user must provide it\
            }]
    },
    {
        name: 'camera',
        description: 'Manage the camera state',
        options: [
            {
                name: 'state',
                type: 3, // 3 is the type for a string
                description: 'Turn the camera on or off',
                required: false, // It's optional, so the user can run `/camera` alone
                choices: [
                    {
                        name: 'on',
                        value: 'on',
                    },
                    {
                        name: 'off',
                        value: 'off',
                    }
                ]
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_PRIVATE_TOKEN);

const obs = new OBSWebSocket();

const client = new Client({partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    intents: ["DirectMessages", "DirectMessageReactions", "Guilds", "GuildBans",
        "GuildInvites", "GuildMembers", "GuildMessages", "GuildMessageReactions",
        "GuildVoiceStates"],
    restWsBridgeTimeout: 60000,
    ws: {version: 8}});

let connected = false;
let sourceNameToId = {};
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

                obs.call('GetSceneItemList', {sceneName: currentScene}).then(data => {
                    console.log('Sources:', data);
                    data.sceneItems.forEach((item) => {
                        sourceNameToId[item.sourceName] = item.sceneItemId;
                    });
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

async function switchSource() {
    if (isCameraOn) {
        const sourceName = (sourceQueue.length > 0) ? sourceQueue.shift() : process.env.default_source;
        if (sourceName !== currentSource) {
            try {
                console.log("Switch to source: " + sourceName);
                await obs.call('SetSceneItemEnabled', {'sceneName': currentScene, sceneItemId: sourceNameToId[currentSource], 'sceneItemEnabled': false});
                await obs.call('SetSceneItemEnabled', {'sceneName': currentScene, sceneItemId: sourceNameToId[sourceName], 'sceneItemEnabled': true});
                currentSource = sourceName;
            } catch (e) {
                console.log("error switching source");
                console.log(e);
            }
        }
    }
}

function addToQueue(sourceName) {
    // if the source is already in the queue, remove it
    if (sourceQueue.includes(sourceName)) {
        sourceQueue = sourceQueue.filter((s) => s !== sourceName);
    }
    // put it at the top of the queue
    sourceQueue.unshift(sourceName);
}

function removeFromQueue(sourceName) {
    // if the source is already in the queue, remove it
    if (sourceQueue.includes(sourceName)) {
        sourceQueue = sourceQueue.filter((s) => s !== sourceName);
    }
}

function startListening(connection) {
    const receiver = connection.receiver;

    receiver.speaking.on('start', async (userId) => {
        const user = client.users.cache.get(userId);
        console.log(`${user.displayName} started speaking`);
        // remove all non-alphanumeric characters
        const anyAscii = await loadAnyAscii();
        const sourceName = anyAscii(user.displayName).replace(/[^a-zA-Z]/g, '').toLowerCase()
        addToQueue(sourceName);
        if (currentSource === process.env.default_source) await switchSource();
    });

    receiver.speaking.on('end', async (userId) => {
        const user = client.users.cache.get(userId);
        console.log(`${user.displayName} stopped speaking`);
        const anyAscii = await loadAnyAscii();
        const sourceName = anyAscii(user.displayName).replace(/[^a-zA-Z]/g, '').toLowerCase()
        removeFromQueue(sourceName);
        await switchSource();
    });
}

client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_APP_ID, process.env.guild_id),
        { body: commands },
    );

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

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return;

        const { commandName, options } = interaction;

        if (commandName === 'camera') {
            const state = options.getString('state'); // Get the 'state' option if provided
            if (state === 'on') {
                isCameraOn = true; // Turn the camera on
                await interaction.reply('Camera is now ON.');
            } else if (state === 'off') {
                isCameraOn = false; // Turn the camera off
                await interaction.reply('Camera is now OFF.');
            } else {
                // No state provided, just report the current status
                await interaction.reply(`Camera is currently ${isCameraOn ? 'ON' : 'OFF'}.`);
            }
        } else if (commandName === 'scene') {
            const scene = options.getString('scene');
            if (scene !== currentScene) {
                try {
                    console.log("Switch to scene: " + scene);
                    await obs.call('SetCurrentProgramScene', {'sceneName': scene});
                    currentScene = scene;
                    obs.call('GetSceneItemList', {sceneName: currentScene}).then(data => {
                        console.log('Sources:', data);
                        data.sceneItems.forEach((item) => {
                            sourceNameToId[item.sourceName] = item.sceneItemId;
                        });
                    });
                    await interaction.reply(`Scene is now ${scene}.`);
                } catch (e) {
                    console.log("error switching scene");
                    console.log(e);
                }
            }
        }
    });


    await waitForConnection();
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_PRIVATE_TOKEN);