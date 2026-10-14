const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, REST, Routes } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ] 
});

function getGoogleDoc() {
    try {
        let key = process.env.GOOGLE_PRIVATE_KEY || '';
        if (key.includes('\\n')) {
            key = key.replace(/\\n/g, '\n');
        }
        const serviceAccountAuth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        return new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
    } catch (err) {
        console.error('❌ Google Auth Xətası:', err);
        return null;
    }
}

client.once('ready', async () => {
    console.log(`🤖 Bot ${client.user.tag} adı ilə UĞURLA AKTİV OLDU!`);
    
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [{ name: 'hesabat', description: 'Gündəlik iş hesabatı formasını açır' }] }
        );
        console.log('✅ Slash komandaları (/hesabat) uğurla qeydiyyata alındı!');
    } catch (err) {
        console.error('❌ Slash komandaları xətası:', err);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'hesabat') {
        const modal = new ModalBuilder()
            .setCustomId('hesabatModal')
            .setTitle('Gündəlik İş Hesabatı');

        const workInput = new TextInputBuilder()
            .setCustomId('workInput')
            .setLabel('Görülən İşlər (İşlənilənlər)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const hoursInput = new TextInputBuilder()
            .setCustomId('hoursInput')
            .setLabel('Sərf Olunan Vaxt (Saat)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('məs: 5 saat')
            .setRequired(true);

        const problemInput = new TextInputBuilder()
            .setCustomId('problemInput')
            .setLabel('Qarşılaşdığınız Problem / Red Flag')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(workInput),
            new ActionRowBuilder().addComponents(hoursInput),
            new ActionRowBuilder().addComponents(problemInput)
        );

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'hesabatModal') {
        const work = interaction.fields.getTextInputValue('workInput');
        const hours = interaction.fields.getTextInputValue('hoursInput');
        const problem = interaction.fields.getTextInputValue('problemInput') || 'Yoxdur';
        const username = interaction.user.displayName || interaction.user.username;

        await interaction.deferReply({ ephemeral: true });

        try {
            const doc = getGoogleDoc();
            if (!doc) {
                return await interaction.editReply({ content: '❌ Google Sheets bağlantı xətası!' });
            }
            await doc.loadInfo();
            const sheet = doc.sheetsByTitle['Bot_Hesabatları'] || doc.sheetsByIndex[0];

            await sheet.addRow({
                'Tarix': new Date().toLocaleDateString('az-AZ'),
                'Adı': username,
                'İşlənilənlər': work,
                'İşləmə Saatı': hours,
                'Problemlər': problem,
                'Şəkil Linki': 'Şəkil yüklənməyib'
            });

            await interaction.editReply({ 
                content: '✅ Hesabatınız Google Sheets cədvəlinə əlavə olundu!\n📸 Əgər skrinşot/şəkil göndərmək istəyirsinizsə, şəkli birbaşa bota və ya bu kanala atın.' 
            });
        } catch (error) {
            console.error('Google Sheets Xətası:', error);
            await interaction.editReply({ content: '❌ Cədvələ yazılarkən xəta baş verdi.' });
        }
    }
});

app.get('/', (req, res) => res.send('Bot 7/24 Aktifdir!'));

app.listen(PORT, async () => {
    console.log(`🌐 Web server ${PORT} portunda dinlənilir...`);
    
    const token = (process.env.DISCORD_TOKEN || '').trim();
    console.log(`🔑 Token Uzunluğu: ${token.length} simvol`);

    if (!token) {
        console.error('❌ DISCORD_TOKEN TAPILMADI!');
        return;
    }

    // 10 Saniyəlik Timeout Nəzarəti
    const timeout = setTimeout(() => {
        console.error('⚠️ TIMEOUT: Discord Gateway 10 saniyə ərzində cavab vermədi!');
    }, 10000);

    try {
        console.log('🔑 Discord API-yə qoşulunur...');
        await client.login(token);
        clearTimeout(timeout);
        console.log('⚡ Discord API bağlantısı tam quruldu!');
    } catch (err) {
        clearTimeout(timeout);
        console.error('❌ DISCORD LOGIN XƏTASI:', err);
    }
});
