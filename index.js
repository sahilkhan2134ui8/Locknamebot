const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const fca = require('ws3-fca');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

let botConfig = {};
let lockedGroups = {};
let lockedNicknames = {};

try {
    lockedGroups = JSON.parse(fs.readFileSync('groupLocks.json', 'utf8'));
    lockedNicknames = JSON.parse(fs.readFileSync('nicknameLocks.json', 'utf8'));
} catch {
    console.log('ℹ️ No saved locks found.');
}

app.get('/', (req, res) => {
    res.send(`
        <html><head><title>Messenger Bot Config</title></head>
        <body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center">
            <h1>💬 Messenger Bot Config</h1>
            <form method="POST" action="/configure">
                <input name="adminID" placeholder="Admin Facebook ID" required><br><br>
                <input name="prefix" value="!" placeholder="Command Prefix" required><br><br>
                <textarea name="appstate" rows="10" cols="60" placeholder="Paste appstate JSON..." required></textarea><br><br>
                <button type="submit">🚀 Start Bot</button>
            </form>
        </body></html>
    `);
});

app.post('/configure', (req, res) => {
    const { adminID, prefix, appstate } = req.body;
    botConfig = { adminID, prefix };

    try {
        const parsed = JSON.parse(appstate);
        if (!Array.isArray(parsed)) throw new Error('AppState is not an array');

        fs.writeFileSync('appstate.json', JSON.stringify(parsed, null, 2));
        console.log('📄 appstate.json saved.');
        res.send('<h2>✅ Bot is starting... Check logs.</h2>');
        startBot();
    } catch (err) {
        console.error('❌ Invalid AppState:', err.message);
        res.send('<h2>❌ Invalid AppState format.</h2>');
    }
});

function saveLocks() {
    fs.writeFileSync('groupLocks.json', JSON.stringify(lockedGroups, null, 2));
    fs.writeFileSync('nicknameLocks.json', JSON.stringify(lockedNicknames, null, 2));
}

function startBot() {
    let appState;
    try {
        appState = JSON.parse(fs.readFileSync('appstate.json', 'utf8'));
    } catch (err) {
        console.error('❌ Failed to load appstate.json:', err);
        return;
    }

    fca.login(appState, (err, api) => {
        if (err) return console.error('❌ Login failed:', err);

        api.setOptions({ listenEvents: true });

        api.listenMqtt((err, event) => {
            if (err) return console.error('❌ Listen error:', err);

            if (event.type === 'message' && event.body) {
                console.log(`📩 [${event.threadID}] ${event.senderID}: ${event.body}`);
            }

            if (event.type === 'message' && event.body?.startsWith(botConfig.prefix)) {
                const senderID = event.senderID;
                const args = event.body.slice(botConfig.prefix.length).trim().split(' ');
                const command = args[0]?.toLowerCase();

                if (senderID !== botConfig.adminID) {
                    return api.sendMessage('❌ Unauthorized user.', event.threadID);
                }

                if (command === 'grouplockname' && args[1] === 'on') {
                    const groupName = args.slice(2).join(' ');
                    lockedGroups[event.threadID] = groupName;
                    saveLocks();
                    api.setTitle(groupName, event.threadID, (err) => {
                        api.sendMessage(err ? '❌ Failed.' : `✅ Locked as: ${groupName}`, event.threadID);
                    });
                }

                if (command === 'nicknamelock' && args[1] === 'on') {
                    const nickname = args.slice(2).join(' ');
                    lockedNicknames[event.threadID] = nickname;
                    saveLocks();
                    api.getThreadInfo(event.threadID, (err, info) => {
                        if (err) return api.sendMessage('❌ Thread info failed.', event.threadID);
                        info.participantIDs.forEach((uid, i) => {
                            setTimeout(() => {
                                api.changeNickname(nickname, event.threadID, uid);
                            }, i * 10000); // 10s delay
                        });
                        api.sendMessage(`✅ Nicknames locked: ${nickname}`, event.threadID);
                    });
                }

                if (command === 'ping') {
                    api.sendMessage('✅ Pong!', event.threadID);
                }
            }

            if (event.logMessageType === 'log:thread-name') {
                const name = lockedGroups[event.threadID];
                if (name) api.setTitle(name, event.threadID);
            }

            if (event.logMessageType === 'log:thread-nickname') {
                const nickname = lockedNicknames[event.threadID];
                const userID = event.logMessageData?.participant_id;
                if (nickname && userID) {
                    console.log(`🔁 Nickname reverted for ${userID}`);
                    setTimeout(() => {
                        api.changeNickname(nickname, event.threadID, userID);
                    }, 2000);
                }
            }
        });
    });
}

// 🌐 Required to keep app alive on Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌍 Bot dashboard at http://localhost:${PORT}`);
});
