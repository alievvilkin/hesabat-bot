const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, REST, Routes } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ] 
});

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

client.once('ready', async () => {
    console.log(`🤖 Bot ${client.user.tag} adı ilə aktivdir!`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: [{ name: 'hesabat', description: 'Gündəlik iş hesabatı formasını açır' }] }
    );
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
            console.error(error);
            await interaction.editReply({ content: '❌ Cədvələ yazılarkən xəta baş verdi.' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);