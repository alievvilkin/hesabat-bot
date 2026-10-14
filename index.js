const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, REST, Routes } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');
require('dotenv').config();

// Express Server (Render Port Tələbi Üçün)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot 7/24 Aktifdir!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server ${PORT} portunda dinlənilir...`);
});

// Discord Bot Müştərisi
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ] 
});

// Google Private Key Formatı
const privateKey = process.env.GOOGLE_PRIVATE_KEY 
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') 
    : '';

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

client.once('ready', async () => {
    console.log(`🤖 Bot ${client.user.tag} adı ilə aktivdir!`);
    
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [{ name: 'hesabat', description: 'Gündəlik iş hesabatı formasını açır' }] }
        );
        console.log('✅ Slash komandaları (/hesabat) uğurla qeydiyyata alındı!');
    } catch (err) {
        console.error('❌ Slash komandaları qeydiyyata alınarkən xəta baş verdi:', err);
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

// Bot Giriş Xətalarını Tutmaq Üçün
// Bot Giriş Xətalarını Tutmaq Üçün
console.log('🔑 Discord Token Yoxlanılır...');

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ XƏTA: DISCORD_TOKEN tapılmadı! Render Environment Variables bölməsini yoxlayın.');
} else {
    client.login(process.env.DISCORD_TOKEN)
        .then(() => {
            console.log('✅ Discord bağlantısı uğurla quruldu!');
        })
        .catch(err => {
            console.error('❌ DISCORD LOGIN XƏTASI BAŞ VERDİ:');
            console.error(err);
        });
}
