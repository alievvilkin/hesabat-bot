const {
    Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, REST, Routes, MessageFlags
} = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ================== KONFİQ ==================
const PORT = process.env.PORT || 3000;
const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const SHEET_TITLE = 'Bot_Hesabatları';
const DEBUG = process.env.DEBUG === '1';

// Xatırlatma ayarları (.env-dən)
const REPORT_CHANNEL_ID = (process.env.REPORT_CHANNEL_ID || '').trim(); // xəbərdarlıq yazılacaq kanal
const TEAM_ROLE_ID = (process.env.TEAM_ROLE_ID || '').trim();           // hesabat yazmalı olan rol
const REMINDER_CRON = process.env.REMINDER_CRON || '59 23 * * *';       // hər gün 23:59
const TIMEZONE = 'Asia/Baku';

// Göndərənlərin qeydi (server restart olsa da itmir)
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

// Qlobal xətalar botu öldürməsin
process.on('unhandledRejection', err => console.error('❌ Unhandled Rejection:', err));
process.on('uncaughtException', err => console.error('❌ Uncaught Exception:', err));

// ================== TARİX KÖMƏKÇİLƏRİ ==================
// Bakı vaxtı ilə bugünkü tarix: "2026-10-15"
function todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function isWeekendBaku() {
    const day = new Date().toLocaleDateString('en-US', { timeZone: TIMEZONE, weekday: 'short' });
    return day === 'Sat' || day === 'Sun';
}

// ================== GÖNDƏRƏNLƏRİN QEYDİ ==================
function loadSubmissions() {
    try {
        return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveSubmissions(data) {
    // 30 gündən köhnə qeydləri sil
    const keys = Object.keys(data).sort();
    while (keys.length > 30) delete data[keys.shift()];
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(data, null, 2));
}

function markSubmitted(userId) {
    const data = loadSubmissions();
    const key = todayKey();
    if (!data[key]) data[key] = [];
    if (!data[key].includes(userId)) data[key].push(userId);
    saveSubmissions(data);
}

function submittedToday() {
    return new Set(loadSubmissions()[todayKey()] || []);
}

// ================== GOOGLE SHEETS ==================
let docCache = null;

// Açar necə yapışdırılsa da (Enter, boşluq, \n, dırnaq) standart PEM formatına salınır
function normalizePrivateKey(raw) {
    const body = (raw || '')
        .replace(/\\n/g, '')
        .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
        .replace(/["'\s]/g, '');
    if (!body) throw new Error('GOOGLE_PRIVATE_KEY boşdur!');
    return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function getSheet() {
    if (!docCache) {
        const key = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

        const auth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, auth);
        await doc.loadInfo();
        docCache = doc;
        console.log(`📊 Google Sheets qoşuldu: "${doc.title}"`);
    }
    return docCache.sheetsByTitle[SHEET_TITLE] || docCache.sheetsByIndex[0];
}

// ================== DISCORD CLIENT ==================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers // rol üzvlərini görmək üçün (Developer Portal-da aktiv edilməlidir)
    ]
});

if (DEBUG) {
    client.on('debug', m => {
        if (!m.includes('Heartbeat')) console.log('[DEBUG]', m);
    });
}
client.on('error', e => console.error('[DISCORD ERROR]', e));
client.on('warn', w => console.warn('[DISCORD WARN]', w));
client.rest.on('rateLimited', r => console.warn('[RATELIMIT]', r));

// ================== XATIRLATMA ==================
async function checkMissingReports({ manual = false } = {}) {
    if (!REPORT_CHANNEL_ID || !TEAM_ROLE_ID) {
        console.error('❌ REPORT_CHANNEL_ID və ya TEAM_ROLE_ID .env-də yoxdur, xatırlatma işləmir.');
        return '❌ REPORT_CHANNEL_ID və ya TEAM_ROLE_ID təyin edilməyib.';
    }
    

    const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
    const guild = channel.guild;
    await guild.members.fetch(); // bütün üzvləri yüklə

    const role = guild.roles.cache.get(TEAM_ROLE_ID);
    if (!role) {
        console.error('❌ TEAM_ROLE_ID ilə rol tapılmadı.');
        return '❌ Rol tapılmadı.';
    }

    const done = submittedToday();
    const missing = role.members.filter(m => !m.user.bot && !done.has(m.id));

    if (missing.size === 0) {
        await channel.send('✅ Bu gün komandada hamı hesabatını göndərib. Təşəkkürlər!');
        console.log('✅ Hamı hesabat göndərib.');
        return 'Hamı göndərib.';
    }

    const header = '⏰ **Bu gün hesabat göndərməyənlər:**\n';
    const footer = '\n\nZəhmət olmasa hesabatı gecikdirməyin. `/hesabat` yazaraq göndərin.';
    const mentions = missing.map(m => `<@${m.id}>`);

    // Discord limiti: 2000 simvol — lazım olsa bir neçə mesaja böl
    let chunk = header;
    for (const mention of mentions) {
        if ((chunk + mention + ' ' + footer).length > 1900) {
            await channel.send({ content: chunk, allowedMentions: { users: missing.map(m => m.id) } });
            chunk = '';
        }
        chunk += mention + ' ';
    }
    await channel.send({ content: chunk + footer, allowedMentions: { users: missing.map(m => m.id) } });

    console.log(`⏰ Xatırlatma göndərildi: ${missing.size} nəfər`);
    return `${missing.size} nəfər etiketləndi.`;
}

// ================== READY ==================
let readyHandled = false;
async function onReady() {
    if (readyHandled) return;
    readyHandled = true;
    console.log(`🤖 Bot ${client.user.tag} adı ilə AKTİV OLDU!`);

    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), {
            body: [
                { name: 'hesabat', description: 'Gündəlik iş hesabatı formasını açır' },
                {
                    name: 'hesabat-yoxla',
                    description: 'Bu gün hesabat göndərməyənləri indi etiketlə (yalnız admin)',
                    default_member_permissions: '8' // Administrator
                }
            ]
        });
        console.log('✅ /hesabat və /hesabat-yoxla komandaları qeydiyyata alındı');
    } catch (err) {
        console.error('❌ Slash komanda xətası:', err);
    }

    // Hər gün 23:59 (Bakı vaxtı) avtomatik yoxlama
    cron.schedule(REMINDER_CRON, () => {
        checkMissingReports().catch(err => console.error('❌ Xatırlatma xətası:', err));
    }, { timezone: TIMEZONE });
    console.log(`⏰ Gündəlik xatırlatma aktivdir: "${REMINDER_CRON}" (${TIMEZONE})`);
}
client.once('clientReady', onReady);

// ================== INTERACTIONS ==================
client.on('interactionCreate', async interaction => {
    try {
        // /hesabat -> Modal
        if (interaction.isChatInputCommand() && interaction.commandName === 'hesabat') {
            const modal = new ModalBuilder()
                .setCustomId('hesabatModal')
                .setTitle('Gündəlik İş Hesabatı');

            // 1. Tarix (manual — gecikmiş hesabat üçün)
            const tarixInput = new TextInputBuilder()
                .setCustomId('tarixInput')
                .setLabel('Tarix')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('məs: 14.10.2026')
                .setRequired(true)
                .setMaxLength(20);

            // 2. Ofis + saat aralığı (tək sahədə)
            const ofisInput = new TextInputBuilder()
                .setCustomId('ofisInput')
                .setLabel('Ofisə getdin? (Xeyr / saat aralığı)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('məs: Xeyr  və ya  10:00-18:00')
                .setRequired(true)
                .setMaxLength(40);

            // 3. Neçə saat işlədi
            const hoursInput = new TextInputBuilder()
                .setCustomId('hoursInput')
                .setLabel('Neçə saat işlədin')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('məs: 5')
                .setRequired(true)
                .setMaxLength(20);

            // 4. Nə işlədi
            const workInput = new TextInputBuilder()
                .setCustomId('workInput')
                .setLabel('Nə işlədin')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(2000);

            // 5. Problem / Qeyd (opsional)
            const problemInput = new TextInputBuilder()
                .setCustomId('problemInput')
                .setLabel('Problem / Qeyd')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder().addComponents(tarixInput),
                new ActionRowBuilder().addComponents(ofisInput),
                new ActionRowBuilder().addComponents(hoursInput),
                new ActionRowBuilder().addComponents(workInput),
                new ActionRowBuilder().addComponents(problemInput)
            );

            return await interaction.showModal(modal);
        }

        // /hesabat-yoxla -> indi yoxla (test üçün)
        if (interaction.isChatInputCommand() && interaction.commandName === 'hesabat-yoxla') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await checkMissingReports({ manual: true });
            return await interaction.editReply(`Yoxlama tamamlandı: ${result}`);
        }

        // Modal submit -> Google Sheets
        if (interaction.isModalSubmit() && interaction.customId === 'hesabatModal') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const tarix = interaction.fields.getTextInputValue('tarixInput');
            const ofis = interaction.fields.getTextInputValue('ofisInput');
            const hours = interaction.fields.getTextInputValue('hoursInput');
            const work = interaction.fields.getTextInputValue('workInput');
            const problem = interaction.fields.getTextInputValue('problemInput') || 'Yoxdur';
            const username = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

            try {
                const sheet = await getSheet();
                await sheet.addRow({
                    'Tarix': tarix,
                    'Adı': username,
                    'Ofis / Saat aralığı': ofis,
                    'İşləmə Saatı': hours,
                    'İşlənilənlər': work,
                    'Problemlər': problem
                });

                markSubmitted(interaction.user.id); // bu gün göndərdi kimi qeyd et

                await interaction.editReply('✅ Hesabatınız Google Sheets cədvəlinə əlavə olundu!');
                console.log(`📝 Hesabat yazıldı: ${username}`);
            } catch (error) {
                docCache = null; // növbəti cəhddə yenidən qoşulsun
                console.error('❌ Google Sheets xətası:', error?.response?.data || error);
                await interaction.editReply('❌ Cədvələ yazılarkən xəta baş verdi. Adminə bildirin.');
            }
        }
    } catch (err) {
        console.error('❌ Interaction xətası:', err);
    }
});

// ================== WEB SERVER ==================
const app = express();
app.get('/', (req, res) => {
    res.send(client.isReady() ? `✅ Bot online: ${client.user.tag}` : '⏳ Bot hələ Discord-a qoşulmayıb');
});

// ================== START ==================
async function diagnoseGateway() {
    try {
        const r = await fetch('https://discord.com/api/v10/gateway/bot', {
            headers: { Authorization: `Bot ${TOKEN}` }
        });
        const body = (await r.text()).slice(0, 200);
        console.log(`🌍 Gateway status: ${r.status} | ${body}`);

        if (r.status === 401) console.error('❌ TOKEN SƏHVDİR! Developer Portal-dan yeni token al.');
        if (r.status === 429 || body.includes('1015')) {
            console.error('❌ Bu serverin IP-si Discord tərəfindən BLOKLANIB (Cloudflare).');
        }
    } catch (err) {
        console.error('❌ Discord-a şəbəkə bağlantısı yoxdur:', err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`🌐 Web server ${PORT} portunda işləyir`);

    if (!TOKEN) return console.error('❌ DISCORD_TOKEN TAPILMADI!');
    console.log(`🔑 Token uzunluğu: ${TOKEN.length}`);

    await diagnoseGateway();

    const timeout = setTimeout(() => {
        console.error('⚠️ 15 saniyədir Discord cavab vermir. DEBUG=1 qoyub logları yoxla.');
    }, 15000);

    try {
        console.log('🔑 Discord-a qoşulur...');
        await client.login(TOKEN);
        clearTimeout(timeout);
        console.log('⚡ Discord login uğurlu');
    } catch (err) {
        clearTimeout(timeout);
        console.error('❌ DISCORD LOGIN XƏTASI:', err);
    }
});
