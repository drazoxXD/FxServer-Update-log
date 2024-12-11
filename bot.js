const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sevenZip = require('7zip-min');
const setTitle = require('node-bash-title');

const WEBHOOK_URL = 'WEBHOOK';
const TEMP_DIR = path.join(__dirname, 'temp');
const isTestMode = process.argv.includes('-test');

console.clear();
const url = 'https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/';

let lastVersion = null;

if (fs.existsSync('lastVersion.txt')) {
    lastVersion = fs.readFileSync('lastVersion.txt', 'utf8').trim();
}

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

async function fetchAllVersions() {
    try {
        const response = await axios.get(url);
        const html = response.data;
        
        const versions = [];
        const lines = html.split('\n');
        
        const linkRegex = /<a class="panel-block[^"]*" href="\.\/(\d+)-([^/]+)\//;
        const dateRegex = /<div class="level-right">\s*<div class="level-item">\s*([^<]+)\s*<\/div>/;
        
        for (let i = 0; i < lines.length; i++) {
            const linkMatch = linkRegex.exec(lines[i]);
            if (linkMatch) {
                let date = null;
                for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                    const dateMatch = dateRegex.exec(lines[j]);
                    if (dateMatch) {
                        date = dateMatch[1].trim();
                        break;
                    }
                }
                
                versions.push({
                    version: linkMatch[1],
                    hash: linkMatch[2],
                    date: date
                });
            }
        }

        versions.sort((a, b) => parseInt(b.version) - parseInt(a.version));
        return versions;
    } catch (error) {
        console.error('Hiba a verzió lekérdezéskor:', error.message);
        return [];
    }
}
function saveLastVersion(version) {
    try {
        fs.writeFileSync('lastVersion.txt', version.toString(), 'utf8');
        console.log(`Utolsó verzió mentve: ${version}`);
    } catch (error) {
        console.error('Hiba lastVersion.txt mentése/szerkeztésekor HIBA:', error);
    }
}

async function fetchActiveVersion() {
    const versions = await fetchAllVersions();
    if (versions.length === 0) return null;

    try {
        const response = await axios.get(url);
        const html = response.data;
        const dateRegex = /<div class="level-right">\s*<div class="level-item">\s*([^<]+)\s*<\/div>/;
        const dateMatch = dateRegex.exec(html);
        const date = dateMatch ? dateMatch[1].trim() : new Date().toISOString();

        const activeVersion = versions[0];
        const downloadLink = `${url}${activeVersion.version}-${activeVersion.hash}/server.7z`;

        return {
            version: activeVersion.version,
            hash: activeVersion.hash,
            downloadLink,
            date
        };
    } catch (error) {
        console.error('HIba lekérdesékor (Talán weboldal nem üzemel):', error);
        return null;
    }
}

async function downloadAndExtract(version, hash) {
    const downloadLink = `https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/${version}-${hash}/server.7z`;
    const filePath = path.join(TEMP_DIR, `${version}.7z`);
    const extractPath = path.join(TEMP_DIR, version);

    const response = await axios({
        method: 'get',
        url: downloadLink,
        responseType: 'stream'
    });

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });

    await new Promise((resolve, reject) => {
        sevenZip.unpack(filePath, extractPath, err => {
            if (err) reject(err);
            else resolve();
        });
    });

    return extractPath;
}

//This is for my idiocy! I cant do any good shit!
function hasSignificantChange(oldSize, newSize) {
    return Math.abs(oldSize - newSize) > 100;
}

async function compareVersions(oldPath, newPath) {
    const changes = [];
    const oldFiles = await getAllFiles(oldPath);
    const newFiles = await getAllFiles(newPath);

    for (const file of newFiles) {
        const relativePath = path.relative(newPath, file);
        const oldFile = path.join(oldPath, relativePath);
        
        if (fs.existsSync(oldFile)) {
            const oldStats = fs.statSync(oldFile);
            const newStats = fs.statSync(file);
            
            if (hasSignificantChange(oldStats.size, newStats.size)) {
                const sizeDiff = newStats.size - oldStats.size;
                changes.push({
                    file: relativePath,
                    oldSize: formatBytes(oldStats.size),
                    newSize: formatBytes(newStats.size),
                    difference: formatBytes(Math.abs(sizeDiff)),
                    increased: sizeDiff > 0,
                    changed: true
                });
            }
        } else {
            changes.push({
                file: relativePath,
                newSize: formatBytes(fs.statSync(file).size),
                added: true
            });
        }
    }

    return changes;
}

async function sendWebhookMessage(version, downloadLink, date, changes, oldVersion = null) {
    if (changes.length === 0) {
        console.log('Nincs nagy update');
        return;
    }
    setTitle(`Drazox FXServer Chnagelog Webhook | FXserver ${version}`);
    const embed = {
        title: oldVersion ? 
            `🆕 FXServer Frissítés: ${oldVersion} ➜ ${version}` :
            `🆕 FXServer Verzió: ${version}`,
        description: `📥 [Letöltés](${downloadLink})`,
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
        fields: changes.map(change => ({
            name: change.file,
            value: change.added ? 
                `📥 Új fájl: ${change.newSize}` :
                `📝 ${change.increased ? 'Nagyobb' : 'Kissebb'}  ${change.difference}` +
                `\n${change.oldSize} ➜ ${change.newSize}`,
            inline: true
        }))
    };

    const message = {
        embeds: [embed]
    };

    try {
        await axios.post(WEBHOOK_URL, message);
        console.log(`Sikeres verzió küldés ${version} ${changes.length} változásokkal!`);
    } catch (error) {
        console.error('Hiba webhhok küldésekor:', error.message);
    }
}

function formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

async function getAllFiles(dir) {
    const files = await fs.promises.readdir(dir);
    const filePaths = [];
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
            filePaths.push(...await getAllFiles(filePath));
        } else {
            filePaths.push(filePath);
        }
    }
    
    return filePaths;
}

async function cleanup() {
    if (fs.existsSync(TEMP_DIR)) {
        await fs.promises.rm(TEMP_DIR, { recursive: true, force: true });
    }
}

async function checkForUpdates() {
    try {
        if (isTestMode) {
            const versions = await fetchAllVersions();
            if (versions.length < 2) {
                console.log('Nincs elegendő verzió a teszthez');
                return;
            }

            const currentVersion = versions[0];
            const previousVersion = versions[1];
            
            console.log(`TESZT MÓD: Verziók tesztelése ${previousVersion.version} -> ${currentVersion.version}`);
            
            const oldPath = await downloadAndExtract(previousVersion.version, previousVersion.hash);
            const newPath = await downloadAndExtract(currentVersion.version, currentVersion.hash);
            
            const changes = await compareVersions(oldPath, newPath);
            if (changes.length > 0) {
                const downloadLink = `${url}${currentVersion.version}-${currentVersion.hash}/server.7z`;
                await sendWebhookMessage(currentVersion.version, downloadLink, new Date().toISOString(), changes, previousVersion.version);
                console.log(`Teszt sikeres: ${changes.length} változás`);
            } else {
                console.log('Nincs változás a tesztelés során');
            }

            saveLastVersion(currentVersion.version);

        } else {
            const currentVersion = await fetchActiveVersion();
            if (!currentVersion) {
                console.log('Sikertelen verzió lekérdezés');
                return;
            }

            console.log(`Lekrért verzió: ${currentVersion.version} (Jelenlegi: ${lastVersion || 'None'})`);

            if (!lastVersion || currentVersion.version !== lastVersion) {
                console.log(`Új verzió: ${currentVersion.version}`);
                const newPath = await downloadAndExtract(currentVersion.version, currentVersion.hash);
                
                if (lastVersion) {
                    try {
                        const oldPath = path.join(TEMP_DIR, lastVersion);
                        const changes = await compareVersions(oldPath, newPath);
                        
                        if (changes.length > 0) {
                            await sendWebhookMessage(currentVersion.version, currentVersion.downloadLink, currentVersion.date, changes, lastVersion);
                            console.log(`Frissítés elküldve ${changes.length}`);
                        } else {
                            console.log('Semmi fájl nem változott');
                        }
                    } catch (compareError) {
                        console.error('Sikertelen összehasonlítás:', compareError);
                    }
                } else {
                    console.log('Első verzió, nincs összehasonlítás');
                }

                saveLastVersion(currentVersion.version);
                lastVersion = currentVersion.version;
            } else {
                console.log(`Nincs új verzió. Jelenlegi: ${currentVersion.version}`);
                setTitle(`Drazox FXServer Chnagelog Webhook | FXserver v${currentVersion.version}`);
            }
        }
    } catch (error) {
        console.error('Error in checkForUpdates:', error);
    } finally {
        try {
            await cleanup();
            console.log('Takarítás kész');
        } catch (cleanupError) {
            console.error('Hiba takarításkor:', cleanupError);
        }
    }
}

console.log('Sikeresen elindult!');
setTitle(`Drazox FXServer Chnagelog Webhook`);
checkForUpdates();
setInterval(checkForUpdates, 30000);
