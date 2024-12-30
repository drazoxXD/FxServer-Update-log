const axios = require('axios');
const fs = require('fs');
const path = require('path');
const setTitle = require('node-bash-title');
console.clear();
setTitle(`🍻  Project Spectra : FxServer Version Changes!`);
console.log("Elindult!");
const WEBHOOK_URL = 'WEBHOOK_URL';
const DB_URL = 'https://raw.githubusercontent.com/jgscripts/fivem-artifacts-db/refs/heads/main/db.json';
const BROKEN_FILE = path.join(__dirname, 'broken_artifacts.json');

const url = 'https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/';

let lastVersion = null;

if (fs.existsSync('lastVersion.txt')) {
    lastVersion = fs.readFileSync('lastVersion.txt', 'utf8').trim();
}

async function checkBrokenArtifacts() {
    try {
        // Fetch current DB
        const response = await axios.get(DB_URL);
        const currentDB = response.data;
        
        // Get broken artifacts section
        const brokenArtifacts = currentDB.brokenArtifacts || {};

        // Load saved state
        let savedBroken = {};
        if (fs.existsSync(BROKEN_FILE)) {
            savedBroken = JSON.parse(fs.readFileSync(BROKEN_FILE, 'utf8'));
        }

        // Check for changes
        const changes = [];
        for (const [version, issue] of Object.entries(brokenArtifacts)) {
            if (!savedBroken[version] || savedBroken[version] !== issue) {
                changes.push(`**${version}**\n ${issue}`);
            }
        }

        // Send webhook if there are changes
        console.log(changes);
        if (changes.length > 0) {
            const webhookData = {
                embeds: [{
                    title: "⚠️ Új ismert hibák!",
                    description: changes.join('\n\n'),
                    color: 0xFF0000,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: "FxServer Retarded changes"
                    }
                }]
            };

            await axios.post(WEBHOOK_URL, webhookData);
            console.log("Új hibák kiküldve!");
        }

        // Save new state
        fs.writeFileSync(BROKEN_FILE, JSON.stringify(brokenArtifacts, null, 2));

    } catch (error) {
        console.error('Hiba:', error.message);
    }
}

async function fetchActiveVersion() {
    try {
        const response = await axios.get(url);
        const html = response.data;

        const linkRegex = /<a class="panel-block  is-active" href="\.\/(\d+)-([^/]+)\//;
        const linkMatch = linkRegex.exec(html);
        const version = linkMatch ? linkMatch[1] : null;
        const hash = linkMatch ? linkMatch[2] : null;

        // Teljes letöltés össze állítása!
        let downloadLink = null;
        if (version && hash) {
            downloadLink = `https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/${version}-${hash}/server.7z`;
        }

        const dateRegex = /<div class="level-right">\s*<div class="level-item">\s*([^<]+)\s*<\/div>/;
        const dateMatch = dateRegex.exec(html);
        const date = dateMatch ? dateMatch[1].trim() : null;

        return { version, downloadLink, date };
    } catch (error) {
        console.error('Error fetching data:', error.message);
        return null;
    }
}

async function checkForUpdates() {
    const { version, date, downloadLink } = await fetchActiveVersion();
    if (version && version !== lastVersion) {
        lastVersion = version;
        fs.writeFileSync('lastVersion.txt', lastVersion);
        await sendWebhookMessage(version, downloadLink, date);
        console.log(`Új verzió mentve: ${version}`);
    } else {
        console.log('Nince update!\nVárakozás 30 másodprecig!')
    }
}


async function sendWebhookMessage(version, downloadLink, date) {
    try {
        const webhookData = {
            embeds: [{
                title: `Új FxServer Verzió elérhető: ${version}`,
                description: `**Letöltés:** [Link](${downloadLink})\n\n**Frissítve:** ${date}`,
                color: 0x00ff00,
                timestamp: new Date().toISOString(),
                image: {
                    //Funny gif haha
                    url: 'https://media.discordapp.net/attachments/1123813590193934378/1208095571349606470/8g2olq.gif?ex=667c492d&is=667af7ad&hm=b8f5ab89b358e9d6163dd2178d7434b1224808c37a0e63e5e422a9ec8b4a65ee&'
                }
            }]
        };

        await axios.post(WEBHOOK_URL, webhookData);
        console.log(`Frissítés ki kűrtölve ${version}`);
    } catch (error) {
        console.error('Hiba üzenet küldésekor:', error.message);
    }
}

checkForUpdates();
checkBrokenArtifacts();

//fő check
setInterval(() => {
    checkForUpdates();
    console.clear();
    console.log(`Frissítés keresése`);
}, 30 * 1000); // 30 sec
