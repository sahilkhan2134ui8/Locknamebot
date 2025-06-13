const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const login = require('fca-unofficial');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

let botConfig = {};
let lockedGroups = {};
let lockedNicknames = {};

// 🔐 Restore previous locks
try {
    lockedGroups = JSON.parse(fs.readFileSync('groupLocks.json', 'utf8'));
    lockedNicknames = JSON.parse(fs.readFileSync('nicknameLocks.json', 'utf8'));
} catch {
    console.log('ℹ️ No saved locks found. Continuing without restoring locks.');
}

// 🌐 Web UI
app.get('/', (req, res) => {
    res.send(`
        <html><head><title>Messenger Bot Config</title></head>
        <body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center">
            <h1>💬 Messenger Bot Config</h1>
            <form method="POST" action="/configure">
                <input name="adminID" placeholder="Admin Facebook ID" required><br><br>
                <input name="prefix" value="!" placeholder="Command Prefix" required><br><br>
                <textarea name="appstate" rows="10" cols="60" placeholder="Paste appstate JSON array..." required></textarea><br><br>
                <button type="submit">🚀 Start Bot</button>
            </form>
        </body>
        </html>
    `);
});

app.post('/configure', (req, res) => {
    const { adminID, prefix, appstate } = req.body;
    botConfig = { adminID, prefix };

    try {
        const parsed = JSON.parse(appstate);
        if (!Array.isArray(parsed)) throw new Error('AppState is not an array');

        fs.writeFileSync('appstate.json', JSON.stringify(parsed, null, 2));
        console.log('📄 [INFO] appstate.json saved.');
        res.send('<h2>✅ Bot is starting... Check terminal logs.</h2>');
        startBot();
    } catch (err) {
        console.error('❌ Invalid AppState JSON:', err.message);
        res.send('<h2>❌ Invalid AppState format. Please check your input.</h2>');
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
        console.log('📄 [INFO] appstate.json loaded successfully.');
    } catch (err) {
        console.error('❌ Failed to load appstate.json:', err);
        return;
    }

    login({ appState }, (err, api) => {
        if (err) {
            console.error('❌ Login failed:', err);
            return;
        }

        api.setOptions({ listenEvents: true });

        api.getUserInfo(api.getCurrentUserID(), (err, info) => {
            if (!err && info) {
                const name = info[api.getCurrentUserID()].name;
                console.log(`🤖 Logged in as: ${name}`);
            }
        });

        api.listenMqtt((err, event) => {
            if (err) return console.error('❌ Listen error:', err);

            if (event.type === 'message' && event.body) {
                console.log(`📨 [${event.threadID}] ${event.senderID}: ${event.body}`);
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
                        if (err) return api.sendMessage('❌ Failed to lock group name.', event.threadID);
                        api.sendMessage(`✅ Group name locked as: ${groupName}`, event.threadID);
                    });
                }

                if (command === 'nicknamelock' && args[1] === 'on') {
                    const nickname = args.slice(2).join(' ');
                    lockedNicknames[event.threadID] = nickname;
                    saveLocks();
                    api.getThreadInfo(event.threadID, (err, info) => {
                        if (err) return api.sendMessage('❌ Failed to get thread info.', event.threadID);
                        info.participantIDs.forEach((uid, i) => {
                            setTimeout(() => {
                                api.changeNickname(nickname, event.threadID, uid);
                            }, i * 10000);
                        });
                        api.sendMessage(`✅ Nicknames locked as: ${nickname}`, event.threadID);
                    });
                }

                if (command === 'ping') {
                    api.sendMessage('✅ Pong!', event.threadID);
                }
            }

            if (event.logMessageType === 'log:thread-name') {
                const lockedName = lockedGroups[event.threadID];
                if (lockedName) {
                    api.setTitle(lockedName, event.threadID);
                }
            }

            if (event.logMessageType === 'log:thread-nickname') {
                const lockedNick = lockedNicknames[event.threadID];
                if (lockedNick) {
                    const userID = event.logMessageData.participant_id;
                    console.log(`🔁 Nickname changed by user ${userID}. Reverting in 2s...`);

                    setTimeout(() => {
                        api.changeNickname(lockedNick, event.threadID, userID, (err) => {
                            if (err) {
                                console.error(`❌ Failed to revert nickname for ${userID}: ${err.message}`);
                            } else {
                                console.log(`✅ Nickname reverted for ${userID}`);
                            }
                        });
                    }, 2000);
                }
            }
        });
    });
}

// 🌍 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Server running at http://localhost:${PORT}`);
});
