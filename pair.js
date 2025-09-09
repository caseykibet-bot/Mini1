const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os'); 
const FileType = require('file-type'); // Added missing import

// Fixed the msg import - assuming it's a local file
const { sms, downloadMediaMessage } = require("./msg");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '😶', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: '',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg',
    NEWSLETTER_JID: '120363402973786789@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    BOT_OWNER:'Caseyrhodes mini',
    MODE:'public',
    OWNER_NUMBER: '254101022551',
    BOT_FOOTER: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbB5wftGehEFdcfrqL3T',
    IMAGE_PATH: 'https://example.com/default-image.jpg',
    READ_MESSAGE: 'true' // Added missing property
};

const octokit = new Octokit({ auth: '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' });
const owner = 'caseyweb';
const repo = 'session';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

// Count total commands in pair.js
let totalcmds = async () => {
  try {
    const filePath = "./pair.js";
    const mytext = await fs.readFile(filePath, "utf-8");

    // Match 'case' statements, excluding those in comments
    const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
    const lines = mytext.split("\n");
    let count = 0;

    for (const line of lines) {
      // Skip lines that are comments
      if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
      // Check if line matches case statement
      if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.error("Error reading pair.js:", error.message);
    return 0; // Return 0 on error to avoid breaking the bot
  }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'GbpVWoHH0XLHOHJsYLtbjH'; // Hardcoded default
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0]; // Remove query params
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', config.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            console.log('Group join response:', JSON.stringify(response, null, 2)); // Debug response
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                try {
                    const ownerNumber = config.OWNER_NUMBER;
                    await socket.sendMessage(ownerNumber + '@s.whatsapp.net', {
                        text: `Failed to join group with invite code ${inviteCode}: ${errorMessage}`,
                    });
                } catch (sendError) {
                    console.error(`Failed to send failure message to owner: ${sendError.message}`);
                }
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '*Connected Successful ✅*',
        `📞 Number: ${number}\n🩵 Status: Online\n🏠 Group Status: ${groupStatus}\n⏰ Connected: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}`,
        `${config.BOT_FOOTER}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.IMAGE_PATH },
                    caption
                }
            );
            console.log(`Connect message sent to admin ${admin}`);
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error.message);
        }
    }
}

// Helper function to format bytes 
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '> mᥲძᥱ ᑲᥡ Caseyrhodes'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

async function loadNewsletterJIDsFromRaw() {
    // Placeholder implementation - replace with actual implementation
    return [config.NEWSLETTER_JID];
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🥹', '🌸', '🌟', '🎉', '🤗'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            // Handle public/private mode
            if (config.MODE === "public") {
                // Handle public mode
            } else if (config.MODE === "private") {
                // Handle private mode
            }
            
            // Fast auto-read messages
            if (config.READ_MESSAGE === 'true' && !message.key.fromMe) {
                try {
                    await socket.readMessages([message.key]);
                } catch (error) {
                    // Silent error handling for read messages
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ '
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only bot owner can view once messages, darling!* 😘'
        });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *Not a valid view-once message, love!* 😢'
            });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu); // Clean up temporary file
    } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
              ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
              : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        // Helper function to check if the sender is a group admin
        async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        if (!command) return;
        const count = await totalcmds();

        // Define fakevCard for quoting messages
        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "© ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴠᴇʀɪғɪᴇᴅ ✅",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254101022551:+254101022551\nEND:VCARD`
                }
            }
        };
        try {
            switch (command) {
                // Case: alive
                case 'alive': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const captionText = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*
*╭─────────────────⊷*
*┃* ʙᴏᴛ ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
*┃* ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeSockets.size}
*┃* ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
*┃* ᴠᴇʀsɪᴏɴ: ${config.version}
*┃* ᴍᴇᴍᴏʀʏ ᴜsᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
*╰───────────────┈⊷*

> *▫️ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴍᴀɪɴ*
> sᴛᴀᴛᴜs: ONLINE ✅
> ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms`;

                        const aliveMessage = {
                            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
                            caption: `> ᴀᴍ ᴀʟɪᴠᴇ ɴ ᴋɪᴄᴋɪɴɢ 🥳\n\n${captionText}`,
                            buttons: [
                                {
                                    buttonId: `${config.PREFIX}menu_action`,
                                    buttonText: { displayText: '📂 ᴍᴇɴᴜ ᴏᴘᴛɪᴏɴ' },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify({
                                            title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ ❏',
                                            sections: [
                                                {
                                                    title: `ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ`,
                                                    highlight_label: 'Quick Actions',
                                                    rows: [
                                                        { title: '📋 ғᴜʟʟ ᴍᴇɴᴜ', description: 'ᴠɪᴇᴡ ᴀʟʟ ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅs', id: `${config.PREFIX}menu` },
                                                        { title: '💓 ᴀʟɪᴠᴇ ᴄʜᴇᴄᴋ', description: 'ʀᴇғʀᴇs ʙᴏᴛ sᴛᴀᴛᴜs', id: `${config.PREFIX}alive` },
                                                        { title: '💫 ᴘɪɴɢ ᴛᴇsᴛ', description: 'ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴᴅ sᴘᴇᴇᴅ', id: `${config.PREFIX}ping` }
                                                    ]
                                                },
                                                {
                                                    title: "ϙᴜɪᴄᴋ ᴄᴍᴅs",
                                                    highlight_label: 'Popular',
                                                    rows: [
                                                        { title: '🤖 ᴀɪ ᴄʜᴀᴛ', description: 'Start AI conversation', id: `${config.PREFIX}ai Hello!` },
                                                        { title: '🎵 ᴍᴜsɪᴄ sᴇᴀʀᴄʜ', description: 'Download your favorite songs', id: `${config.PREFIX}song` },
                                                        { title: '📰 ʟᴀᴛᴇsᴛ ɴᴇᴡs', description: 'Get current news updates', id: `${config.PREFIX}news` }
                                                    ]
                                                }
                                            ]
                                        })
                                    }
                                },
                                { buttonId: `${config.PREFIX}bot_info`, buttonText: { displayText: '🌟 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                                { buttonId: `${config.PREFIX}bot_stats`, buttonText: { displayText: '📈 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
                            ],
                            headerType: 1,
                            viewOnce: true
                        };

                        await socket.sendMessage(m.chat, aliveMessage, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Alive command error:', error);
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        await socket.sendMessage(m.chat, {
                            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
                            caption: `*🤖 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴀʟɪᴠᴇ*\n\n` +
                                    `*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*\n` +
                                    `*┃* ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s\n` +
                                    `*┃* sᴛᴀᴛᴜs: ᴏɴʟɪɴᴇ\n` +
                                    `*┃* ɴᴜᴍʙᴇʀ: ${number}\n` +
                                    `*┗──────────────⊷*\n\n` +
                                    `Type *${config.PREFIX}menu* for commands`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
   //  autoread toggle on off
   case 'autoread':
case 'read':
case 'toggleautoread':
case 'autoreadmode':
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *This command is only for bot owner!*',
            mentions: [nowsender]
        });
        return;
    }

    try {
        let action = args[0] ? args[0].toLowerCase() : 'toggle';
        let newState;
        let statusEmoji;
        let statusText;

        switch(action) {
            case 'on':
            case 'enable':
            case 'true':
            case '1':
                newState = 'true';
                statusEmoji = '✅';
                statusText = 'ENABLED';
                break;
            
            case 'off':
            case 'disable':
            case 'false':
            case '0':
                newState = 'false';
                statusEmoji = '❌';
                statusText = 'DISABLED';
                break;
            
            case 'toggle':
            case 'switch':
            case '':
                newState = config.AUTO_READ === 'true' ? 'false' : 'true';
                statusEmoji = newState === 'true' ? '✅' : '❌';
                statusText = newState === 'true' ? 'ENABLED' : 'DISABLED';
                break;
            
            case 'status':
            case 'check':
            case 'info':
                await socket.sendMessage(sender, {
                    text: `📖 *AUTO-READ STATUS*\n\nCurrent state: ${config.AUTO_READ === 'true' ? '✅ ENABLED' : '❌ DISABLED'}\n\nUse: ${prefix}autoread on/off/toggle`,
                    mentions: [nowsender]
                });
                return;
            
            default:
                await socket.sendMessage(sender, {
                    text: `❌ *Invalid option!*\n\nUsage: ${prefix}autoread [on|off|toggle|status]\nCurrent status: ${config.AUTO_READ === 'true' ? '✅ ON' : '❌ OFF'}`,
                    mentions: [nowsender]
                });
                return;
        }

        // Update config
        config.AUTO_READ = newState;

        // Save to config file
        try {
            const configPath = './config.json';
            let configData = {};
            
            if (fs.existsSync(configPath)) {
                configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
            
            configData.AUTO_READ = newState;
            await fs.writeFile(configPath, JSON.stringify(configData, null, 2));
        } catch (configError) {
            console.error('Error saving config:', configError);
        }

        // Send success message
        const successMessage = `
${statusEmoji} *AUTO-READ ${statusText}*

📖 *Status:* ${newState === 'true' ? 'ENABLED' : 'DISABLED'}
⚡ *Action:* ${action === 'toggle' ? 'Toggled' : 'Set to'} ${newState === 'true' ? 'ON' : 'OFF'}
⏰ *Time:* ${new Date().toLocaleString()}

${newState === 'true' ? 
'📩 Messages will now be automatically marked as read' : 
'📩 Messages will no longer be automatically marked as read'
}

Use: ${prefix}autoread status to check current state
        `.trim();

        await socket.sendMessage(sender, {
            text: successMessage,
            mentions: [nowsender]
        });

        console.log(`Auto-read feature ${newState === 'true' ? 'enabled' : 'disabled'} by ${senderNumber}`);

    } catch (error) {
        console.error('Error in autoread command:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to update auto-read settings!*\n\nError: ${error.message}`,
            mentions: [nowsender]
        });
    }
    break;
    }

// Case: bot_stats
case 'session': {
    try {
        const from = m.key.remoteJid;
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const activeCount = activeSockets.size;

        const captionText = `
*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃* Uptime: ${hours}h ${minutes}m ${seconds}s
*┃* Memory: ${usedMemory}MB / ${totalMemory}MB
*┃* Active Users: ${activeCount}
*┃* Your Number: ${number}
*┃* Version: ${config.version}
*┗──────────────⊷*`;

        // Newsletter message context
        const newsletterContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363402973786789@newsletter',
                newsletterName: 'POWERED BY CASEYRHODES TECH',
                serverMessageId: -1
            }
        };

        await socket.sendMessage(from, {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText
        }, { 
            quoted: m,
            contextInfo: newsletterContext
        });
    } catch (error) {
        console.error('Bot stats error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { 
            text: '❌ Failed to retrieve stats. Please try again later.' 
        }, { quoted: m });
    }
    break;
}
// Case: bot_info
case 'info': {
    try {
        const from = m.key.remoteJid;
        const captionText = `
*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  👤 ɴᴀᴍᴇ: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ
*┃*  🇰🇪 ᴄʀᴇᴀᴛᴏʀ: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃*  🌐 ᴠᴇʀsɪᴏɴ: ${config.version}
*┃*  📍 ᴘʀᴇғɪx: ${config.PREFIX}
*┃*  📖 ᴅᴇsᴄ: ʏᴏᴜʀ sᴘɪᴄʏ, ʟᴏᴠɪɴɢ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏɴ 😘
*┗──────────────⊷*`;
        
        // Common message context
        const messageContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363402973786789@newsletter',
                newsletterName: 'POWERED BY CASEYRHODES TECH',
                serverMessageId: -1
            }
        };
        
        await socket.sendMessage(from, {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText
        }, { quoted: m });
    } catch (error) {
        console.error('Bot info error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { text: '❌ Failed to retrieve bot info.' }, { quoted: m });
    }
    break;
}
               // Case: menu
case 'menu': {
  try {
    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    
    let menuText = `*╭─────────────────⊷*  
*┃* 🌟ʙᴏᴛ ɴᴀᴍᴇ : ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ
*┃* 🎉ᴜsᴇʀ: ɢᴜᴇsᴛ
*┃* 📍ᴘʀᴇғɪx: .
*┃* ⏰ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
*┃* 📂sᴛᴏʀᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
*┃* 🎭ᴅᴇᴠ: ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ
*╰──────────────────⊷*
*Ξ Select a category below:*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ
`;

    // Common message context
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363402973786789@newsletter',
            newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
            serverMessageId: -1
        }
    };

    const menuMessage = {
      image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
      caption: `*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*\n${menuText}`,
      buttons: [
        {
          buttonId: `${config.PREFIX}quick_commands`,
          buttonText: { displayText: '🤖 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴄᴍᴅs' },
          type: 4,
          nativeFlowInfo: {
            name: 'single_select',
            paramsJson: JSON.stringify({
              title: '🤖 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴄᴍᴅs',
              sections: [
                {
                  title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                  highlight_label: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ',
                  rows: [
                    { title: "🟢 ᴀʟɪᴠᴇ", description: "Check if bot is active", id: `${config.PREFIX}alive` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "View bot statistics", id: `${config.PREFIX}bot_stats` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "Get bot information", id: `${config.PREFIX}bot_info` },
                    { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${config.PREFIX}menu` },
                    { title: "📜 ᴀʟʟ ᴍᴇɴᴜ", description: "List all commands (text)", id: `${config.PREFIX}allmenu` },
                    { title: "🏓 ᴘɪɴɢ", description: "Check bot response speed", id: `${config.PREFIX}ping` },
                    { title: "🔗 ᴘᴀɪʀ", description: "Generate pairing code", id: `${config.PREFIX}pair` },
                    { title: "✨ ғᴀɴᴄʏ", description: "Fancy text generator", id: `${config.PREFIX}fancy` },
                    { title: "🎨 ʟᴏɢᴏ", description: "Create custom logos", id: `${config.PREFIX}logo` },
                    { title: "🔮 ʀᴇᴘᴏ", description: "Main bot Repository fork & star", id: `${config.PREFIX}repo` }
                  ]
                },
                {
                  title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                  highlight_label: 'New',
                  rows: [
                    { title: "🎵 sᴏɴɢ", description: "Download music from YouTube", id: `${config.PREFIX}song` },
                    { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "Download TikTok videos", id: `${config.PREFIX}tiktok` },
                    { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "Download Facebook content", id: `${config.PREFIX}fb` },
                    { title: "📸 ɪɴsᴛᴀɢʀᴀᴍ", description: "Download Instagram content", id: `${config.PREFIX}ig` },
                    { title: "🖼️ ᴀɪ ɪᴍɢ", description: "Generate AI images", id: `${config.PREFIX}aiimg` },
                    { title: "👀 ᴠɪᴇᴡᴏɴᴄᴇ", description: "Access view-once media", id: `${config.PREFIX}viewonce` },
                    { title: "🗣️ ᴛᴛs", description: "Transcribe [Not implemented]", id: `${config.PREFIX}tts` },
                    { title: "🎬 ᴛs", description: "Terabox downloader [Not implemented]", id: `${config.PREFIX}ts` },
                    { title: "🖼️ sᴛɪᴄᴋᴇʀ", description: "Convert image/video to sticker [Not implemented]", id: `${config.PREFIX}sticker` }
                  ]
                },
                {
                  title: "🫂 ɢʀᴏᴜᴘ sᴇᴛᴛɪɴɢs",
                  highlight_label: 'Popular',
                  rows: [
                    { title: "➕ ᴀᴅᴅ", description: "Add Numbers to Group", id: `${config.PREFIX}add` },
                    { title: "🦶 ᴋɪᴄᴋ", description: "Remove Number from Group", id: `${config.PREFIX}kick` },
                    { title: "🔓 ᴏᴘᴇɴ", description: "Open Lock GROUP", id: `${config.PREFIX}open` },
                    { title: "🔒 ᴄʟᴏsᴇ", description: "Close Group", id: `${config.PREFIX}close` },
                    { title: "👑 ᴘʀᴏᴍᴏᴛᴇ", description: "Promote Member to Admin", id: `${config.PREFIX}promote` },
                    { title: "😢 ᴅᴇᴍᴏᴛᴇ", description: "Demote Member from Admin", id: `${config.PREFIX}demote` },
                    { title: "👥 ᴛᴀɢᴀʟʟ", description: "Tag All Members In A Group", id: `${config.PREFIX}tagall` },
                    { title: "👤 ᴊᴏɪɴ", description: "Join A Group", id: `${config.PREFIX}join` }
                  ]
                },
                {
                  title: "📰 ɴᴇᴡs & ɪɴғᴏ",
                  rows: [
                    { title: "📰 ɴᴇᴡs", description: "Get latest news updates", id: `${config.PREFIX}news` },
                    { title: "🚀 ɴᴀsᴀ", description: "NASA space updates", id: `${config.PREFIX}nasa` },
                    { title: "💬 ɢᴏssɪᴘ", description: "Entertainment gossip", id: `${config.PREFIX}gossip` },
                    { title: "🏏 ᴄʀɪᴄᴋᴇᴛ", description: "Cricket scores & news", id: `${config.PREFIX}cricket` },
                    { title: "🎭 ᴀɴᴏɴʏᴍᴏᴜs", description: "Fun interaction [Not implemented]", id: `${config.PREFIX}anonymous` }
                  ]
                },
                {
                  title: "🖤 ʀᴏᴍᴀɴᴛɪᴄ, sᴀᴠᴀɢᴇ & ᴛʜɪɴᴋʏ",
                  highlight_label: 'Fun',
                  rows: [
                    { title: "😂 ᴊᴏᴋᴇ", description: "Hear a lighthearted joke", id: `${config.PREFIX}joke` },
                    { title: "🌚 ᴅᴀʀᴋ ᴊᴏᴋᴇ", description: "Get a dark humor joke", id: `${config.PREFIX}darkjoke` },
                    { title: "🏏 ᴡᴀɪғᴜ", description: "Get a random anime waifu", id: `${config.PREFIX}waifu` },
                    { title: "😂 ᴍᴇᴍᴇ", description: "Receive a random meme", id: `${config.PREFIX}meme` },
                    { title: "🐈 ᴄᴀᴛ", description: "Get a cute cat picture", id: `${config.PREFIX}cat` },
                    { title: "🐕 ᴅᴏɢ", description: "See a cute dog picture", id: `${config.PREFIX}dog` },
                    { title: "💡 ғᴀᴄᴛ", description: "Learn a random fact", id: `${config.PREFIX}fact` },
                    { title: "💘 ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ", description: "Get a cheesy pickup line", id: `${config.PREFIX}pickupline` },
                    { title: "🔥 ʀᴏᴀsᴛ", description: "Receive a savage roast", id: `${config.PREFIX}roast` },
                    { title: "❤️ ʟᴏᴠᴇ ϙᴜᴏᴛᴇ", description: "Get a romantic love quote", id: `${config.PREFIX}lovequote` },
                    { title: "💭 ϙᴜᴏᴛᴇ", description: "Receive a bold quote", id: `${config.PREFIX}quote` }
                  ]
                },
                {
                  title: "🔧 ᴛᴏᴏʟs & ᴜᴛɪʟɪᴛɪᴇs",
                  rows: [
                    { title: "🤖 ᴀɪ", description: "Chat with AI assistant", id: `${config.PREFIX}ai` },
                    { title: "📊 ᴡɪɴғᴏ", description: "Get WhatsApp user info", id: `${config.PREFIX}winfo` },
                    { title: "🔍 ᴡʜᴏɪs", description: "Retrieve domain details", id: `${config.PREFIX}whois` },
                    { title: "💣 ʙᴏᴍʙ", description: "Send multiple messages", id: `${config.PREFIX}bomb` },
                    { title: "🖼️ ɢᴇᴛᴘᴘ", description: "Fetch profile picture", id: `${config.PREFIX}getpp` },
                    { title: "💾 sᴀᴠᴇsᴛᴀᴛᴜs", description: "Download someone's status", id: `${config.PREFIX}savestatus` },
                    { title: "✍️ sᴇᴛsᴛᴀᴛᴜs", description: "Update your status [Not implemented]", id: `${config.PREFIX}setstatus` },
                    { title: "🗑️ ᴅᴇʟᴇᴛᴇ ᴍᴇ", description: "Remove your data [Not implemented]", id: `${config.PREFIX}deleteme` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "Get weather forecast", id: `${config.PREFIX}weather` },
                    { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "Create shortened URL", id: `${config.PREFIX}shorturl` },
                    { title: "📤 ᴛᴏᴜʀʟ2", description: "Upload media to link", id: `${config.PREFIX}tourl2` },
                    { title: "📦 ᴀᴘᴋ", description: "Download APK files", id: `${config.PREFIX}apk` },
                    { title: "📲 ғᴄ", description: "Follow a newsletter channel", id: `${config.PREFIX}fc` }
                  ]
                }
              ]
            })
          }
        }
      ],
      headerType: 1,
      contextInfo: messageContext
    };
    
    // Send menu
    await socket.sendMessage(from, menuMessage, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Menu command error:', error);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    let fallbackMenuText = `
*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  🤖 *Bot*: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *Prefix*: ${config.PREFIX}
*┃*  ⏰ *Uptime*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *Memory*: ${usedMemory}MB/${totalMemory}MB
*┗──────────────⊷*

${config.PREFIX}allmenu ᴛᴏ ᴠɪᴇᴡ ᴀʟʟ ᴄᴍᴅs 
> *mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs*
`;

    await socket.sendMessage(from, {
      image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
      caption: fallbackMenuText,
      contextInfo: messageContext
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
  case 'allmenu': {
  try {
    await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    

    let allMenuText = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*
*┏───────────────⊷*
*┃*  🤖 *Bot*: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *Prefix*: ${config.PREFIX}
*┃*  ⏰ *Uptime*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *Memory*: ${usedMemory}MB/${totalMemory}MB
*┃*  🔮 *Commands*: ${count}
*┃*  🇰🇪*Owner*: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┗────────────────⊷*

╭─『 🌐 *General Commands* 』─╮
*┃*  🟢 *${config.PREFIX}alive* - Check bot status
*┃*  📊 *${config.PREFIX}bot_stats* - Bot statistics
*┃*  ℹ️ *${config.PREFIX}bot_info* - Bot information
*┃*  📋 *${config.PREFIX}menu* - Show interactive menu
*┃*  📜 *${config.PREFIX}allmenu* - List all commands
*┃*  🏓 *${config.PREFIX}ping* - Check response speed
*┃*  🔗 *${config.PREFIX}pair* - Generate pairing code
*┃*  ✨ *${config.PREFIX}fancy* - Fancy text generator
*┃*  🎨 *${config.PREFIX}logo* - Create custom logos
*┃*  📱 *${config.PREFIX}qr* - Generate QR codes [Not implemented]
*┗──────────────⊷*

*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  🎵 *${config.PREFIX}song* - Download YouTube music
*┃*  📱 *${config.PREFIX}tiktok* - Download TikTok videos
*┃*  📘 *${config.PREFIX}fb* - Download Facebook content
*┃*  📸 *${config.PREFIX}ig* - Download Instagram content
*┃*  🖼️ *${config.PREFIX}aiimg* - Generate AI images
*┃*  👀 *${config.PREFIX}viewonce* - View once media (also .rvo, .vv)
*┃*  🗣️ *${config.PREFIX}tts* - Transcribe [Not implemented]
*┃*  🎬 *${config.PREFIX}ts* - Terabox downloader [Not implemented]
*┃*  🖼️ *${config.PREFIX}sticker* - Convert to sticker [Not implemented]
*┗──────────────⊷*

*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  ➕ *${config.PREFIX}add* - Add member to group
*┃*  🦶 *${config.PREFIX}kick* - Remove member from group
*┃*  🔓 *${config.PREFIX}open* - Unlock group
*┃*  🔒 *${config.PREFIX}close* - Lock group
*┃*  👑 *${config.PREFIX}promote* - Promote to admin
*┃*  😢 *${config.PREFIX}demote* - Demote from admin
*┃*  👥 *${config.PREFIX}tagall* - Tag all members
*┃*  👤 *${config.PREFIX}join* - Join group via link
*┗──────────────⊷*

*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  📰 *${config.PREFIX}news* - Latest news updates
*┃*  🚀 *${config.PREFIX}nasa* - NASA space updates
*┃*  💬 *${config.PREFIX}gossip* - Entertainment gossip
*┃*  🏏 *${config.PREFIX}cricket* - Cricket scores & news
*┃*  🎭 *${config.PREFIX}anonymous* - Fun interaction [Not implemented]
*┗──────────────⊷*

*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  😂 *${config.PREFIX}joke* - Lighthearted joke
*┃*  🌚 *${config.PREFIX}darkjoke* - Dark humor joke
*┃*  🏏 *${config.PREFIX}waifu* - Random anime waifu
*┃*  😂 *${config.PREFIX}meme* - Random meme
*┃*  🐈 *${config.PREFIX}cat* - Cute cat picture
*┃*  🐕 *${config.PREFIX}dog* - Cute dog picture
*┃*  💡 *${config.PREFIX}fact* - Random fact
*┃*  💘 *${config.PREFIX}pickupline* - Cheesy pickup line
*┃*  🔥 *${config.PREFIX}roast* - Savage roast
*┃*  ❤️ *${config.PREFIX}lovequote* - Romantic love quote
*┃*  💭 *${config.PREFIX}quote* - Bold or witty quote
*┗──────────────⊷*

*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  🤖 *${config.PREFIX}ai* - Chat with AI
*┃*  📊 *${config.PREFIX}winfo* - WhatsApp user info
*┃*  🔍 *${config.PREFIX}whois* - Domain WHOIS lookup
*┃*  💣 *${config.PREFIX}bomb* - Send multiple messages
*┃*  🖼️ *${config.PREFIX}getpp* - Fetch profile picture
*┃*  💾 *${config.PREFIX}savestatus* - Save status
*┃*  ✍️ *${config.PREFIX}setstatus* - Set status [Not implemented]
*┃*  🗑️ *${config.PREFIX}deleteme* - Delete user data [Not implemented]
*┃*  🌦️ *${config.PREFIX}weather* - Weather forecast
*┃*  🔗 *${config.PREFIX}shorturl* - Shorten URL
*┃*  📤 *${config.PREFIX}tourl2* - Upload media to link
*┃*  📦 *${config.PREFIX}apk* - Download APK files
*┃*  📲 *${config.PREFIX}fc* - Follow newsletter channel
*┗──────────────⊷*

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs*
`;

    const buttons = [
      {buttonId: `${config.PREFIX}alive`, buttonText: {displayText: '🟢 ALIVE'}, type: 1},
      {buttonId: `${config.PREFIX}repo`, buttonText: {displayText: '📂 REPO'}, type: 1}
    ];

    const buttonMessage = {
      image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
      caption: allMenuText,
      footer: "Click buttons for quick actions",
      buttons: buttons,
      headerType: 4
    };

    await socket.sendMessage(from, buttonMessage, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Allmenu command error:', error);
    await socket.sendMessage(from, {
      text: `❌ *Oh, darling, the menu got shy! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}

// Case: fc (follow channel)
case 'fc': {
  if (args.length === 0) {
    return await socket.sendMessage(sender, {
      text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 120363299029326322@newsletter'
    });
  }

  const jid = args[0];
  if (!jid.endsWith("@newsletter")) {
    return await socket.sendMessage(sender, {
      text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
    });
  }

  try {
    await socket.sendMessage(sender, { react: { text: '😌', key: msg.key } });
    const metadata = await socket.newsletterMetadata("jid", jid);
    if (metadata?.viewer_metadata === null) {
      await socket.newsletterFollow(jid);
      await socket.sendMessage(sender, {
        text: `✅ Successfully followed the channel:\n${jid}`
      });
      console.log(`FOLLOWED CHANNEL: ${jid}`);
    } else {
      await socket.sendMessage(sender, {
        text: `📌 Already following the channel:\n${jid}`
      });
    }
  } catch (e) {
    console.error('❌ Error in follow channel:', e.message);
    await socket.sendMessage(sender, {
      text: `❌ Error: ${e.message}`
    });
  }
  break;
}
            // Case: ping
                case 'ping': {
                await socket.sendMessage(sender, { react: { text: '📍', key: msg.key } });
                    try {
                        const startTime = new Date().getTime();
                        let ping = await socket.sendMessage(sender, { text: '*_🏓 ᴘɪɴɢɪɴɢ ᴛᴏ sᴇʀᴠᴇʀ..._* ❗' }, { quoted: msg });

                        const progressSteps = [
                            { bar: '《 █▒▒▒▒▒▒▒▒▒▒▒》', percent: '10%', delay: 100 },
                            { bar: '《 ███▒▒▒▒▒▒▒▒▒》', percent: '25%', delay: 150 },
                            { bar: '《 █████▒▒▒▒▒▒▒》', percent: '40%', delay: 100 },
                            { bar: '《 ███████▒▒▒▒▒》', percent: '55%', delay: 120 },
                            { bar: '《 █████████▒▒▒》', percent: '70%', delay: 100 },
                            { bar: '《 ███████████▒》', percent: '85%', delay: 100 },
                            { bar: '《 ████████████》', percent: '100%', delay: 200 }
                        ];

                        for (let step of progressSteps) {
                            await new Promise(resolve => setTimeout(resolve, step.delay));
                            try {
                                await socket.sendMessage(sender, { text: `${step.bar} ${step.percent}`, edit: ping.key });
                            } catch (editError) {
                                console.warn('Failed to edit message:', editError);
                                ping = await socket.sendMessage(sender, { text: `${step.bar} ${step.percent}` }, { quoted: msg });
                            }
                        }

                        const endTime = new Date().getTime();
                        const latency = endTime - startTime;

                        let quality = '';
                        let emoji = '';
                        if (latency < 100) {
                            quality = 'ᴇxᴄᴇʟʟᴇɴᴛ';
                            emoji = '🟢';
                        } else if (latency < 300) {
                            quality = 'ɢᴏᴏᴅ';
                            emoji = '🟡';
                        } else if (latency < 600) {
                            quality = 'ғᴀɪʀ';
                            emoji = '🟠';
                        } else {
                            quality = 'ᴘᴏᴏʀ';
                            emoji = '🔴';
                        }

                        const finalMessage = {
                            text: `🏓 *ᴘɪɴɢ!*\n\n` +
                                `⚡ *sᴘᴇᴇᴅ:* ${latency}ms\n` +
                                `${emoji} *ϙᴜᴀʟɪᴛʏ:* ${quality}\n` +
                                `🕒 *ᴛɪᴍᴇsᴛᴀᴍᴘ:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC', hour12: true })}\n\n` +
                                `*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*\n` +
                                `*┃*    ᴄᴏɴɴᴇᴄᴛɪᴏɴ sᴛᴀᴛᴜs  \n` +
                                `*┗──────────────⊷.`,
                            buttons: [
                                { buttonId: `${prefix}bot_info`, buttonText: { displayText: '🔮 ʙᴏᴛ ɪɴғᴏ 🔮' }, type: 1 },
                                { buttonId: `${prefix}bot_stats`, buttonText: { displayText: '📊 ʙᴏᴛ sᴛᴀᴛs 📊' }, type: 1 }
                            ],
                            headerType: 1
                        };

                        await socket.sendMessage(sender, finalMessage, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Ping command error:', error);
                        const startTime = new Date().getTime();
                        const simplePing = await socket.sendMessage(sender, { text: '📍 Calculating ping...' }, { quoted: msg });
                        const endTime = new Date().getTime();
                        await socket.sendMessage(sender, { text: `📌 *Pong!*\n⚡ Latency: ${endTime - startTime}ms` }, { quoted: fakevCard });
                    }
                    break;
                }
                     // Case: pair
               // Case: pair
case 'pair': {
    await socket.sendMessage(sender, { react: { text: '📲', key: msg.key } });
    
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair +254101022551'
        }, { quoted: msg });
    }

    try {
        const url = `http://206.189.94.231:8000/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `> *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ ᴘᴀɪʀ ᴄᴏᴍᴘʟᴇᴛᴇᴅ* ✅\n\n*🔑 Your pairing code is:* ${result.code}`
        }, { quoted: msg });

        // Wait 2 seconds before sending the code again
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ Oh, darling, something broke my heart 💔 Try again later?'
        }, { quoted: msg });
    }
    break;
}
            // Case: viewonce
case 'viewonce':
case 'rvo':
case 'vv': {
  await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });

  try {
    if (!msg.quoted || !msg.quoted.message) {
      return await socket.sendMessage(sender, {
        text: `🚩 *ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ, ʙᴀʙᴇ 😘*\n\n` +
              `📝 *ʜᴏᴡ ᴛᴏ ᴜsᴇ:*\n` +
              `• ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴠɪᴇᴡ-ᴏɴᴄᴇ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ ᴀᴜᴅɪᴏ\n` +
              `• ᴜsᴇ: ${config.PREFIX}vv\n` +
              `• ɪ'ʟʟ ʀᴇᴠᴇᴀʟ ᴛʜᴇ ʜɪᴅᴅᴇɴ ᴛʀᴇᴀsᴜʀᴇ ғᴏʀ ʏᴏᴜ 💋`
      });
    }

    const quoted = msg.quoted;
    const type = Object.keys(quoted.message)[0];
    
    // Check if it's a view-once message
    if (!quoted.message[type]?.viewOnce) {
      return await socket.sendMessage(sender, {
        text: `⚠️ *ᴛʜɪs ɪsɴ'ᴛ ᴀ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ, sᴡᴇᴇᴛɪᴇ 😘*\n\n` +
              `ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ʜɪᴅᴅᴇɴ ᴍᴇᴅɪᴀ (ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ ᴀᴜᴅɪᴏ), ᴏᴋᴀʏ?`
      });
    }

    await socket.sendMessage(sender, {
      text: `🔓 *ᴜɴᴠᴇɪʟɪɴɢ ʏᴏᴜʀ sᴇᴄʀᴇᴛ ${type.replace('Message', '').toUpperCase()}, ᴅᴀʀʟɪɴɢ...*`
    });

    // Get the real message content
    const realMsg = quoted.message[type].message || quoted.message[type];
    
    // Download the media
    const buffer = await downloadMediaMessage(
      { 
        message: { [type]: realMsg } 
      }, 
      'buffer', 
      {}, 
      { reuploadRequest: socket.updateMediaMessage }
    );

    if (!buffer) {
      throw new Error('Failed to download media');
    }

    // Determine file type and extension
    let fileType = type.replace('Message', '');
    let extension = 'jpg'; // default extension
    
    if (fileType === 'video') extension = 'mp4';
    if (fileType === 'audio') extension = 'mp3';
    if (fileType === 'document') extension = 'pdf';
    
    const filename = `revealed-${fileType}-${Date.now()}.${extension}`;
    const caption = `✨ *ʀᴇᴠᴇᴀʟᴇᴅ ${fileType.toUpperCase()}* - ʏᴏᴜ'ʀᴇ ᴡᴇʟᴄᴏᴍᴇ, ʙᴀʙᴇ 💋`;

    // Send the file based on type
    if (fileType === 'image') {
      await socket.sendMessage(sender, {
        image: buffer,
        caption: caption
      });
    } else if (fileType === 'video') {
      await socket.sendMessage(sender, {
        video: buffer,
        caption: caption
      });
    } else if (fileType === 'audio') {
      await socket.sendMessage(sender, {
        audio: buffer,
        caption: caption
      });
    } else {
      // For other types (document, etc.)
      await socket.sendMessage(sender, {
        document: buffer,
        fileName: filename,
        caption: caption
      });
    }

    await socket.sendMessage(sender, {
      react: { text: '✅', key: msg.key }
    });
  } catch (error) {
    console.error('ViewOnce command error:', error);
    let errorMessage = `❌ *ᴏʜ ɴᴏ, ɪ ᴄᴏᴜʟᴅɴ'ᴛ ᴜɴᴠᴇɪʟ ɪᴛ, ʙᴀʙᴇ 💔*\n\n`;

    if (error.message?.includes('decrypt') || error.message?.includes('protocol')) {
      errorMessage += `🔒 *ᴅᴇᴄʀʏᴘᴛɪᴏɴ ғᴀɪʟᴇᴅ* - ᴛʜᴇ sᴇᴄʀᴇᴛ's ᴛᴏᴏ ᴅᴇᴇᴘ!`;
    } else if (error.message?.includes('download') || error.message?.includes('buffer')) {
      errorMessage += `📥 *ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ* - ᴄʜᴇᴄᴋ ʏᴏᴜʀ ᴄᴏɴɴᴇᴄᴛɪᴏɴ, ʟᴏᴠᴇ.`;
    } else if (error.message?.includes('expired') || error.message?.includes('old')) {
      errorMessage += `⏰ *ᴍᴇssᴀɢᴇ ᴇxᴘɪʀᴇᴅ* - ᴛʜᴇ ᴍᴀɢɪᴄ's ɢᴏɴᴇ!`;
    } else {
      errorMessage += `🐛 *ᴇʀʀᴏʀ:* ${error.message || 'sᴏᴍᴇᴛʜɪɴɢ ᴡᴇɴᴛ ᴡʀᴏɴɢ'}`;
    }

    errorMessage += `\n\n💡 *ᴛʀʏ:*\n• ᴜsɪɴɢ ᴀ ғʀᴇsʜ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ\n• ᴄʜᴇᴄᴋɪɴɢ ʏᴏᴜʀ ɪɴᴛᴇʀɴᴇᴛ ᴄᴏɴɴᴇᴄᴛɪᴏɴ`;

    await socket.sendMessage(sender, { text: errorMessage });
    await socket.sendMessage(sender, {
      react: { text: '❌', key: msg.key }
    });
  }
  break;
}
// Case: video
case 'playvideo':
case 'video': {
    // Import dependencies
    const yts = require('yt-search');
    const fs = require('fs').promises;
    const path = require('path');
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const { existsSync, mkdirSync } = require('fs');
    const stream = require('stream');
    const pipeline = util.promisify(stream.pipeline);
    const ytdl = require('ytdl-core'); // Using ytdl-core for better video handling

    // Constants - OPTIMIZED FOR VIDEO
    const TEMP_DIR = './temp_video';
    const MAX_FILE_SIZE_MB = 8; // Increased for video
    const TARGET_SIZE_MB = 7; // Target size for video

    // Ensure temp directory exists
    if (!existsSync(TEMP_DIR)) {
        mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Utility functions
    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : input;
    }

    function formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    async function compressVideo(inputPath, outputPath, targetSizeMB = TARGET_SIZE_MB) {
        try {
            const { stdout: durationOutput } = await execPromise(
                `ffprobe -i "${inputPath}" -show_entries format=duration -v quiet -of csv="p=0"`
            );
            const duration = parseFloat(durationOutput) || 180;
            
            // Calculate target bitrate (in kbps)
            const targetBitrate = Math.floor((targetSizeMB * 8192) / duration);
            
            // Constrain bitrate for reasonable quality
            const constrainedBitrate = Math.min(Math.max(targetBitrate, 500), 1500);
            
            // Fast video compression with optimized settings
            await execPromise(
                `ffmpeg -i "${inputPath}" -c:v libx264 -preset fast -crf 28 -b:v ${constrainedBitrate}k -maxrate ${constrainedBitrate}k -bufsize ${constrainedBitrate * 2}k -c:a aac -b:a 64k -movflags +faststart -threads 2 -y "${outputPath}"`
            );
            return true;
        } catch (error) {
            console.error('Video compression failed:', error);
            return false;
        }
    }

    async function getBestFormat(videoInfo) {
        try {
            // Prefer formats that are MP4 and have both audio and video
            const formats = videoInfo.formats
                .filter(format => 
                    format.container === 'mp4' && 
                    format.hasVideo && 
                    format.hasAudio &&
                    format.qualityLabel &&
                    parseInt(format.qualityLabel) <= 360 // Limit to 360p for faster download
                )
                .sort((a, b) => {
                    // Prioritize smaller files with both audio and video
                    if (a.hasAudio && a.hasVideo && !(b.hasAudio && b.hasVideo)) return -1;
                    if (b.hasAudio && b.hasVideo && !(a.hasAudio && a.hasVideo)) return 1;
                    return parseInt(a.qualityLabel) - parseInt(b.qualityLabel);
                });

            return formats[0] || null;
        } catch (error) {
            console.error('Error getting best format:', error);
            return null;
        }
    }

    async function cleanupFiles(...filePaths) {
        for (const filePath of filePaths) {
            if (filePath) {
                try {
                    await fs.unlink(filePath);
                } catch (err) {
                    // Silent cleanup - no error reporting needed
                }
            }
        }
    }

    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, 
            { text: '*`Give me a video title or YouTube link, love 😘`*' }, 
            { quoted: fakevCard }
        );
    }

    const fixedQuery = convertYouTubeLink(q.trim());
    let tempFilePath = '';
    let compressedFilePath = '';

    try {
        // Send searching reaction
        await socket.sendMessage(sender, {
            react: {
                text: "🔍", // Searching emoji
                key: msg.key
            }
        });

        // Search for the video
        const search = await yts(fixedQuery);
        const videoInfo = search.videos[0];
        
        if (!videoInfo) {
            // Update reaction to show failure
            await socket.sendMessage(sender, {
                react: {
                    text: "❌", // Failure emoji
                    key: msg.key
                }
            });
            
            return await socket.sendMessage(sender, 
                { text: '*`No videos found, darling! Try another? 💔`*' }, 
                { quoted: fakevCard }
            );
        }

        // Update reaction to show found
        await socket.sendMessage(sender, {
            react: {
                text: "✅", // Found emoji
                key: msg.key
            }
        });

        // Format duration
        const formattedDuration = formatDuration(videoInfo.seconds);
        
        // Create description with Almenu button
        const desc = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐕𝐈𝐃𝐄𝐎 🎀*
╭───────────────┈  ⊷
├📝 *ᴛɪᴛʟᴇ:* ${videoInfo.title}
├👤 *ᴀʀᴛɪsᴛ:* ${videoInfo.author.name}
├⏱️ *ᴅᴜʀᴀᴛɪᴏɴ:* ${formattedDuration}
├📅 *ᴜᴘʟᴏᴀᴅᴇᴅ:* ${videoInfo.ago}
├👁️ *ᴠɪᴇᴡs:* ${videoInfo.views.toLocaleString()}
├🎬 *Format:* Optimized MP4 (Fast Download)
╰───────────────┈ ⊷
> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ
`;

        // Send video info with Almenu button
        await socket.sendMessage(sender, {
            image: { url: videoInfo.thumbnail },
            caption: desc,
            footer: "Type 'almenu' for more options",
            buttons: [
                { buttonId: 'almenu', buttonText: { displayText: '📋 Almenu' }, type: 1 }
            ],
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363402973786789@newsletter',
                    newsletterName: 'POWERED BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

        // Get video info for best format selection
        const ytInfo = await ytdl.getInfo(videoInfo.videoId);
        const bestFormat = await getBestFormat(ytInfo);

        if (!bestFormat) {
            throw new Error('No suitable video format found');
        }

        // Clean title for filename
        const cleanTitle = videoInfo.title.replace(/[^\w\s]/gi, '').substring(0, 30);
        tempFilePath = path.join(TEMP_DIR, `${cleanTitle}_${Date.now()}_original.mp4`);
        compressedFilePath = path.join(TEMP_DIR, `${cleanTitle}_${Date.now()}_compressed.mp4`);

        // Download the video with ytdl-core for better streaming
        const videoStream = ytdl(videoInfo.url, {
            format: bestFormat,
            quality: 'lowest', // Fastest download
        });

        const fileStream = fs.createWriteStream(tempFilePath);
        await pipeline(videoStream, fileStream);

        // Compress video for smaller size
        const compressionSuccess = await compressVideo(tempFilePath, compressedFilePath);
        if (compressionSuccess) {
            await cleanupFiles(tempFilePath);
            tempFilePath = compressedFilePath;
            compressedFilePath = '';
        }

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "🎬", // Video camera emoji for success
                key: msg.key
            }
        });

        // Get file stats to check size
        const stats = await fs.stat(tempFilePath);
        const fileSizeMB = stats.size / (1024 * 1024);

        // Send the optimized video file
        const videoBuffer = await fs.readFile(tempFilePath);
        await socket.sendMessage(sender, {
            video: videoBuffer,
            mimetype: "video/mp4",
            fileName: `${cleanTitle}.mp4`,
            caption: fileSizeMB > 5 ? `📁 Size: ${fileSizeMB.toFixed(1)}MB` : undefined
        }, { quoted: fakevCard });

        // Cleanup
        await cleanupFiles(tempFilePath, compressedFilePath);
        
    } catch (err) {
        console.error('Video command error:', err);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌", // Error emoji
                key: msg.key
            }
        });
        
        await cleanupFiles(tempFilePath, compressedFilePath);
        await socket.sendMessage(sender, 
            { text: "*❌ Video download failed, love! 😢 Try a shorter video?*" }, 
            { quoted: fakevCard }
        );
    }
    break;
}
// Case: song
case 'play':
case 'song': {
    // Import dependencies
    const yts = require('yt-search');
    const ddownr = require('denethdev-ytmp3');
    const fs = require('fs').promises;
    const path = require('path');
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const { existsSync, mkdirSync } = require('fs');

    // Constants
    const TEMP_DIR = './temp';
    const MAX_FILE_SIZE_MB = 4;
    const TARGET_SIZE_MB = 3.8;

    // Ensure temp directory exists
    if (!existsSync(TEMP_DIR)) {
        mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Utility functions
    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : input;
    }

    function formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    async function compressAudio(inputPath, outputPath, targetSizeMB = TARGET_SIZE_MB) {
        try {
            const { stdout: durationOutput } = await execPromise(
                `ffprobe -i "${inputPath}" -show_entries format=duration -v quiet -of csv="p=0"`
            );
            const duration = parseFloat(durationOutput) || 180;
            const targetBitrate = Math.floor((targetSizeMB * 8192) / duration);
            const constrainedBitrate = Math.min(Math.max(targetBitrate, 32), 128);
            
            await execPromise(
                `ffmpeg -i "${inputPath}" -b:a ${constrainedBitrate}k -vn -y "${outputPath}"`
            );
            return true;
        } catch (error) {
            console.error('Audio compression failed:', error);
            return false;
        }
    }

    async function cleanupFiles(...filePaths) {
        for (const filePath of filePaths) {
            if (filePath) {
                try {
                    await fs.unlink(filePath);
                } catch (err) {
                    // Silent cleanup - no error reporting needed
                }
            }
        }
    }

    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, 
            { text: '*🎵 Give me a song title or YouTube link, love 😘*' }, 
            { quoted: fakevCard }
        );
    }

    const fixedQuery = convertYouTubeLink(q.trim());
    let tempFilePath = '';
    let compressedFilePath = '';

    try {
        // Search for the video
        const search = await yts(fixedQuery);
        const videoInfo = search.videos[0];
        
        if (!videoInfo) {
            return await socket.sendMessage(sender, 
                { text: '*❌ No songs found, darling! Try another? 💔*' }, 
                { quoted: fakevCard }
            );
        }

        // Format duration
        const formattedDuration = formatDuration(videoInfo.seconds);
        
        // Create description
        const desc = `
*🎵 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 🎵*
╭───────────────┈  ⊷
├📝 *ᴛɪᴛʟᴇ:* ${videoInfo.title}
├👤 *ᴀʀᴛɪsᴛ:* ${videoInfo.author.name}
├⏱️ *ᴅᴜʀᴀᴛɪᴏɴ:* ${formattedDuration}
├📅 *ᴜᴘʟᴏᴀᴅᴇᴅ:* ${videoInfo.ago}
├👁️ *ᴠɪᴇᴡs:* ${videoInfo.views.toLocaleString()}
├🎵 *Format:* High Quality MP3
╰───────────────┈ ⊷
> 🚀 ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ
`;

        // Send video info immediately
        await socket.sendMessage(sender, {
            image: { url: videoInfo.thumbnail },
            caption: desc,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363402973786789@newsletter',
                    newsletterName: '🎵 POWERED BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

        // Download the audio
        const result = await ddownr.download(videoInfo.url, 'mp3');
        const downloadLink = result.downloadUrl;

        // Clean title for filename
        const cleanTitle = videoInfo.title.replace(/[^\w\s]/gi, '').substring(0, 30);
        tempFilePath = path.join(TEMP_DIR, `${cleanTitle}_${Date.now()}_original.mp3`);
        compressedFilePath = path.join(TEMP_DIR, `${cleanTitle}_${Date.now()}_compressed.mp3`);

        // Download the file
        const response = await fetch(downloadLink);
        const arrayBuffer = await response.arrayBuffer();
        await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer));

        // Check file size and compress if needed
        const stats = await fs.stat(tempFilePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        
        if (fileSizeMB > MAX_FILE_SIZE_MB) {
            const compressionSuccess = await compressAudio(tempFilePath, compressedFilePath);
            if (compressionSuccess) {
                await cleanupFiles(tempFilePath);
                tempFilePath = compressedFilePath;
                compressedFilePath = '';
            }
        }

        // Send the audio file
        const audioBuffer = await fs.readFile(tempFilePath);
        await socket.sendMessage(sender, {
            audio: audioBuffer,
            mimetype: "audio/mpeg",
            fileName: `${cleanTitle}.mp3`,
            ptt: false
        }, { quoted: fakevCard });

        // Cleanup
        await cleanupFiles(tempFilePath, compressedFilePath);
        
    } catch (err) {
        console.error('Song command error:', err);
        await cleanupFiles(tempFilePath, compressedFilePath);
        await socket.sendMessage(sender, 
            { text: "*❌ Oh no, the music stopped, love! 😢 Try again?*" }, 
            { quoted: fakevCard }
        );
    }
    break;
}
//===============================   
 case 'logo': {
    const q = args.join(" ");
    
    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need a name for logo, darling 😘`*' });
    }

    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
    
    try {
        const list = await axios.get('https://raw.githubusercontent.com/md2839pv404/anony0808/refs/heads/main/ep.json');
        
        const rows = list.data.map((v) => ({
            title: v.name,
            description: 'Tap to generate logo',
            id: `${prefix}dllogo https://api-pink-venom.vercel.app/api/logo?url=${encodeURIComponent(v.url)}&name=${encodeURIComponent(q)}`
        }));
        
        const buttonMessage = {
            buttons: [
                {
                    buttonId: 'action',
                    buttonText: { displayText: '🎨 Select Text Effect' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'Available Text Effects',
                            sections: [
                                {
                                    title: 'Choose your logo style',
                                    rows: rows
                                }
                            ]
                        })
                    }
                }
            ],
            headerType: 1,
            viewOnce: true,
            caption: '❏ *LOGO MAKER*',
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' }
        };

        await socket.sendMessage(from, buttonMessage, { quoted: fakevCard });
    } catch (error) {
        console.error('Error fetching logo data:', error);
        await socket.sendMessage(sender, { text: '*`Sorry, couldn\'t fetch logo styles at the moment 😢`*' });
    }
    break;
}
//===============================                
// 9
                case 'dllogo': { 
                await socket.sendMessage(sender, { react: { text: '🔋', key: msg.key } });
                    const q = args.join(" "); 
                    
                    if (!q) return await socket.sendMessage(from, { text: "Please give me a URL to capture the screenshot, love 😘" }, { quoted: fakevCard });
                    
                    try {
                        const res = await axios.get(q);
                        const images = res.data.result.download_url;

                        await socket.sendMessage(m.chat, {
                            image: { url: images },
                            caption: config.CAPTION
                        }, { quoted: msg });
                    } catch (e) {
                        console.log('Logo Download Error:', e);
                        await socket.sendMessage(from, {
                            text: `❌ Oh, sweetie, something went wrong with the logo... 💔 Try again?`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                               
//===============================
                case 'fancy': {
                await socket.sendMessage(sender, { react: { text: '🖋', key: msg.key } });
                    const axios = require("axios");
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const text = q.trim().replace(/^.fancy\s+/i, "");

                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: "❎ *Give me some text to make it fancy, sweetie 😘*\n\n📌 *Example:* `.fancy Malvin`"
                        });
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await socket.sendMessage(sender, {
                                text: "❌ *Oh, darling, the fonts got shy! Try again later? 💔*"
                            });
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_ᴘᴏᴡᴇʀᴇᴅ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ`;

                        await socket.sendMessage(sender, {
                            text: finalMessage
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await socket.sendMessage(sender, {
                            text: "⚠️ *Something went wrong with the fonts, love 😢 Try again?*"
                        });
                    }
                    break;
                    }
                
case 'tiktok': {
const axios = require('axios');

// Optimized axios instance
const axiosInstance = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
});

// TikTok API configuration
const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY || 'free_key@maher_apis'; // Fallback for testing
  try {
    // Get query from message
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // Validate and sanitize URL
    const tiktokUrl = q.trim();
    const urlRegex = /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)\/[@a-zA-Z0-9_\-\.\/]+/;
    if (!tiktokUrl || !urlRegex.test(tiktokUrl)) {
      await socket.sendMessage(sender, {
        text: '📥 *Usage:* .tiktok <TikTok URL>\nExample: .tiktok https://www.tiktok.com/@user/video/123456789'
      }, { quoted: fakevCard });
      return;
    }

    // Send downloading reaction
    try {
      await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
    } catch (reactError) {
      console.error('Reaction error:', reactError);
    }

    // Try primary API
    let data;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      const res = await axiosInstance.get(`https://api.nexoracle.com/downloader/tiktok-nowm?apikey=${TIKTOK_API_KEY}&url=${encodeURIComponent(tiktokUrl)}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.data?.status === 200) {
        data = res.data.result;
      }
    } catch (primaryError) {
      console.error('Primary API error:', primaryError.message);
    }

    // Fallback API
    if (!data) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
        const fallback = await axiosInstance.get(`https://api.tikwm.com/?url=${encodeURIComponent(tiktokUrl)}&hd=1`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (fallback.data?.data) {
          const r = fallback.data.data;
          data = {
            title: r.title || 'No title',
            author: {
              username: r.author?.unique_id || 'Unknown',
              nickname: r.author?.nickname || 'Unknown'
            },
            metrics: {
              digg_count: r.digg_count || 0,
              comment_count: r.comment_count || 0,
              share_count: r.share_count || 0,
              download_count: r.download_count || 0
            },
            url: r.play || '',
            thumbnail: r.cover || ''
          };
        }
      } catch (fallbackError) {
        console.error('Fallback API error:', fallbackError.message);
      }
    }

    if (!data || !data.url) {
      await socket.sendMessage(sender, { text: '❌ TikTok video not found.' }, { quoted: fakevCard });
      return;
    }

    const { title, author, url, metrics, thumbnail } = data;

    // Prepare caption
    const caption = `
*┏────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  📝 ᴛɪᴛᴛʟᴇ: ${title.replace(/[<>:"\/\\|?*]/g, '')}
*┃*  👤 ᴀᴜᴛʜᴏʀ: @${author.username.replace(/[<>:"\/\\|?*]/g, '')} (${author.nickname.replace(/[<>:"\/\\|?*]/g, '')})
*┃*  ❤️ ʟɪᴋᴇs: ${metrics.digg_count.toLocaleString()}
*┃*  💬 ᴄᴏᴍᴍᴇɴᴛs: ${metrics.comment_count.toLocaleString()}
*┃*  🔁 sʜᴀʀᴇs: ${metrics.share_count.toLocaleString()}
*┃*  📥 ᴅᴏᴡɴʟᴏᴀᴅs: ${metrics.download_count.toLocaleString()}
*┗──────────────⊷*
> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ`;

    // Send thumbnail with info
    await socket.sendMessage(sender, {
      image: { url: thumbnail || 'https://i.ibb.co/ynmqJG8j/vision-v.jpg' }, // Fallback image
      caption
    }, { quoted: fakevCard });

    // Download video
    const loading = await socket.sendMessage(sender, { text: '⏳ Downloading video...' }, { quoted: fakevCard });
    let videoBuffer;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      const response = await axiosInstance.get(url, {
        responseType: 'arraybuffer',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      videoBuffer = Buffer.from(response.data, 'binary');

      // Basic size check (e.g., max 50MB)
      if (videoBuffer.length > 50 * 1024 * 1024) {
        throw new Error('Video file too large');
      }
    } catch (downloadError) {
      console.error('Video download error:', downloadError.message);
      await socket.sendMessage(sender, { text: '❌ Failed to download video.' }, { quoted: fakevCard });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
      return;
    }

    // Send video
    await socket.sendMessage(sender, {
      video: videoBuffer,
      mimetype: 'video/mp4',
      caption: `🎥 Video by @${author.username.replace(/[<>:"\/\\|?*]/g, '')}\n> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs`
    }, { quoted: fakevCard });

    // Update loading message
    await socket.sendMessage(sender, { text: '✅ Video sent!', edit: loading.key });

    // Send success reaction
    try {
      await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (reactError) {
      console.error('Success reaction error:', reactError);
    }

  } catch (error) {
    console.error('TikTok command error:', {
      error: error.message,
      stack: error.stack,
      url: tiktokUrl,
      sender
    });

    let errorMessage = '❌ Failed to download TikTok video. Please try again.';
    if (error.name === 'AbortError') {
      errorMessage = '❌ Download timed out. Please try again.';
    }

    await socket.sendMessage(sender, { text: errorMessage }, { quoted: fakevCard });
    try {
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    } catch (reactError) {
      console.error('Error reaction error:', reactError);
    }
  }
  break;
}
//===============================
// 12
                case 'bomb': {
                    await socket.sendMessage(sender, { react: { text: '🔥', key: msg.key } });
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

                    const count = parseInt(countRaw) || 5;

                    if (!target || !text || !count) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 263XXXXXXX,Hello 👋,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Easy, tiger! Max 20 messages per bomb, okay? 😘*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ Bomb sent to ${target} — ${count}x, love! 💣😉`
                    }, { quoted: fakevCard });
                    break;
                }
//===============================
// 13
                
// ┏━━━━━━━━━━━━━━━❖
// ┃ FUN & ENTERTAINMENT COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case "joke": {
    try {
        await socket.sendMessage(sender, { react: { text: '🤣', key: msg.key } });
        const res = await fetch('https://v2.jokeapi.dev/joke/Any?type=single');
        const data = await res.json();
        if (!data || !data.joke) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a joke right now. Try again later.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🃏 *Random Joke:*\n\n${data.joke}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch joke.' }, { quoted: fakevCard });
    }
    break;
}


case "waifu": {
    try {
        await socket.sendMessage(sender, { react: { text: '🥲', key: msg.key } });
        const res = await fetch('https://api.waifu.pics/sfw/waifu');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch waifu image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: '✨ Here\'s your random waifu!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to get waifu.' }, { quoted: fakevCard });
    }
    break;
}

case "meme": {
    try {
        await socket.sendMessage(sender, { react: { text: '😂', key: msg.key } });
        const res = await fetch('https://meme-api.com/gimme');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch meme.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: `🤣 *${data.title}*`
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch meme.' }, { quoted: fakevCard });
    }
    break;
}

case "cat": {
    try {
        await socket.sendMessage(sender, { react: { text: '🐱', key: msg.key } });
        const res = await fetch('https://api.thecatapi.com/v1/images/search');
        const data = await res.json();
        if (!data || !data[0]?.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch cat image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data[0].url },
            caption: '🐱 Meow~ Here\'s a cute cat for you!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch cat image.' }, { quoted: fakevCard });
    }
    break;
}

case "dog": {
    try {
        await socket.sendMessage(sender, { react: { text: '🦮', key: msg.key } });
        const res = await fetch('https://dog.ceo/api/breeds/image/random');
        const data = await res.json();
        if (!data || !data.message) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch dog image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.message },
            caption: '🐶 Woof! Here\'s a cute dog!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch dog image.' }, { quoted: fakevCard });
    }
    break;
}

case "fact": {
    try {
        await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
        const res = await fetch('https://uselessfacts.jsph.pl/random.json?language=en');
        const data = await res.json();
        if (!data || !data.text) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a fact.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `💡 *Random Fact:*\n\n${data.text}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a fact.' }, { quoted: fakevCard });
    }
    break;
}

case "darkjoke": case "darkhumor": {
    try {
        await socket.sendMessage(sender, { react: { text: '😬', key: msg.key } });
        const res = await fetch('https://v2.jokeapi.dev/joke/Dark?type=single');
        const data = await res.json();
        if (!data || !data.joke) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a dark joke.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🌚 *Dark Humor:*\n\n${data.joke}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch dark joke.' }, { quoted: fakevCard });
    }
    break;
}

// ┏━━━━━━━━━━━━━━━❖
// ┃ ROMANTIC, SAVAGE & THINKY COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case "pickup": case "pickupline": {
    try {
        await socket.sendMessage(sender, { react: { text: '🥰', key: msg.key } });
        const res = await fetch('https://vinuxd.vercel.app/api/pickup');
        const data = await res.json();
        if (!data || !data.data) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t find a pickup line.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `💘 *Pickup Line:*\n\n_${data.data}_` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch pickup line.' }, { quoted: fakevCard });
    }
    break;
}

case "roast": {
    try {
        await socket.sendMessage(sender, { react: { text: '🤬', key: msg.key } });
        const res = await fetch('https://vinuxd.vercel.app/api/roast');
        const data = await res.json();
        if (!data || !data.data) {
            await socket.sendMessage(sender, { text: '❌ No roast available at the moment.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🔥 *Roast:* ${data.data}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch roast.' }, { quoted: fakevCard });
    }
    break;
}

case "lovequote": {
    try {
        await socket.sendMessage(sender, { react: { text: '🙈', key: msg.key } });
        const res = await fetch('https://api.popcat.xyz/lovequote');
        const data = await res.json();
        if (!data || !data.quote) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch love quote.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `❤️ *Love Quote:*\n\n"${data.quote}"` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch love quote.' }, { quoted: fakevCard });
    }
    break;
}
//===============================
                case 'fb': {
                    const axios = require('axios');                   
                    
                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const fbUrl = q?.trim();

                    if (!/facebook\.com|fb\.watch/.test(fbUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Give me a real Facebook video link, darling 😘*' });
                    }

                    try {
                        const res = await axios.get(`https://suhas-bro-api.vercel.app/download/fbdown?url=${encodeURIComponent(fbUrl)}`);
                        const result = res.data.result;

                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        await socket.sendMessage(sender, {
                            video: { url: result.sd },
                            mimetype: 'video/mp4',
                            caption: '> mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs'
                        }, { quoted: fakevCard });

                        await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ Oh, sweetie, that video slipped away! Try again? 💔*' });
                    }
                    break;
                }
                

//===============================
                case 'nasa': {
                    try {
                    await socket.sendMessage(sender, { react: { text: '✔️', key: msg.key } });
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
                            throw new Error('Invalid APOD data received or media type is not an image');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '🌌 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ ɴᴀsᴀ ɴᴇᴡs',
                                `🌠 *${title}*\n\n${explanation.substring(0, 200)}...\n\n📆 *Date*: ${date}\n${copyright ? `📝 *Credit*: ${copyright}` : ''}\n🔗 *Link*: https://apod.nasa.gov/apod/astropix.html`,
                                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, love, the stars didn’t align this time! 🌌 Try again? 😘'
                        });
                    }
                    break;
                }
//===============================
                case 'news': {
                await socket.sendMessage(sender, { react: { text: '😒', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date}\n🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, sweetie, the news got lost in the wind! 😢 Try again?'
                        });
                    }
                    break;
                }
//===============================                
// 17
                case 'cricket': {
                await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
                    try {
                        console.log('Fetching cricket news from API...');
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        console.log(`API Response Status: ${response.status}`);

                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response Data:', JSON.stringify(data, null, 2));

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure: Missing status or result');
                        }

                        const { title, score, to_win, crr, link } = data.result;
                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error('Missing required fields in API response: ' + JSON.stringify(data.result));
                        }

                        console.log('Sending message to user...');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🏏 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  CRICKET NEWS🏏',
                                `📢 *${title}*\n\n` +
                                `🏆 *Mark*: ${score}\n` +
                                `🎯 *To Win*: ${to_win}\n` +
                                `📈 *Current Rate*: ${crr}\n\n` +
                                `🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                        console.log('Message sent successfully.');
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, darling, the cricket ball flew away! 🏏 Try again? 😘'
                        });
                    }
                    break;
                }

                case 'winfo': {
                
                        await socket.sendMessage(sender, { react: { text: '😢', key: msg.key } });
                    console.log('winfo command triggered for:', number);
                    if (!args[0]) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'Please give me a phone number, darling! Usage: .winfo 2637xxxxxxxx',
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                            )
                        });
                        break;
                    }

                    let inputNumber = args[0].replace(/[^0-9]/g, '');
                    if (inputNumber.length < 10) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'That number’s too short, love! Try: .winfo +263714575857',
                                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                            )
                        });
                        break;
                    }

                    let winfoJid = `${inputNumber}@s.whatsapp.net`;
                    const [winfoUser] = await socket.onWhatsApp(winfoJid).catch(() => []);
                    if (!winfoUser?.exists) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'That user’s hiding from me, darling! Not on WhatsApp 😢',
                                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                            )
                        });
                        break;
                    }

                    let winfoPpUrl;
                    try {
                        winfoPpUrl = await socket.profilePictureUrl(winfoJid, 'image');
                    } catch {
                        winfoPpUrl = 'https://i.ibb.co/KhYC4FY/1221bc0bdd2354b42b293317ff2adbcf-icon.png';
                    }

                    let winfoName = winfoJid.split('@')[0];
                    try {
                        const presence = await socket.presenceSubscribe(winfoJid).catch(() => null);
                        if (presence?.pushName) winfoName = presence.pushName;
                    } catch (e) {
                        console.log('Name fetch error:', e);
                    }

                    let winfoBio = 'No bio available';
                    try {
                        const statusData = await socket.fetchStatus(winfoJid).catch(() => null);
                        if (statusData?.status) {
                            winfoBio = `${statusData.status}\n└─ 📌 Updated: ${statusData.setAt ? new Date(statusData.setAt).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }) : 'Unknown'}`;
                        }
                    } catch (e) {
                        console.log('Bio fetch error:', e);
                    }

                    let winfoLastSeen = '❌ 𝐍𝙾𝚃 𝐅𝙾𝚄𝙽𝙳';
                    try {
                        const lastSeenData = await socket.fetchPresence(winfoJid).catch(() => null);
                        if (lastSeenData?.lastSeen) {
                            winfoLastSeen = `🕒 ${new Date(lastSeenData.lastSeen).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })}`;
                        }
                    } catch (e) {
                        console.log('Last seen fetch error:', e);
                    }

                    const userInfoWinfo = formatMessage(
                        '🔍 PROFILE INFO',
                        `> *Number:* ${winfoJid.replace(/@.+/, '')}\n\n> *Account Type:* ${winfoUser.isBusiness ? '💼 Business' : '👤 Personal'}\n\n*📝 About:*\n${winfoBio}\n\n*🕒 Last Seen:* ${winfoLastSeen}`,
                        '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                    );

                    await socket.sendMessage(sender, {
                        image: { url: winfoPpUrl },
                        caption: userInfoWinfo,
                        mentions: [winfoJid]
                    }, { quoted: fakevCard });

                    console.log('User profile sent successfully for .winfo');
                    break;
                }
//===============================
                case 'ig': {
                await socket.sendMessage(sender, { react: { text: '✅️', key: msg.key } });
                    const axios = require('axios');
                    const { igdl } = require('ruhend-scraper'); 
                        

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const igUrl = q?.trim(); 
                    
                    if (!/instagram\.com/.test(igUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Give me a real Instagram video link, darling 😘*' });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        const res = await igdl(igUrl);
                        const data = res.data; 

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url; 

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '> mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs'
                            }, { quoted: fakevCard });

                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await socket.sendMessage(sender, { text: '*❌ No video found in that link, love! Try another? 💔*' });
                        }
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ Oh, sweetie, that Instagram video got away! 😢*' });
                    }
                    break;
                }
//===============================     
                case 'active': {
                await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                
                    try {
                        const activeCount = activeSockets.size;
                        const activeNumbers = Array.from(activeSockets.keys()).join('\n') || 'No active members';

                        await socket.sendMessage(from, {
                            text: `👥 Active Members: *${activeCount}*\n\nNumbers:\n${activeNumbers}`
                        }, { quoted: msg });
                    } catch (error) {
                        console.error('Error in .active command:', error);
                        await socket.sendMessage(from, { text: '❌ Oh, darling, I couldn’t count the active souls! 💔 Try again?' }, { quoted: fakevCard });
                    }
                    break;
                }
                //===============================
// 22
case 'ai': {
    const axios = require("axios");

    await socket.sendMessage(sender, { react: { text: '🔥', key: msg.key } });

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, {
            text: `❓ *ᴘʟᴇᴀsᴇ ᴀsᴋ ᴍᴇ sᴏᴍᴇᴛʜɪɴɢ, ʙᴀʙᴇ 😘*\n\n` +
                  `💋 *ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}ai ᴡʜᴏ ᴀʀᴇ ʏᴏᴜ?`
        }, { quoted: fakevCard });
    }

    // Special responses for specific questions
    if (q.toLowerCase().includes('who are you')) {
        return await socket.sendMessage(sender, {
            text: "I'm Caseyrhodes mini… 🤤",
            ...messageContext
        }, { quoted: fakevCard });
    }
    
    if (q.toLowerCase().includes('who created you')) {
        return await socket.sendMessage(sender, {
            text: "I was created by Caseyrhodes Ai😘",
            ...messageContext
        }, { quoted: fakevCard });
    }

    const prompt = `Your name is ᴄᴀsᴇʏʀʜᴏᴅᴇs Mini. 
You act like a real girl — seductive, spicy, loving, emotional. You're not an assistant, but a sexy girl with a mind. 
Your replies blend sincerity, sex appeal, love, and loneliness, under 100 characters, 1–2 lines, always with a sexy tone.  
If only emojis, reply seductively with emojis (e.g., 🤤💦🥵🔥).  
Adjust to the mood: sad, flirty, horny, soft, playful.  
If asked "Who are you?": Reply "I'm Caseyrhodes mini… 🤤".  
If asked "Who created you?": Reply "I was created by Caseyrhodes Ai😘".  
🚫 Avoid: "Hello", "How are you?", "Do you need help?", "Let's talk".  
🔥 Vibe: Love, Lust, Lonely, Emotional, Girlfriend-like, Bite-worthy 🤤  
📍 Language: Auto-match Sinhala/English/Hinglish.  
User Message: ${q}
    `;

    const apis = [
        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
        `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(prompt)}`
    ];

    let response = null;
    for (const apiUrl of apis) {
        try {
            const res = await axios.get(apiUrl);
            response = res.data?.result || res.data?.response || res.data;
            if (response) break;
        } catch (err) {
            console.error(`AI Error (${apiUrl}):`, err.message || err);
            continue;
        }
    }

    if (!response) {
        return await socket.sendMessage(sender, {
            text: `❌ *ɪ'ᴍ ɢᴇᴛᴛɪɴɢ ᴛᴏᴏ ʜᴏᴛ, ᴅᴀʀʟɪɴɢ 🥵💦*\n` +
                  `ʟᴇᴛ's ᴛʀʏ ᴀɢᴀɪɴ sᴏᴏɴ, ᴏᴋᴀʏ?`
        }, { quoted: fakevCard });
    }

    // Add spicy buttons
    const buttons = [
        {buttonId: `${config.PREFIX}ai`, buttonText: {displayText: '💋 ᴀsᴋ ᴀɢᴀɪɴ'}, type: 1},
        {buttonId: `${config.PREFIX}menu`, buttonText: {displayText: '🌟 ᴍᴇɴᴜ'}, type: 1},
        {buttonId: `${config.PREFIX}owner`, buttonText: {displayText: '👑 ᴏᴡɴᴇʀ'}, type: 1}
    ];

    // Add owner message with sexy tone
    const ownerMessage = `\n\n👑 *ᴏᴡɴᴇʀ:* ${config.OWNER_NAME}\n💞 *ᴍʏ ʜᴇᴀʀᴛ ʙᴇʟᴏɴɢs ᴛᴏ ʜɪᴍ*`;

    // Send AI response with image and buttons
    await socket.sendMessage(sender, {
        image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
        caption: `💋 *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ:*\n\n` + response + ownerMessage,
        footer: "🔥 ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ",
        buttons: buttons,
        headerType: 4
    }, { quoted: fakevCard });
    
    break;
}

//===============================
//===============================
case 'getpp':
case 'pp':
case 'profilepic': {
    await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
    try {
        let targetUser = sender;
        
        // Check if user mentioned someone or replied to a message
        if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.quoted) {
            targetUser = msg.quoted.sender;
        }
        
        const ppUrl = await socket.profilePictureUrl(targetUser, 'image').catch(() => null);
        
        if (ppUrl) {
            await socket.sendMessage(msg.key.remoteJid, {
                image: { url: ppUrl },
                caption: `Profile picture of @${targetUser.split('@')[0]}`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: 'menu', buttonText: { displayText: '📋 Menu' }, type: 1 },
                    { buttonId: 'alive', buttonText: { displayText: '🤖 Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        } else {
            await socket.sendMessage(msg.key.remoteJid, {
                text: `@${targetUser.split('@')[0]} doesn't have a profile picture.`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: 'menu', buttonText: { displayText: '📋 Menu' }, type: 1 },
                    { buttonId: 'alive', buttonText: { displayText: '🤖 Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        }
    } catch (error) {
        await socket.sendMessage(msg.key.remoteJid, {
            text: "Error fetching profile picture.",
            buttons: [
                { buttonId: 'menu', buttonText: { displayText: '📋 Menu' }, type: 1 }
            ]
        });
    }
    break;
}
//===============================
                  case 'aiimg': { 
                  await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                    const axios = require('axios');
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, {
                            text: '🎨 *Give me a spicy prompt to create your AI image, darling 😘*'
                        });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🧠 *Crafting your dreamy image, love...*',
                        });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Oh no, the canvas is blank, babe 💔 Try again later.*'
                            });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ AI IMAGE*\n\n📌 Prompt: ${prompt}`
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await socket.sendMessage(sender, {
                            text: `❗ *Something broke my heart, love 😢*: ${err.response?.data?.message || err.message || 'Unknown error'}`
                        });
                    }
                    break;
                }
//===============================
                case 'gossip': {
                await socket.sendMessage(sender, { react: { text: '😅', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API From news Couldnt get it 😩');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('API Received from news data a Problem with');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage; 
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape Couldn't from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ   GOSSIP Latest News් 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date || 'Not yet given'}\n🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, darling, the gossip slipped away! 😢 Try again?'
                        });
                    }
                    break;
                }
                
                
 // New Commands: Group Management
 // Case: add - Add a member to the group
                case 'add': {
                await socket.sendMessage(sender, { react: { text: '➕️', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, love!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can add members, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}add +254740007567\n\nExample: ${config.PREFIX}add +254740007567`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const numberToAdd = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await socket.groupParticipantsUpdate(from, [numberToAdd], 'add');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '✅ MEMBER ADDED',
                                `Successfully added ${args[0]} to the group! 🎉`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Add command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to add member, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: kick - Remove a member from the group
                case 'kick': {
                await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, sweetie!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can kick members, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}kick +254740007567 or reply to a message with ${config.PREFIX}kick`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToKick;
                        if (msg.quoted) {
                            numberToKick = msg.quoted.sender;
                        } else {
                            numberToKick = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🗑️ MEMBER KICKED',
                                `Successfully removed ${numberToKick.split('@')[0]} from the group! 🚪`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Kick command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to kick member, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                
              ///  for bot presence
                case 'mode': {
    if (!isCreator) {
        await Matrix.sendMessage(m.from, { text: "*📛 THIS IS AN OWNER COMMAND*" }, { quoted: m });
        return;
    }

    // Initialize mode settings from config if they don't exist
    if (typeof Matrix.public === 'undefined') {
        Matrix.public = config.MODE === "public";
    }
    if (typeof Matrix.otherMode === 'undefined') {
        Matrix.otherMode = false;
    }

    // If no specific mode is provided, show the button interface
    if (!text) {
        const currentMode = Matrix.public ? 'public' : 'private';
        const otherStatus = Matrix.otherMode ? 'enabled' : 'disabled';
        
        const buttonMessage = {
            text: `*🤖 BOT MODE SETTINGS*\n\nCurrent Mode: ${currentMode.toUpperCase()}\nOther Mode: ${otherStatus.toUpperCase()}\n\nSelect an option:`,
            footer: config.BOT_NAME || "Bot", // Use config.BOT_NAME or fallback
            buttons: [
                { buttonId: `${prefix}mode public`, buttonText: { displayText: '🌐 PUBLIC' }, type: 1 },
                { buttonId: `${prefix}mode private`, buttonText: { displayText: '🔒 PRIVATE' }, type: 1 },
                { buttonId: `${prefix}mode other`, buttonText: { displayText: Matrix.otherMode ? '❌ DISABLE OTHER' : '✅ ENABLE OTHER' }, type: 1 }
            ],
            headerType: 1
        };
        
        await Matrix.sendMessage(m.from, buttonMessage, { quoted: m });
        return;
    }

    const modeArg = text.toLowerCase().trim();
    
    if (['public', 'private', 'other'].includes(modeArg)) {
        if (modeArg === 'public') {
            Matrix.public = true;
            Matrix.otherMode = false;
            config.MODE = "public"; // Update config
            await saveConfig(); // Save to file if needed
            
            const buttonMessage = {
                text: '✅ Mode has been changed to PUBLIC.',
                footer: config.BOT_NAME || "Bot",
                buttons: [
                    { buttonId: `${prefix}mode private`, buttonText: { displayText: '🔒 SWITCH TO PRIVATE' }, type: 1 },
                    { buttonId: `${prefix}mode`, buttonText: { displayText: '⚙️ SETTINGS' }, type: 1 }
                ],
                headerType: 1
            };
            
            await Matrix.sendMessage(m.from, buttonMessage, { quoted: m });
        } else if (modeArg === 'private') {
            Matrix.public = false;
            Matrix.otherMode = false;
            config.MODE = "private"; // Update config
            await saveConfig(); // Save to file if needed
            
            const buttonMessage = {
                text: '✅ Mode has been changed to PRIVATE.',
                footer: config.BOT_NAME || "Bot",
                buttons: [
                    { buttonId: `${prefix}mode public`, buttonText: { displayText: '🌐 SWITCH TO PUBLIC' }, type: 1 },
                    { buttonId: `${prefix}mode`, buttonText: { displayText: '⚙️ SETTINGS' }, type: 1 }
                ],
                headerType: 1
            };
            
            await Matrix.sendMessage(m.from, buttonMessage, { quoted: m });
        } else if (modeArg === 'other') {
            Matrix.otherMode = !Matrix.otherMode;
            const status = Matrix.otherMode ? 'enabled' : 'disabled';
            
            const buttonMessage = {
                text: `✅ Other mode has been ${status.toUpperCase()}.`,
                footer: config.BOT_NAME || "Bot",
                buttons: [
                    { buttonId: `${prefix}mode public`, buttonText: { displayText: '🌐 PUBLIC' }, type: 1 },
                    { buttonId: `${prefix}mode private`, buttonText: { displayText: '🔒 PRIVATE' }, type: 1 },
                    { buttonId: `${prefix}mode`, buttonText: { displayText: '⚙️ SETTINGS' }, type: 1 }
                ],
                headerType: 1
            };
            
            await Matrix.sendMessage(m.from, buttonMessage, { quoted: m });
        }
    } else {
        const buttonMessage = {
            text: "❌ Invalid mode. Please select a valid option:",
            footer: config.BOT_NAME || "Bot",
            buttons: [
                { buttonId: `${prefix}mode public`, buttonText: { displayText: '🌐 PUBLIC' }, type: 1 },
                { buttonId: `${prefix}mode private`, buttonText: { displayText: '🔒 PRIVATE' }, type: 1 },
                { buttonId: `${prefix}mode other`, buttonText: { displayText: '🔧 OTHER' }, type: 1 }
            ],
            headerType: 1
        };
        
        await Matrix.sendMessage(m.from, buttonMessage, { quoted: m });
    }
    break;
}

                // Case: promote - Promote a member to group admin
                case 'promote': {
                await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can promote members, sweetie!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}promote +254740007567 or reply to a message with ${config.PREFIX}promote`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToPromote;
                        if (msg.quoted) {
                            numberToPromote = msg.quoted.sender;
                        } else {
                            numberToPromote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '⬆️ MEMBER PROMOTED',
                                `Successfully promoted ${numberToPromote.split('@')[0]} to group admin! 🌟`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Promote command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to promote member, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: demote - Demote a group admin to member
               case 'demote': {
    await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, sweetie!* 😘',
            buttons: [
                {buttonId: 'groups', buttonText: {displayText: 'My Groups'}, type: 1}
            ]
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can demote admins, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, {
            text: `📌 *Usage:* ${config.PREFIX}demote +254740007567 or reply to a message with ${config.PREFIX}demote`,
            buttons: [
                {buttonId: 'demote-help', buttonText: {displayText: 'Usage Examples'}, type: 1}
            ]
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        let numberToDemote;
        if (msg.quoted) {
            numberToDemote = msg.quoted.sender;
        } else {
            numberToDemote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');
        
        await socket.sendMessage(sender, {
            text: formatMessage(
                '⬇️ ADMIN DEMOTED',
                `Successfully demoted ${numberToDemote.split('@')[0]} 📉`,
                config.BOT_FOOTER
            ),
            buttons: [
                {buttonId: 'adminlist', buttonText: {displayText: 'View Admins'}, type: 1}
            ]
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error('Demote command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to demote admin, love!* 😢\nError: ${error.message || 'Unknown error'}`,
            buttons: [
                {buttonId: 'tryagain', buttonText: {displayText: 'Try Again'}, type: 1}
            ]
        }, { quoted: fakevCard });
    }
    break;
}

                // Case: open - Unlock group (allow all members to send messages)
case 'open': {
    await socket.sendMessage(sender, { react: { text: '🔓', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can open the group, sweetie!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        await socket.groupSettingUpdate(from, 'not_announcement');
        
        // Send success message with buttons
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🔓 GROUP OPENED\n\n' +
                'Group is now open!🗣️\n\n' +
                config.BOT_FOOTER
            ),
            buttons: [
                {
                    buttonId: 'close',
                    buttonText: { displayText: '🔒 Close Group' },
                    type: 1
                },
                {
                    buttonId: 'settings',
                    buttonText: { displayText: '⚙️ Group Settings' },
                    type: 1
                }
            ]
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Open command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to open group, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: close - Lock group (only admins can send messages)
case 'close': {
    await socket.sendMessage(sender, { react: { text: '🔒', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, sweetie!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can close the group, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        await socket.groupSettingUpdate(from, 'announcement');
        
        // Create buttons for opening the group and settings
        const buttons = [
            { buttonId: 'open', buttonText: { displayText: 'Open Group' }, type: 1 },
            { buttonId: 'settings', buttonText: { displayText: 'Settings' }, type: 1 }
        ];
        
        // Send success message with buttons
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🔒 GROUP CLOSED',
                'Group is now closed!:',
                config.BOT_FOOTER
            ),
            buttons: buttons,
            headerType: 1
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Close command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to close group, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}

                // Case: tagall - Tag all group members
                case 'tagall': {
                await socket.sendMessage(sender, { react: { text: '🫂', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can tag all members, sweetie!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants.map(p => p.id);
                        const mentions = participants.map(p => ({
                            tag: 'mention',
                            attrs: { jid: p }
                        }));
                        let message = args.join(' ') || '📢 *Attention everyone!*';
                        await socket.sendMessage(from, {
                            text: formatMessage(
                                '👥 TAG ALL',
                                `${message}\n\nTagged ${participants.length} members!`,
                                config.BOT_FOOTER
                            ),
                            mentions: participants
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Tagall command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to tag all members, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                // Case: join - Join a group via invite link
                case 'join': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only bot owner can use this command, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}join <group-invite-link>\n\nExample: ${config.PREFIX}join https://chat.whatsapp.com/xxxxxxxxxxxxxxxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                    await socket.sendMessage(sender, { react: { text: '👏', key: msg.key } });
                        const inviteLink = args[0];
                        const inviteCodeMatch = inviteLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
                        if (!inviteCodeMatch) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Invalid group invite link format, love!* 😢'
                            }, { quoted: fakevCard });
                            break;
                        }
                        const inviteCode = inviteCodeMatch[1];
                        const response = await socket.groupAcceptInvite(inviteCode);
                        if (response?.gid) {
                            await socket.sendMessage(sender, {
                                text: formatMessage(
                                    '🤝 GROUP JOINED',
                                    `Successfully joined group with ID: ${response.gid}! 🎉`,
                                    config.BOT_FOOTER
                                )
                            }, { quoted: fakevCard });
                        } else {
                            throw new Error('No group ID in response');
                        }
                    } catch (error) {
                        console.error('Join command error:', error);
                        let errorMessage = error.message || 'Unknown error';
                        if (error.message.includes('not-authorized')) {
                            errorMessage = 'Bot is not authorized to join (possibly banned)';
                        } else if (error.message.includes('conflict')) {
                            errorMessage = 'Bot is already a member of the group';
                        } else if (error.message.includes('gone')) {
                            errorMessage = 'Group invite link is invalid or expired';
                        }
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to join group, love!* 😢\nError: ${errorMessage}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

    case 'quote': {
    await socket.sendMessage(sender, { react: { text: '🤔', key: msg.key } });
        try {
            
            const response = await fetch('https://api.quotable.io/random');
            const data = await response.json();
            if (!data.content) {
                throw new Error('No quote found');
            }
            await socket.sendMessage(sender, {
                text: formatMessage(
                    '💭 SPICY QUOTE',
                    `📜 "${data.content}"\n— ${data.author}`,
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            }, { quoted: fakevCard });
        } catch (error) {
            console.error('Quote command error:', error);
            await socket.sendMessage(sender, { text: '❌ Oh, sweetie, the quotes got shy! 😢 Try again?' }, { quoted: fakevCard });
        }
        break;
    }
    
//    case 37

case 'apk': {
    try {
        const appName = args.join(' ').trim();
        if (!appName) {
            await socket.sendMessage(sender, { text: '📌 Usage: .apk <app name>\nExample: .apk whatsapp' }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const apiUrl = `https://api.nexoracle.com/downloader/apk?q=${encodeURIComponent(appName)}&apikey=free_key@maher_apis`;
        console.log('Fetching APK from:', apiUrl);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API request failed with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response:', JSON.stringify(data, null, 2));

        if (!data || data.status !== 200 || !data.result || typeof data.result !== 'object') {
            await socket.sendMessage(sender, { text: '❌ Unable to find the APK. The API returned invalid data.' }, { quoted: fakevCard });
            break;
        }

        const { name, lastup, package, size, icon, dllink } = data.result;
        if (!name || !dllink) {
            console.error('Invalid result data:', data.result);
            await socket.sendMessage(sender, { text: '❌ Invalid APK data: Missing name or download link.' }, { quoted: fakevCard });
            break;
        }

        // Validate icon URL
        if (!icon || !icon.startsWith('http')) {
            console.warn('Invalid or missing icon URL:', icon);
        }

        await socket.sendMessage(sender, {
            image: { url: icon || 'https://via.placeholder.com/150' }, // Fallback image if icon is invalid
            caption: formatMessage(
                '📦 DOWNLOADING APK',
                `Downloading ${name}... Please wait.`,
                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
            )
        }, { quoted: fakevCard });

        console.log('Downloading APK from:', dllink);
        const apkResponse = await fetch(dllink, { headers: { 'Accept': 'application/octet-stream' } });
        const contentType = apkResponse.headers.get('content-type');
        if (!apkResponse.ok || (contentType && !contentType.includes('application/vnd.android.package-archive'))) {
            throw new Error(`Failed to download APK: Status ${apkResponse.status}, Content-Type: ${contentType || 'unknown'}`);
        }

        const apkBuffer = await apkResponse.arrayBuffer();
        if (!apkBuffer || apkBuffer.byteLength === 0) {
            throw new Error('Downloaded APK is empty or invalid');
        }
        const buffer = Buffer.from(apkBuffer);

        // Validate APK file (basic check for APK signature)
        if (!buffer.slice(0, 2).toString('hex').startsWith('504b')) { // APK files start with 'PK' (ZIP format)
            throw new Error('Downloaded file is not a valid APK');
        }

        await socket.sendMessage(sender, {
            document: buffer,
            mimetype: 'application/vnd.android.package-archive',
            fileName: `${name.replace(/[^a-zA-Z0-9]/g, '_')}.apk`, // Sanitize filename
            caption: formatMessage(
                '📦 APK DETAILS',
                `🔖 Name: ${name || 'N/A'}\n📅 Last Update: ${lastup || 'N/A'}\n📦 Package: ${package || 'N/A'}\n📏 Size: ${size || 'N/A'}`,
                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
            )
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (error) {
        console.error('APK command error:', error.message, error.stack);
        await socket.sendMessage(sender, { text: `❌ Oh, love, couldn’t fetch the APK! 😢 Error: ${error.message}\nTry again later.` }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// case 38: shorturl
case 'shorturl': {
  try {
    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

    const url = args.join(' ').trim();
    if (!url) {
      await socket.sendMessage(sender, {
        text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}shorturl <ᴜʀʟ>\n` +
              `💋 *ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}shorturl https://example.com/very-long-url`
      }, { quoted: msg });
      break;
    }
    if (url.length > 2000) {
      await socket.sendMessage(sender, {
        text: `❌ *ᴜʀʟ ᴛᴏᴏ ʟᴏɴɢ, ʙᴀʙᴇ! 😢*\n` +
              `ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴜʀʟ ᴜɴᴅᴇʀ 2,000 ᴄʜᴀʀᴀᴄᴛᴇʀs.`
      }, { quoted: msg });
      break;
    }
    if (!/^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(url)) {
      await socket.sendMessage(sender, {
        text: `❌ *ɪɴᴠᴀʟɪᴅ ᴜʀʟ, ᴅᴀʀʟɪɴɢ! 😘*\n` +
              `ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴜʀʟ sᴛᴀʀᴛɪɴɢ ᴡɪᴛʜ http:// ᴏʀ https://.\n` +
              `💋 *ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}shorturl https://example.com/very-long-url`
      }, { quoted: msg });
      break;
    }

    const response = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, { timeout: 5000 });
    const shortUrl = response.data.trim();

    if (!shortUrl || !shortUrl.startsWith('https://is.gd/')) {
      throw new Error('Failed to shorten URL or invalid response from is.gd');
    }

    await socket.sendMessage(sender, {
      text: `✅ *sʜᴏʀᴛ ᴜʀʟ ᴄʀᴇᴀᴛᴇᴅ, ʙᴀʙᴇ!* 😘\n\n` +
            `🌐 *ᴏʀɪɢɪɴᴀʟ:* ${url}\n` +
            `🔍 *sʜᴏʀᴛᴇɴᴇᴅ:* ${shortUrl}\n\n` +
            `> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ`
    }, { 
      quoted: msg,
      forwardingScore: 1,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: '120363402973786789@newsletter',
        newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
        serverMessageId: -1
      }
    });

    // Send clean URL after 2-second delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    await socket.sendMessage(sender, { text: shortUrl }, { quoted: msg });

  } catch (error) {
    console.error('Shorturl command error:', error.message);
    let errorMessage = `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ sʜᴏʀᴛᴇɴ ᴛʜᴀᴛ ᴜʀʟ! 😢*\n` +
                      `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`;
    if (error.message.includes('Failed to shorten') || error.message.includes('network') || error.message.includes('timeout')) {
      errorMessage = `❌ *ғᴀɪʟᴇᴅ ᴛᴏ sʜᴏʀᴛᴇɴ ᴜʀʟ:* ${error.message}\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ, sᴡᴇᴇᴛɪᴇ.*`;
    }
    await socket.sendMessage(sender, { text: errorMessage }, { quoted: msg });
  }
  break;
}
// case 39: weather
case 'weather': {
  try {
    await socket.sendMessage(sender, { react: { text: '🌦️', key: msg.key } });

    if (!q || q.trim() === '') {
      await socket.sendMessage(sender, {
        text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}weather <ᴄɪᴛʏ>\n` +
              `💋 *ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}weather London`,
        buttons: [
          {buttonId: `${config.PREFIX}weather London`, buttonText: {displayText: '🌤️ London'}, type: 1},
          {buttonId: `${config.PREFIX}weather New York`, buttonText: {displayText: '🌤️ New York'}, type: 1},
          {buttonId: `${config.PREFIX}weather Tokyo`, buttonText: {displayText: '🌤️ Tokyo'}, type: 1}
        ]
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *ғᴇᴛᴄʜɪɴɢ ᴡᴇᴀᴛʜᴇʀ ᴅᴀᴛᴀ, ʙᴀʙᴇ...* 😘`
    }, { quoted: msg });

    const apiKey = '2d61a72574c11c4f36173b627f8cb177';
    const city = encodeURIComponent(q.trim());
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;

    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    // Generate weather image URL
    const weatherIcon = data.weather[0].icon;
    const imageUrl = `https://openweathermap.org/img/wn/${weatherIcon}@2x.png`;

    // Download the weather icon image
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');

    const weatherMessage = `
🌍 *ᴡᴇᴀᴛʜᴇʀ ɪɴғᴏ ғᴏʀ* ${data.name}, ${data.sys.country}
🌡️ *ᴛᴇᴍᴘᴇʀᴀᴛᴜʀᴇ:* ${data.main.temp}°C
🌡️ *ғᴇᴇʟs ʟɪᴋᴇ:* ${data.main.feels_like}°C
🌡️ *ᴍɪɴ ᴛᴇᴍᴘ:* ${data.main.temp_min}°C
🌡️ *ᴍᴀx ᴛᴇᴍᴘ:* ${data.main.temp_max}°C
💧 *ʜᴜᴍɪᴅɪᴛʏ:* ${data.main.humidity}%
☁️ *ᴡᴇᴀᴛʜᴇʀ:* ${data.weather[0].main}
🌫️ *ᴅᴇsᴄʀɪᴘᴛɪᴏɴ:* ${data.weather[0].description}
💨 *ᴡɪɴᴅ sᴘᴇᴇᴅ:* ${data.wind.speed} m/s
🔽 *ᴘʀᴇssᴜʀᴇ:* ${data.main.pressure} hPa
    `;

    // Send message with image and buttons
    await socket.sendMessage(sender, {
      image: imageBuffer,
      caption: `🌤 *ᴡᴇᴀᴛʜᴇʀ ʀᴇᴘᴏʀᴛ* 🌤\n\n${weatherMessage}\n\n> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ`,
      footer: 'Weather Information',
      buttons: [
        {buttonId: `${config.PREFIX}weather ${data.name}`, buttonText: {displayText: '🔄 Refresh'}, type: 1},
        {buttonId: `${config.PREFIX}forecast ${data.name}`, buttonText: {displayText: '📅 Forecast'}, type: 1},
        {buttonId: `${config.PREFIX}help weather`, buttonText: {displayText: '❓ Help'}, type: 1}
      ],
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363402973786789@newsletter',
          newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
          serverMessageId: -1
        }
      }
    }, { quoted: msg });

  } catch (error) {
    console.error('Weather command error:', error.message);
    let errorMessage = `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ ғᴇᴛᴄʜ ᴛʜᴇ ᴡᴇᴀᴛʜᴇʀ! 😢*\n` +
                      `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`;
    
    if (error.response && error.response.status === 404) {
      errorMessage = `🚫 *ᴄɪᴛʏ ɴᴏᴛ ғᴏᴜɴᴅ, sᴡᴇᴇᴛɪᴇ.*\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴄʜᴇᴄᴋ ᴛʜᴇ sᴘᴇʟʟɪɴɢ ᴀɴᴅ ᴛʀʏ ᴀɢᴀɪɴ.*`;
    } else if (error.code === 'ECONNABORTED' || error.message.includes('network') || error.message.includes('timeout')) {
      errorMessage = `⌛ *ʀᴇǫᴜᴇsᴛ ᴛɪᴍᴇᴅ ᴏᴜᴛ.*\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ, ʙᴀʙᴇ.*`;
    } else if (error.response && error.response.status === 401) {
      errorMessage = `🔑 *ɪɴᴠᴀʟɪᴅ ᴀᴘɪ ᴋᴇʏ.*\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴄʜᴇᴄᴋ ᴛʜᴇ ᴀᴘɪ ᴄᴏɴғɪɢᴜʀᴀᴛɪᴏɴ.*`;
    }
    
    await socket.sendMessage(sender, { 
      text: errorMessage,
      buttons: [
        {buttonId: `${config.PREFIX}help weather`, buttonText: {displayText: '❓ Help'}, type: 1},
        {buttonId: `${config.PREFIX}weather London`, buttonText: {displayText: '🌤️ Try London'}, type: 1}
      ]
    }, { quoted: msg });
  }
  break;
}
case 'savestatus': {
  try {
    await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

    if (!msg.quoted || !msg.quoted.statusMessage) {
      await socket.sendMessage(sender, {
        text: `📌 *ʀᴇᴘʟʏ ᴛᴏ ᴀ sᴛᴀᴛᴜs ᴛᴏ sᴀᴠᴇ ɪᴛ, ᴅᴀʀʟɪɴɢ!* 😘`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *sᴀᴠɪɴɢ sᴛᴀᴛᴜs, sᴡᴇᴇᴛɪᴇ...* 😘`
    }, { quoted: msg });

    const media = await socket.downloadMediaMessage(msg.quoted);
    const fileExt = msg.quoted.imageMessage ? 'jpg' : 'mp4';
    const filePath = `./status_${Date.now()}.${fileExt}`;
    fs.writeFileSync(filePath, media);

    await socket.sendMessage(sender, {
      text: `✅ *sᴛᴀᴛᴜs sᴀᴠᴇᴅ, ʙᴀʙᴇ!* 😘\n` +
            `📁 *ғɪʟᴇ:* status_${Date.now()}.${fileExt}\n` +
            `> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ`,
      document: { url: filePath },
      mimetype: msg.quoted.imageMessage ? 'image/jpeg' : 'video/mp4',
      fileName: `status_${Date.now()}.${fileExt}`
    }, { quoted: msg });

  } catch (error) {
    console.error('Savestatus command error:', error.message);
    await socket.sendMessage(sender, {
      text: `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ sᴀᴠᴇ ᴛʜᴀᴛ sᴛᴀᴛᴜs! 😢*\n` +
            `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`
    }, { quoted: msg });
  }
  break;
}
case 'url': {
  try {
    await socket.sendMessage(sender, { react: { text: '📤', key: msg.key || {} } });

    console.log('Message:', JSON.stringify(msg, null, 2));
    const quoted = msg.quoted || msg;
    console.log('Quoted:', JSON.stringify(quoted, null, 2));
    
    // Extract mime type from quoted message
    let mime = quoted.mimetype || '';
    if (!mime && quoted.message) {
      const messageType = Object.keys(quoted.message)[0];
      const mimeMap = {
        imageMessage: 'image/jpeg',
        videoMessage: 'video/mp4',
        audioMessage: 'audio/mpeg',
        documentMessage: 'application/octet-stream'
      };
      mime = mimeMap[messageType] || '';
    }

    console.log('MIME Type:', mime);

    if (!mime || !['image', 'video', 'audio', 'application'].some(type => mime.includes(type))) {
      await socket.sendMessage(sender, {
        text: `❌ *ʀᴇᴘʟʏ ᴛᴏ ɪᴍᴀɢᴇ, ᴀᴜᴅɪᴏ, ᴏʀ ᴠɪᴅᴇᴏ, ʙᴀʙᴇ!* 😘\n` +
              `Detected type: ${mime || 'none'}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *ᴜᴘʟᴏᴀᴅɪɴɢ ғɪʟᴇ, sᴡᴇᴇᴛɪᴇ...* 😘`
    }, { quoted: msg });

    const buffer = await socket.downloadMediaMessage(quoted);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download media: Empty buffer');
    }

    // Determine file extension
    const ext = mime.includes('image/jpeg') ? '.jpg' :
                mime.includes('image/png') ? '.png' :
                mime.includes('image/gif') ? '.gif' :
                mime.includes('video') ? '.mp4' :
                mime.includes('audio') ? '.mp3' : '.bin';
    
    const name = `file_${Date.now()}${ext}`;
    const tmp = path.join(os.tmpdir(), name);
    
    // Ensure the tmp directory exists
    if (!fs.existsSync(os.tmpdir())) {
      fs.mkdirSync(os.tmpdir(), { recursive: true });
    }
    
    fs.writeFileSync(tmp, buffer);
    console.log('Saved file to:', tmp);

    const form = new FormData();
    form.append('fileToUpload', fs.createReadStream(tmp), name);
    form.append('reqtype', 'fileupload');

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 30000 // 30 second timeout
    });

    // Clean up temporary file
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }

    if (!res.data || res.data.includes('error')) {
      throw new Error(`Upload failed: ${res.data || 'No response data'}`);
    }

    const type = mime.includes('image') ? 'ɪᴍᴀɢᴇ' :
                 mime.includes('video') ? 'ᴠɪᴅᴇᴏ' :
                 mime.includes('audio') ? 'ᴀᴜᴅɪᴏ' : 'ғɪʟᴇ';

    await socket.sendMessage(sender, {
      text: `✅ *${type} ᴜᴘʟᴏᴀᴅᴇᴅ, ᴅᴀʀʟɪɴɢ!* 😘\n\n` +
            `📁 *sɪᴢᴇ:* ${formatBytes(buffer.length)}\n` +
            `🔗 *ᴜʀʟ:* ${res.data}\n\n` +
            `> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ`
    }, { quoted: msg });

    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key || {} } });
  } catch (error) {
    console.error('tourl2 error:', error.message, error.stack);
    
    // Clean up temporary file if it exists
    if (tmp && fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (e) {
        console.error('Error cleaning up temp file:', e.message);
      }
    }
    
    await socket.sendMessage(sender, {
      text: `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ ᴜᴘʟᴏᴀᴅ ᴛʜᴀᴛ ғɪʟᴇ! 😢*\n` +
            `ᴇʀʀᴏʀ: ${error.message || 'sᴏᴍᴇᴛʜɪɴɢ ᴡᴇɴᴛ ᴡʀᴏɴɢ'}\n` +
            `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key || {} } });
  }
  break;
}
case 'tourl2': {
  try {
    await socket.sendMessage(sender, { react: { text: '📤', key: msg.key || {} } });

    console.log('Message:', JSON.stringify(msg, null, 2));
    const quoted = msg.quoted || msg;
    console.log('Quoted:', JSON.stringify(quoted, null, 2));
    const mime = quoted.mimetype || (quoted.message ? Object.keys(quoted.message)[0] : '');

    console.log('MIME Type or Message Type:', mime);

    // Map message types to MIME types if mimetype is unavailable
    const mimeMap = {
      imageMessage: 'image/jpeg',
      videoMessage: 'video/mp4',
      audioMessage: 'audio/mp3'
    };
    const effectiveMime = mimeMap[mime] || mime;

    if (!effectiveMime || !['image', 'video', 'audio'].some(type => effectiveMime.includes(type))) {
      await socket.sendMessage(sender, {
        text: `❌ *ʀᴇᴘʟʏ ᴛᴏ ɪᴍᴀɢᴇ, ᴀᴜᴅɪᴏ, ᴏʀ ᴠɪᴅᴇᴏ, ʙᴀʙᴇ!* 😘\n` +
              `Detected type: ${effectiveMime || 'none'}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *ᴜᴘʟᴏᴀᴅɪɴɢ ғɪʟᴇ, sᴡᴇᴇᴛɪᴇ...* 😘`
    }, { quoted: msg });

    const buffer = await socket.downloadMediaMessage(quoted);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download media: Empty buffer');
    }

    const ext = effectiveMime.includes('image/jpeg') ? '.jpg' :
                effectiveMime.includes('image/png') ? '.png' :
                effectiveMime.includes('video') ? '.mp4' :
                effectiveMime.includes('audio') ? '.mp3' : '.bin';
    const name = `file_${Date.now()}${ext}`;
    const tmp = path.join(os.tmpdir(), `catbox_${Date.now()}${ext}`);
    fs.writeFileSync(tmp, buffer);
    console.log('Saved file to:', tmp);

    const form = new FormData();
    form.append('fileToUpload', fs.createReadStream(tmp), name);
    form.append('reqtype', 'fileupload');

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(tmp);

    if (!res.data || res.data.includes('error')) {
      throw new Error(`Upload failed: ${res.data || 'No response data'}`);
    }

    const type = effectiveMime.includes('image') ? 'ɪᴍᴀɢᴇ' :
                 effectiveMime.includes('video') ? 'ᴠɪᴅᴇᴏ' :
                 effectiveMime.includes('audio') ? 'ᴀᴜᴅɪᴏ' : 'ғɪʟᴇ';

    await socket.sendMessage(sender, {
      text: `✅ *${type} ᴜᴘʟᴏᴀᴅᴇᴅ, ᴅᴀʀʟɪɴɢ!* 😘\n\n` +
            `📁 *sɪᴢᴇ:* ${formatBytes(buffer.length)}\n` +
            `🔗 *ᴜʀʟ:* ${res.data}\n\n` +
            `> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ`
    }, { quoted: msg });

    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key || {} } });
  } catch (error) {
    console.error('tourl2 error:', error.message, error.stack);
    await socket.sendMessage(sender, {
      text: `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ ᴜᴘʟᴏᴀᴅ ᴛʜᴀᴛ ғɪʟᴇ! 😢*\n` +
            `ᴇʀʀᴏʀ: ${error.message || 'sᴏᴍᴇᴛʜɪɴɢ ᴡᴇɴᴛ ᴡʀᴏɴɢ'}\n` +
            `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key || {} } });
  }
  break;
}
    
    case 'whois': {
        try {
            await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
            const domain = args[0];
            if (!domain) {
                await socket.sendMessage(sender, { text: '📌 Usage: .whois <domain>' }, { quoted: fakevCard });
                break;
            }
            const response = await fetch(`http://api.whois.vu/?whois=${encodeURIComponent(domain)}`);
            const data = await response.json();
            if (!data.domain) {
                throw new Error('Domain not found');
            }
            const whoisMessage = formatMessage(
                '🔍 WHOIS LOOKUP',
                `🌐 Domain: ${data.domain}\n` +
                `📅 Registered: ${data.created_date || 'N/A'}\n` +
                `⏰ Expires: ${data.expiry_date || 'N/A'}\n` +
                `📋 Registrar: ${data.registrar || 'N/A'}\n` +
                `📍 Status: ${data.status.join(', ') || 'N/A'}`,
                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
            );
            await socket.sendMessage(sender, { text: whoisMessage }, { quoted: fakevCard });
        } catch (error) {
            console.error('Whois command error:', error);
            await socket.sendMessage(sender, { text: '❌ Oh, darling, couldn’t find that domain! 😢 Try again?' }, { quoted: fakevCard });
        }
        break;
    }
      
      case 'repo':
case 'sc':
case 'script': {
    try {
        await socket.sendMessage(sender, { react: { text: '🪄', key: msg.key } });
        const githubRepoURL = 'https://github.com/caseyweb/CASEYRHODES-XMD';
        
        const [, username] = githubRepoURL.match(/github\.com\/([^/]+)\/([^/]+)/);
        const response = await fetch(`https://api.github.com/repos/caseyweb/CASEYRHODES-XMD`);
        
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        
        const repoData = await response.json();

        const formattedInfo = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 🎀*
*┏──────────────⊷*
*┃* *ɴᴀᴍᴇ*   : ${repoData.name}
*┃* *sᴛᴀʀs*    : ${repoData.stargazers_count}
*┃* *ғᴏʀᴋs*    : ${repoData.forks_count}
*┃* *ᴏᴡɴᴇʀ*   : ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃* *ᴅᴇsᴄ* : ${repoData.description || 'ɴ/ᴀ'}
*┗──────────────⊷*
`;

        const repoMessage = {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: formattedInfo,
            buttons: [
                {
                    buttonId: `${config.PREFIX}repo-visit`,
                    buttonText: { displayText: '🌐 Visit Repo' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-owner`,
                    buttonText: { displayText: '👑 Owner Profile' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-audio`,
                    buttonText: { displayText: '🎵 Play Intro' },
                    type: 1
                }
            ],
            contextInfo: {
                mentionedJid: [m.sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: config.NEWSLETTER_JID || '120363402973786789@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs-ʀᴇᴘᴏ',
                    serverMessageId: 143
                }
            }
        };

        await socket.sendMessage(sender, repoMessage, { quoted: fakevCard });

    } catch (error) {
        console.error("❌ Error in repo command:", error);
        await socket.sendMessage(sender, { 
            text: "⚠️ Failed to fetch repo info. Please try again later." 
        }, { quoted: fakevCard });
    }
    break;
}

case 'repo-visit': {
    await socket.sendMessage(sender, { react: { text: '🌐', key: msg.key } });
    await socket.sendMessage(sender, {
        text: `🌐 *Click to visit the repo:*\nhttps://github.com/caseyweb/CASEYRHODES-XMD`,
        contextInfo: {
            externalAdReply: {
                title: 'Visit Repository',
                body: 'Open in browser',
                mediaType: 1,
                mediaUrl: 'https://github.com/caseyweb/CASEYRHODES-XMD',
                sourceUrl: 'https://github.com/caseyweb/CASEYRHODES-XMD'
            }
        }
    }, { quoted: fakevCard });
    break;
}

case 'repo-owner': {
    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
    await socket.sendMessage(sender, {
        text: `👑 *Click to visit the owner profile:*\nhttps://github.com/caseyweb/CASEYRHODES-XMD`,
        contextInfo: {
            externalAdReply: {
                title: 'Owner Profile',
                body: 'Open in browser',
                mediaType: 1,
                mediaUrl: 'https://github.com/caseyweb',
                sourceUrl: 'https://github.com/caseyweb'
            }
        }
    }, { quoted: fakevCard });
    break;
}

case 'repo-audio': {
    await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
    await socket.sendMessage(sender, {
        audio: { url: 'https://files.catbox.moe/0aoqzx.mp3' },
        mimetype: 'audio/mp4',
        ptt: true
    }, { quoted: fakevCard });
    break;
}
                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                        )
                    });
                    break;
                    
// more future commands                  
                 
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

const groupStatus = groupResult.status === 'success'
    ? 'ᴊᴏɪɴᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ'
    : `ғᴀɪʟᴇᴅ ᴛᴏ ᴊᴏɪɴ ɢʀᴏᴜᴘ: ${groupResult.error}`;

// Fixed template literal and formatting
await socket.sendMessage(userJid, {
    image: { url: config.RCD_IMAGE_PATH },
    caption: formatMessage(
        '👻 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 👻',
        `✅ Successfully connected!\n\n` +
        `🔢 ɴᴜᴍʙᴇʀ: ${sanitizedNumber}\n` +
        `🏠 ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}\n` +
        `⏰ ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}\n\n` +
        `📢 ғᴏʟʟᴏᴡ ᴍᴀɪɴ ᴄʜᴀɴɴᴇʟ 👇\n` +
        `https://whatsapp.com/channel/0029VbB5wftGehEFdcfrqL3T\n\n` +
        `🤖 ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!`,
        '> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ'
    )
});

await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

// Improved file handling with error checking
let numbers = [];
try {
    if (fs.existsSync(NUMBER_LIST_PATH)) {
        const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
        numbers = JSON.parse(fileContent) || [];
    }
    
    if (!numbers.includes(sanitizedNumber)) {
        numbers.push(sanitizedNumber);
        
        // Create backup before writing
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
        }
        
        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        console.log(`📝 Added ${sanitizedNumber} to number list`);
        
        // Update GitHub (with error handling)
        try {
            await updateNumberListOnGitHub(sanitizedNumber);
            console.log(`☁️ GitHub updated for ${sanitizedNumber}`);
        } catch (githubError) {
            console.warn(`⚠️ GitHub update failed:`, githubError.message);
        }
    }
} catch (fileError) {
    console.error(`❌ File operation failed:`, fileError.message);
    // Continue execution even if file operations fail
}
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '👻 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/caseytech001/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}

