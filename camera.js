const { Client, Events, GatewayIntentBits,ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle, Partials, REST, Routes,
    PermissionFlagsBits, GuildChannelTypes, ChannelType,
    SlashCommandBuilder } = require('discord.js');
require('dotenv').config();
const OBSWebSocket = require('obs-websocket-js').OBSWebSocket;
const {AudioPlayerError,
    AudioPlayerStatus, joinVoiceChannel, VoiceConnectionStatus, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
async function loadAnyAscii() {
    const { default: anyAscii } = await import('any-ascii');
    return anyAscii;
}
const ElevenLabs = require("elevenlabs-node");

const voice = new ElevenLabs(
    {
        apiKey:  process.env.eleven_apikey,
        voiceId: "BfDbhCUVGzNgO4WXDRdy",
    }
);
let queue = [];
let playing = false;
const player = createAudioPlayer();

player.on(AudioPlayerError, async (error) => {
    console.log("AudioPlayerError: " + error);
    playing = false;
    if (queue.length > 0) {
        const filename = queue.shift();
        await playFile(filename);
    }
});
player.on(AudioPlayerStatus.Idle, async () => {
    console.log("done playing nully audio");
    playing = false;
    if (queue.length > 0) {
        const filename = queue.shift();
        await playFile(filename);
    } else {
        removeFromQueue(selfUsername);
        sourceTalking[selfUsername] = false;
        if (currentMode === 'single') {
            await switchSource();
        } else {
            if (sourceNameToId[selfUsername]) {
                await obs.call('SetSceneItemEnabled', {
                    'sceneName': currentScene,
                    sceneItemId: sourceNameToId[selfUsername],
                    'sceneItemEnabled': false
                });
            } else {
                console.log("Source not found: " + selfUsername);
            }
        }
    }
});

player.on(AudioPlayerStatus.Buffering, () => {
    console.log("Buffering");
});

player.on(AudioPlayerStatus.AutoPaused, () => {
    console.log("AutoPaused");
})

player.on(AudioPlayerStatus.Paused, () => {
    console.log("Paused");
});

player.on(AudioPlayerStatus.Playing, () => {
    console.log("Playing");
});

async function playFile(filename) {
    if (!playing) {
        addToQueue(selfUsername);
        sourceTalking[selfUsername] = true;
        if (currentMode === 'single') {
            if (currentSource === process.env.default_source) await switchSource();
        } else {
            await switchSource(selfUsername);
        }
        playing = true;
        const connection = connections[process.env.guild_id];

        const resource = createAudioResource(filename, {
            inputType: StreamType.Arbitrary,
        });
        player.play(resource);

        connection.subscribe(player);
    } else {
        queue.push(filename);
    }
}

let currentScene = process.env.default_scene;
let currentSource = process.env.default_source;
let sourceQueue = [];
let sourceTalking = {};
let currentMode = 'multiple';

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
    {name: 'mode',
        description: 'Set single or multiple avatars at once',
        options: [
            {
                name: 'mode',
                type: 3, // 3 is the type for a string
                description: 'single or multiple',
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

async function switchSource(destSource) {
    if (isCameraOn) {
        if (currentMode === 'single') {
            const sourceName = (sourceQueue.length > 0) ? sourceQueue.shift() : process.env.default_source;
            if (sourceName !== currentSource) {
                try {
                    if (sourceNameToId[sourceName]) {
                        console.log("Switch to source: " + sourceName);
                        await obs.call('SetSceneItemEnabled', {
                            'sceneName': currentScene,
                            sceneItemId: sourceNameToId[currentSource],
                            'sceneItemEnabled': false
                        });
                        await obs.call('SetSceneItemEnabled', {
                            'sceneName': currentScene,
                            sceneItemId: sourceNameToId[sourceName],
                            'sceneItemEnabled': true
                        });
                        currentSource = sourceName;
                    }
                } catch (e) {
                    console.log("error switching source");
                    console.log(e);
                }
            }
        } else {
            if (sourceNameToId[destSource]) {
                console.log("Switch to source: " + destSource);
                await obs.call('SetSceneItemEnabled', {
                    'sceneName': currentScene,
                    sceneItemId: sourceNameToId[destSource],
                    'sceneItemEnabled': true
                });
            } else {
                console.log("Source not found: " + destSource);
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
        sourceTalking[sourceName] = true;
        addToQueue(sourceName);
        if (currentMode === 'single') {
            if (currentSource === process.env.default_source) await switchSource();
        } else {
            await switchSource(sourceName);
        }
    });

    receiver.speaking.on('end', async (userId) => {
        const user = client.users.cache.get(userId);
        console.log(`${user.displayName} stopped speaking`);
        const anyAscii = await loadAnyAscii();
        const sourceName = anyAscii(user.displayName).replace(/[^a-zA-Z]/g, '').toLowerCase()
        sourceTalking[sourceName] = false;
        removeFromQueue(sourceName);
        if (currentMode === 'single') {
            await switchSource();
        } else {
            if (sourceNameToId[sourceName]) {
                await obs.call('SetSceneItemEnabled', {
                    'sceneName': currentScene,
                    sceneItemId: sourceNameToId[sourceName],
                    'sceneItemEnabled': false
                });
            } else {
                console.log("Source not found: " + sourceName);
            }
        }
    });
}

async function getFile(textToSay) {
    const { temporaryFile } = await import('tempy');

    const filename = temporaryFile({extension: 'mp3'});
    console.log("tmpfile: " + filename);
    await voice.textToSpeech({
        voiceId: "BfDbhCUVGzNgO4WXDRdy",
        fileName: filename,
        textInput: textToSay,
        modelId: "eleven_turbo_v2_5"
    });

    return filename;
}

let selfUsername = '';

client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    const anyAscii = await loadAnyAscii();
    selfUsername = anyAscii(readyClient.user.username).replace(/[^a-zA-Z]/g, '').toLowerCase()

    // when someone sends a direct message
    client.on(Events.MessageCreate, async message => {
        // Ignore messages from bots
        if (message.author.bot) return;

        // Check if the message is in a DM
        if (!message.guild) {
            console.log(`Received a DM from ${message.author.tag}: ${message.content}`);

            const filename = await getFile(message.content);
            if (filename) {
                await playFile(filename);
            }

        }
    });

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
                selfDeaf: false,
                selfMute: false
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
        } else if (commandName === 'mode') {
            const mode = options.getString('mode');
            if (mode === 'single' || mode === 'multiple') {
                currentMode = mode;
                await interaction.reply(`Mode is now ${mode}.`);
            } else {
                await interaction.reply(`Mode must be 'single' or 'multiple'.`);
            }
        }
    });


    await waitForConnection();
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_PRIVATE_TOKEN);