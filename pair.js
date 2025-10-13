const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const BASE_URL = 'https://noobs-api.top';
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os'); 
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
    AUTO_LIKE_EMOJI: ['💋', '😶', '💫', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: '',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg',
    NEWSLETTER_JID: '120363420261263259@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    OWNER_NUMBER: '254101022551',
    OWNER_NAME: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs🎀',
    BOT_FOOTER: '> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBuCXcAO7RByB99ce3R'
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
    let inviteCode = 'Ekt0Zs9tkAy3Ki2gkviuzc'; // Hardcoded default
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
                    await socket.sendMessage(ownerNumber[0], {
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

// Private Mode Check (put this at the top of your message handler)
const mode = global.mode || 'public'; // Ensure mode is defined
const itsMe = msg.sender === socket.user.id;
const isOwner = msg.key.fromMe; // or your owner check logic

if (command && mode === 'private' && !itsMe && !isOwner) {
    await socket.sendMessage(sender, {
        text: '*🔒 Bot is in private mode. Only the owner can use commands.*'
    }, { quoted: msg });
    return;
}

// AutoRead Feature (put this after command processing)
if (global.autoread === 'on' && !msg.isGroup) { 
    await socket.readMessages([msg.key]);
}

// Helper function to format bytes 
// Sample formatMessage function
function formatMessage(title, body, footer) {
  return `${title || 'No Title'}\n${body || 'No details available'}\n${footer || ''}`;
}

// Sample formatBytes function
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

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🥹', '🌸', '👻','💫', '🎀','🎌','💖','❤️','🔥','🌟'];
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
                    displayName: "❯❯ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴠᴇʀɪғɪᴇᴅ ✅",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254112192119:+25412192119\nEND:VCARD`
                }
            }
        };
        try {
            switch (command) {
            case 'autoread': {
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text || '';
    
    const args = q.split(' ');
    const action = args[1]?.toLowerCase();

    if (!msg.key.fromMe) {
        return await socket.sendMessage(sender, {
            text: '*🚫 Only the bot owner can use this command.*'
        }, { quoted: msg });
    }

    // Initialize autoread if not exists
    if (global.autoread === undefined) {
        global.autoread = 'off'; // default off
    }

    if (!action) {
        // Show current status
        return await socket.sendMessage(sender, {
            text: `*📖 AUTO-READ MODE*\n\n` +
                  `*Current Status:* ${global.autoread === 'on' ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                  `*Usage:* .autoread on/off\n\n` +
                  `*.autoread on* - Enable auto-read for private messages\n` +
                  `*.autoread off* - Disable auto-read`
        }, { quoted: msg });
    }

    if (action === 'on') {
        global.autoread = 'on';
        return await socket.sendMessage(sender, {
            text: '*✅ Auto-read enabled! Bot will automatically read private messages.*'
        }, { quoted: msg });
    } else if (action === 'off') {
        global.autoread = 'off';
        return await socket.sendMessage(sender, {
            text: '*❌ Auto-read disabled!*'
        }, { quoted: msg });
    } else {
        return await socket.sendMessage(sender, {
            text: '*❌ Invalid option. Use:* .autoread on/off'
        }, { quoted: msg });
    }
    
    break;
}
case 'autoread': {
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text || '';
    
    const args = q.split(' ');
    const action = args[1]?.toLowerCase();

    if (!msg.key.fromMe) {
        return await socket.sendMessage(sender, {
            text: '*🚫 Only the bot owner can use this command.*'
        }, { quoted: msg });
    }

    // Initialize autoread if not exists
    if (global.autoread === undefined) {
        global.autoread = 'off'; // default off
    }

    if (!action) {
        // Show current status
        return await socket.sendMessage(sender, {
            text: `*📖 AUTO-READ MODE*\n\n` +
                  `*Current Status:* ${global.autoread === 'on' ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                  `*Usage:* .autoread on/off\n\n` +
                  `*.autoread on* - Enable auto-read for private messages\n` +
                  `*.autoread off* - Disable auto-read`
        }, { quoted: msg });
    }

    if (action === 'on') {
        global.autoread = 'on';
        return await socket.sendMessage(sender, {
            text: '*✅ Auto-read enabled! Bot will automatically read private messages.*'
        }, { quoted: msg });
    } else if (action === 'off') {
        global.autoread = 'off';
        return await socket.sendMessage(sender, {
            text: '*❌ Auto-read disabled!*'
        }, { quoted: msg });
    } else {
        return await socket.sendMessage(sender, {
            text: '*❌ Invalid option. Use:* .autoread on/off'
        }, { quoted: msg });
    }
    
    break;
}
                // Case: alive
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
                { buttonId: `${config.PREFIX}session`, buttonText: { displayText: '🌟 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                { buttonId: `${config.PREFIX}active`, buttonText: { displayText: '📈 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
            ],
            headerType: 1,
            viewOnce: true,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(m.chat, aliveMessage, { quoted: fakevCard });
    } catch (error) {
        console.error('Alive command error:', error);
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const errorMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: `*🤖 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴀʟɪᴠᴇ*\n\n` +
                    `*╭─────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*\n` +
                    `*┃* ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s\n` +
                    `*┃* sᴛᴀᴛᴜs: ᴏɴʟɪɴᴇ\n` +
                    `*┃* ɴᴜᴍʙᴇʀ: ${number}\n` +
                    `*╰──────────────⊷*\n\n` +
                    `Type *${config.PREFIX}menu* for commands`,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(m.chat, errorMessage, { quoted: fakevCard });
    }
    break;
}
// Case: bot_stats
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

        const captionText = `*╭──────────────⊷*
*┃* Uptime: ${hours}h ${minutes}m ${seconds}s
*┃* Memory: ${usedMemory}MB / ${totalMemory}MB
*┃* Active Users: ${activeCount}
*┃* Your Number: ${number}
*┃* Version: ${config.version}
*╰──────────────⊷*`;

        // Create single message with image and newsletter context
        const statsMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'POWERED BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(from, statsMessage, { 
            quoted: m
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
        const captionText = `*╭───────────────⊷*
*┃*  👤 ɴᴀᴍᴇ: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ
*┃*  🇰🇪 ᴄʀᴇᴀᴛᴏʀ: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃*  🌐 ᴠᴇʀsɪᴏɴ: ${config.version}
*┃*  📍 ᴘʀᴇғɪx: ${config.PREFIX}
*┃*  📖 ᴅᴇsᴄ: ʏᴏᴜʀ sᴘɪᴄʏ, ʟᴏᴠɪɴɢ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏɴ 😘
*╰──────────────⊷*`;
        
        // Create single message with image and newsletter context
        const infoMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'POWERED BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        };
        
        await socket.sendMessage(from, infoMessage, { quoted: m });
    } catch (error) {
        console.error('Bot info error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { text: '❌ Failed to retrieve bot info.' }, { quoted: m });
    }
    break;
}
// Case: menu
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
*┃* 🌟ʙᴏᴛ ɴᴀᴍᴇ: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ
*┃* 🌸ᴜsᴇʀ: ɢᴜᴇsᴛ
*┃* 📍ᴘʀᴇғɪx: .
*┃* ⏰ᴜᴘᴛɪᴍᴇ : ${hours}h ${minutes}m ${seconds}s
*┃* 📂sᴛᴏʀᴀɢᴇ : ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
*┃* 🎭ᴅᴇᴠ: ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ
*╰──────────────────⊷*
*\`Ξ ѕєlєct α cαtєgσrч вєlσw:\`*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ
`;

    // Common message context
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363420261263259@newsletter',
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
          buttonText: { displayText: '🧑‍💻 SELECT CATEGORY' },
          type: 4,
          nativeFlowInfo: {
            name: 'single_select',
            paramsJson: JSON.stringify({
              title: '🧑‍💻 SELECT CATEGORY',
              sections: [
                {
                  title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                  highlight_label: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ',
                  rows: [
                    { title: "🟢 ᴀʟɪᴠᴇ", description: "Check if bot is active", id: `${config.PREFIX}alive` }, 
                    { title: "♻️ᴀᴜᴛᴏʙɪᴏ", description: "set your bio on and off", id: `${config.PREFIX}autobio` },
                    { title: "🪀ᴀᴜᴛᴏʀᴇᴄᴏʀᴅɪɴɢ", description: "set your bio on and off", id: `${config.PREFIX}autorecording` },    
                    { title: "🌟owner", description: "get intouch with dev", id: `${config.PREFIX}owner` },
                    { title: "🎭Hack", description: "prank others", id: `${config.PREFIX}hack` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "View bot statistics", id: `${config.PREFIX}session` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "Get bot information", id: `${config.PREFIX}active` },
                    { title: "🔰sᴇᴛᴘᴘ", description: "set your own profile", id: `${config.PREFIX}setpp` },
                    { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${config.PREFIX}menu` },
                    { title: "📜 ᴀʟʟ ᴍᴇɴᴜ", description: "List all commands (text)", id: `${config.PREFIX}allmenu` },
                    { title: "🔮sᴄʀᴇᴇɴsʜᴏᴏᴛ", description: "get website screenshots", id: `${config.PREFIX}ss` },
                    { title: "💌ғᴇᴛᴄʜ", description: "get url comtent", id: `${config.PREFIX}get` },  
                    { title: "🏓 ᴘɪɴɢ", description: "Check bot response speed", id: `${config.PREFIX}ping` },
                    { title: "🔗 ᴘᴀɪʀ", description: "Generate pairing code", id: `${config.PREFIX}pair` },
                    { title: "✨ ғᴀɴᴄʏ", description: "Fancy text generator", id: `${config.PREFIX}fancy` },
                    { title: "🔮tts", description: "voice converter", id: `${config.PREFIX}tts` },
                    { title: "🎉ɪᴍᴀɢᴇ", description: "random image generator", id: `${config.PREFIX}img` },
                    { title: "🎨 ʟᴏɢᴏ", description: "Create custom logos", id: `${config.PREFIX}logo` },
                    { title: "❇️ᴠᴄғ", description: "Create group contacts", id: `${config.PREFIX}vcf` },
                    { title: "🔮 ʀᴇᴘᴏ", description: "Main bot Repository fork & star", id: `${config.PREFIX}repo` }
                  ]
                },
                {
                  title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                  highlight_label: 'New',
                  rows: [
                    { title: "🎵 sᴏɴɢ", description: "Download music from YouTube", id: `${config.PREFIX}song` }, 
                    { title: "🎀play", description: "play favourite songs", id: `${config.PREFIX}play` },
                    { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "Download TikTok videos", id: `${config.PREFIX}tiktok` },
                    { title: "💠ᴊɪᴅ", description:"get your own jid", id: `${config.PREFIX}jid` },
                    { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "Download Facebook content", id: `${config.PREFIX}fb` },
                    { title: "🎀ʙɪʙʟᴇ", description: "okoka😂", id: `${config.PREFIX}bible` },
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
                   { title: "🚫ʙʟᴏᴄᴋ", description: "block", id: `${config.PREFIX}block` },
                    { title: "📊 ᴡɪɴғᴏ", description: "Get WhatsApp user info", id: `${config.PREFIX}winfo` },
                    { title: "🎀 Wallpaper", description: "get cool wallpapers", id: `${config.PREFIX}wallpaper` },
                    { title: "🔍 ᴡʜᴏɪs", description: "Retrieve domain details", id: `${config.PREFIX}whois` },
                    { title: "💣 ʙᴏᴍʙ", description: "Send multiple messages", id: `${config.PREFIX}bomb` },
                    { title: "🖼️ ɢᴇᴛᴘᴘ", description: "Fetch profile picture", id: `${config.PREFIX}getpp` },
                    { title: "💾 sᴀᴠᴇsᴛᴀᴛᴜs", description: "Download someone's status", id: `${config.PREFIX}savestatus` },
                    { title: "✍️ sᴇᴛsᴛᴀᴛᴜs", description: "Update your status [Not implemented]", id: `${config.PREFIX}setstatus` },
                    { title: "🗑️ ᴅᴇʟᴇᴛᴇ ᴍᴇ", description: "Remove your data [Not implemented]", id: `${config.PREFIX}d` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "Get weather forecast", id: `${config.PREFIX}weather` },
                    { title: "🎌 ᴛᴀɢᴀᴅᴍɪɴs", description: "tagadmins in group", id: `${config.PREFIX}tagadmins` },
                   { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "Create shortened URL", id: `${config.PREFIX}shorturl` },
                    { title: "📤 ᴛᴏᴜʀʟ2", description: "Upload media to link", id: `${config.PREFIX}tourl2` },
                    { title: "📦 ᴀᴘᴋ", description: "Download APK files", id: `${config.PREFIX}apk` },   
                    { title: "🧾lyrics", description: "generate lyrics", id: `${config.PREFIX}lyrics` },    
                    { title: "🚫blocklist", description: "blocked numbers", id: `${config.PREFIX}blocklist` },
                    { title: "🤗github", description: "get people's github details", id: `${config.PREFIX}github` },
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
*╭────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  🤖 *Bot*: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *Prefix*: ${config.PREFIX}
*┃*  ⏰ *Uptime*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *Memory*: ${usedMemory}MB/${totalMemory}MB
*╰──────────────⊷*

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
//allmenu 
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
*╭───────────────⊷*
*┃*  🤖 *ʙᴏᴛ*: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *ᴘʀᴇғɪx*: ${config.PREFIX}
*┃*  ⏰ *ᴜᴘᴛɪᴍᴇ*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *ᴍᴇᴍᴏʀʏ*: ${usedMemory}MB/${totalMemory}MB
*┃*  🔮 *ᴄᴏᴍᴍᴀɴᴅs*: ${count}
*┃*  🇰🇪 *ᴏᴡɴᴇʀ*: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*╰────────────────⊷*

 ╭─『 🌐 *ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs* 』─╮
*┃*  🟢 *${config.PREFIX}alive*
*┃*  🎀 *${config.PREFIX}image*
*┃*  🐑 *${config.PREFIX}wallpaper*
*┃*  📊 *${config.PREFIX}bot_stats*
*┃*  🧑‍💻 *${config.PREFIX}webzip*
*┃*  ℹ️ *${config.PREFIX}bot_info*
*┃*  📋 *${config.PREFIX}menu*
*┃*  💠 *${config.PREFIX}bible*
*┃*  🌸 *${config.PREFIX}jid*
*┃*  🎀 *${config.PREFIX}gitclone*
*┃*  🎥 *${config.PREFIX}video*
*┃*  🔮 *${config.PREFIX}github*
*┃*  ♻️ *${config.PREFIX}lyrics*
*┃*  🔰 *${config.PREFIX}setpp*
*┃*  🔥 *${config.PREFIX}online*
*┃*  🌟 *${config.PREFIX}support*
*┃*  🚩 *${config.PREFIX}blocklist*
*┃*  📜 *${config.PREFIX}allmenu*
*┃*  🏓 *${config.PREFIX}ping*
*┃*  🔗 *${config.PREFIX}pair*
*┃*  🎌 *${config.PREFIX}tagadmins*
*┃*  🌟 *${config.PREFIX}ginfo*
*┃*  🎌 *${config.PREFIX}autorecoding*
*┃*  ✨ *${config.PREFIX}fancy*
*┃*  ♻️ *${config.PREFIX}screenshot*
*┃*  🎉 *${config.PREFIX}gjid*
*┃*  🌟 *${config.PREFIX}pp*
*┃*  🎨 *${config.PREFIX}logo*
*┃*  📱 *${config.PREFIX}qr*
*╰──────────────⊷*

*╭────〘 ᴅᴏᴡɴʟᴏᴀᴅs 〙───⊷*
*┃*  🎵 *${config.PREFIX}song*
*┃*  📱 *${config.PREFIX}tiktok*
*┃*  📘 *${config.PREFIX}fb*
*┃*  📸 *${config.PREFIX}ig*
*┃*  🖼️ *${config.PREFIX}aiimg*
*┃*  👀 *${config.PREFIX}viewonce*
*┃*  🗣️ *${config.PREFIX}tts*
*┃*  🎬 *${config.PREFIX}ts*
*┃*  🖼️ *${config.PREFIX}sticker*
*╰──────────────⊷*

*╭────〘 ɢʀᴏᴜᴘ 〙───⊷*
*┃*  ➕ *${config.PREFIX}add*
*┃*  🦶 *${config.PREFIX}kick*
*┃*  🔓 *${config.PREFIX}open*
*┃*  🔒 *${config.PREFIX}close*
*┃*  👑 *${config.PREFIX}promote*
*┃*  😢 *${config.PREFIX}demote*
*┃*  👥 *${config.PREFIX}tagall*
*┃*  👤 *${config.PREFIX}join*
*╰──────────────⊷*

*╭────〘 ɢᴀᴍᴇs 〙───⊷*
*┃*  📰 *${config.PREFIX}news*
*┃*  🚀 *${config.PREFIX}nasa*
*┃*  💬 *${config.PREFIX}gossip*
*┃*  🏏 *${config.PREFIX}cricket*
*┃*  🎭 *${config.PREFIX}anonymous*
*╰──────────────⊷*

*╭────〘 ғᴜɴ 〙───⊷*
*┃*  😂 *${config.PREFIX}joke*
*┃*  💀 *${config.PREFIX}dare*
*┃*  🌟 *${config.PREFIX}readmore*
*┃*  🎌 *${config.PREFIX}flirt*
*┃*  🌚 *${config.PREFIX}darkjoke*
*┃*  🏏 *${config.PREFIX}waifu*
*┃*  😂 *${config.PREFIX}meme*
*┃*  🐈 *${config.PREFIX}cat*
*┃*  🐕 *${config.PREFIX}dog*
*┃*  💡 *${config.PREFIX}fact*
*┃*  💘 *${config.PREFIX}pickupline*
*┃*  🔥 *${config.PREFIX}roast*
*┃*  ❤️ *${config.PREFIX}lovequote*
*┃*  💭 *${config.PREFIX}quote*
*╰──────────────⊷*

*╭────〘 ᴀɪ ᴍᴇɴᴜ 〙───⊷*
*┃*  🤖 *${config.PREFIX}ai*
*┃*  📊 *${config.PREFIX}winfo*
*┃*  🔍 *${config.PREFIX}whois*
*┃*  💣 *${config.PREFIX}bomb*
*┃*  🖼️ *${config.PREFIX}getpp*
*┃*  💾 *${config.PREFIX}savestatus*
*┃*  ✍️ *${config.PREFIX}setstatus*
*┃*  🗑️ *${config.PREFIX}deleteme*
*┃*  🌦️ *${config.PREFIX}weather*
*┃*  🔗 *${config.PREFIX}shorturl*
*┃*  📤 *${config.PREFIX}tourl2*
*┃*  📦 *${config.PREFIX}apk*
*┃*  📲 *${config.PREFIX}fc*
*╰──────────────⊷*

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs*
`;

    const buttons = [
      {buttonId: `${config.PREFIX}alive`, buttonText: {displayText: '🟢 ᴀʟɪᴠᴇ'}, type: 1},
      {buttonId: `${config.PREFIX}repo`, buttonText: {displayText: '📂 ʀᴇᴘᴏ'}, type: 1}
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
//autobio test 
//autobio test 
case 'autobio':
case 'bio': {
    try {
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || '';
        const args = q.split(' ').slice(1);
        const action = args[0]?.toLowerCase();
        
        if (action === 'on' || action === 'start') {
            // Start auto-bio
            if (global.bioInterval) {
                clearInterval(global.bioInterval);
            }
            
            const updateBio = () => {
                const date = new Date();
                const bioText = `🎀ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ🎀🌸 |📅 DATE/TIME: ${date.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })} | DAY: ${date.toLocaleString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi'})}`;
                
                socket.updateProfileStatus(bioText)
                    .then(() => console.log('✅ Bio updated successfully'))
                    .catch(err => console.error('❌ Error updating bio:', err));
            }

            updateBio(); // Update immediately
            global.bioInterval = setInterval(updateBio, 10 * 1000);
            
            // Success message with button
            const successMessage = {
                text: '✅ *Auto-Bio Started!*',
                footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ',
                buttons: [
                    {
                        buttonId: `${prefix}autobio off`,
                        buttonText: { displayText: '❌ STOP AUTO-BIO' },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, successMessage, { quoted: msg });
            
        } else if (action === 'off' || action === 'stop') {
            // Stop auto-bio
            if (global.bioInterval) {
                clearInterval(global.bioInterval);
                global.bioInterval = null;
                
                // Success message with button
                const successMessage = {
                    text: '✅ *Auto-Bio Stopped!*',
                    footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ',
                    buttons: [
                        {
                            buttonId: `${prefix}autobio on`,
                            buttonText: { displayText: '✅ START AUTO-BIO' },
                            type: 1
                        }
                    ],
                    headerType: 1
                };
                
                await socket.sendMessage(sender, successMessage, { quoted: msg });
            } else {
                await socket.sendMessage(sender, {
                    text: 'ℹ️ *Auto-Bio is not currently running.*'
                }, { quoted: msg });
            }
            
        } else {
            // Show status with interactive buttons
            const status = global.bioInterval ? '🟢 ON' : '🔴 OFF';
            
            const buttonMessage = {
                text: `📝 *Auto-Bio Status:* ${status}\n\nUsage:\n• ${prefix}autobio on - Start auto-bio\n• ${prefix}autobio off - Stop auto-bio\n\nOr use the buttons below:`,
                footer: 'Interactive Auto-Bio Control',
                buttons: [
                    {
                        buttonId: `${prefix}autobio on`,
                        buttonText: { displayText: '✅ TURN ON' },
                        type: 1
                    },
                    {
                        buttonId: `${prefix}autobio off`, 
                        buttonText: { displayText: '❌ TURN OFF' },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, buttonMessage, { quoted: msg });
        }
        
    } catch (error) {
        console.error('Auto-Bio command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Error controlling auto-bio*'
        }, { quoted: msg });
    }
    break;
}

 case 'creact': {
    const q = args.join(" ");

    if (!q.includes(",")) {
        return await socket.sendMessage(sender, {
            text: '😒 Please provide the link and emoji separated by a comma.\n\nExample:\n.cnr https://whatsapp.com/channel/120363396379901844/ABCDEF1234,🔥'
        });
    }

    try {
        let [link, emoji] = q.split(",");
        const parts = link.trim().split("/");
        const channelJid = `${parts[4]}@newsletter`;
        const msgId = parts[5];

        await socket.sendMessage(channelJid, {
            react: {
                text: emoji.trim(),
                key: {
                    remoteJid: channelJid,
                    id: msgId,
                    fromMe: false
                },
            },
        });

        await socket.sendMessage(sender, {
            text: `✅ Reacted to the channel message with ${emoji.trim()}`
        });
    } catch (e) {
        console.error("❌ Error in .cnr:", e);
        await socket.sendMessage(sender, {
            text: `❌ Error: ${e.message}`
        });
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
        const startTime = Date.now();
        
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Calculate latency
        const endTime = Date.now();
        const latency = endTime - startTime;

        // Determine quality based on latency
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

        // Create the ping message with image, buttons, and newsletter context
        const pingMessage = {
            image: { 
                url: 'https://files.catbox.moe/8s2st9.jpg' 
            },
            caption: `🏓 *ᴘɪɴɢ!*\n\n` +
                    `⚡ *sᴘᴇᴇᴅ:* ${latency}ms\n` +
                    `${emoji} *ϙᴜᴀʟɪᴛʏ:* ${quality}\n` +
                    `🕒 *ᴛɪᴍᴇsᴛᴀᴍᴘ:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC', hour12: true })}\n\n` +
                    `*╭───────────────────⊷*\n` +
                    `*┃* 🎀 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 🎀 \n` +
                    `*╰───────────────────⊷*`,
            footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
            buttons: [
                {
                    buttonId: `${prefix}active`,
                    buttonText: { 
                        displayText: '🔮 ʙᴏᴛ ɪɴғᴏ 🔮' 
                    },
                    type: 1
                },
                {
                    buttonId: `${prefix}session`, 
                    buttonText: { 
                        displayText: '📊 ʙᴏᴛ sᴛᴀᴛs 📊' 
                    },
                    type: 1
                }
            ],
            headerType: 4,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(sender, pingMessage, { 
            quoted: msg
        });

    } catch (error) {
        console.error('Ping command error:', error);
        const startTime = Date.now();
        const endTime = Date.now();
        await socket.sendMessage(sender, { 
            text: `🏓 *ᴘɪɴɢ!*\n\n⚡ *sᴘᴇᴇᴅ:* ${endTime - startTime}ms\n\n*ᴇʀʀᴏʀ ᴏᴄᴄᴜʀʀᴇᴅ, ʙᴜᴛ ʙᴏᴛ ɪs sᴛɪʟʟ ᴀʟɪᴠᴇ!*` 
        }, { quoted: msg });
    }
    break;
}
// Case: pair
// Case: pair
case 'pair': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair 254103488793\n\n*Example:* .pair 254103488793'
        }, { quoted: msg });
    }

    try {
        const url = `https://minipairs-374f30a8fa70.herokuapp.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("💗 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number format and try again.'
            }, { quoted: msg });
        }

        // Send single comprehensive message with all information
        await socket.sendMessage(sender, {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: `> *CASEYRHODES MINI - PAIRING COMPLETED* ✅\n\n*🔑 Your Pairing Code:* \`\`\`${result.code}\`\`\`\n\n*📝 Pairing Instructions:*\n\n1. Use the code above to pair your device\n2. Keep this code secure and do not share it\n3. Complete the pairing process within your device settings\n\n*Quick Actions:* Use the buttons below for assistance`,
            buttons: [
                { buttonId: '.copycode', buttonText: { displayText: '📋 Copy Code' }, type: 1 },
                { buttonId: 'instructions', buttonText: { displayText: '📖 Full Instructions' }, type: 1 },
                { buttonId: '.owner', buttonText: { displayText: '👨‍💻 Support' }, type: 1 }
            ],
            headerType: 4
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.',
            buttons: [
                { buttonId: 'retry', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: 'support', buttonText: { displayText: '👨‍💻 Contact Support' }, type: 1 }
            ]
        }, { quoted: msg });
    }
    
    break;
}
//case tagadmin
case 'tagadmins':
case 'gc_tagadmins': {
    try {
        // Check if it's a group
        const isGroup = sender.endsWith('@g.us');
        if (!isGroup) {
            return await socket.sendMessage(sender, {
                text: '❌ *This command only works in group chats.*'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Get group metadata
        const groupMetadata = await socket.groupMetadata(sender);
        const groupName = groupMetadata.subject || "Unnamed Group";
        
        // Get admins from participants
        const admins = groupMetadata.participants
            .filter(participant => participant.admin)
            .map(admin => admin.id);

        if (!admins || admins.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ *No admins found in this group.*'
            }, { quoted: msg });
        }

        // Extract message text from command
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || '';
        const args = q.split(' ').slice(1);
        const messageText = args.join(' ') || "Attention Admins ⚠️";

        // Admin emojis
        const emojis = ['👑', '⚡', '🌟', '✨', '🎖️', '💎', '🔱', '🛡️', '🚀', '🏆'];
        const chosenEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        // Build message
        let teks = `📢 *Admin Tag Alert*\n`;
        teks += `🏷️ *Group:* ${groupName}\n`;
        teks += `👥 *Admins:* ${admins.length}\n`;
        teks += `💬 *Message:* ${messageText}\n\n`;
        teks += `╭━━〔 *Admin Mentions* 〕━━┈⊷\n`;
        
        for (let admin of admins) {
            teks += `${chosenEmoji} @${admin.split("@")[0]}\n`;
        }

        teks += `╰──────────────┈⊷\n\n`;
        teks += `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send message with mentions
        await socket.sendMessage(sender, {
            text: teks,
            mentions: admins,
            contextInfo: {
                mentionedJid: admins,
                externalAdReply: {
                    title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
                    body: `${admins.length} ᴀᴅᴍɪɴs`,
                    mediaType: 1,
                    sourceUrl: 'https://wa.me/254101022551',
                    thumbnailUrl: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg'
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("TagAdmins Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `❌ *Error occurred:*\n${error.message || 'Failed to tag admins'}`
        }, { quoted: msg });
    }
    break;
}
//block case
case 'block': {
    try {
        // Check if user is owner (replace with your actual owner check logic)
        const isOwner = true; // Replace with: yourOwnerList.includes(sender.split('@')[0]);
        
        if (!isOwner) {
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return await socket.sendMessage(sender, {
                text: "❌ _Only the bot owner can use this command._"
            }, { quoted: msg });
        }

        const chatId = msg.key.remoteJid; // Get current chat ID
        
        // Send success message immediately
        await socket.sendMessage(sender, { 
            image: { url: `https://files.catbox.moe/8s2st9.jpg` },  
            caption: "*ʙʟᴏᴄᴋᴇᴅ sᴜᴄᴄᴇsғᴜʟʟʏ✅*\n\nblocked",
            buttons: [
                { buttonId: '.allmenu', buttonText: { displayText: '🌟ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                { buttonId: '.owner', buttonText: { displayText: '🎀ᴏᴡɴᴇʀ' }, type: 1 }
            ]
        }, { quoted: msg });

        // React after sending the main message
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

        // Block the chat after sending the success message
        await socket.updateBlockStatus(chatId, "block");

    } catch (error) {
        console.error("Block command error:", error);
        
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        
        await socket.sendMessage(sender, {
            text: `❌ _Failed to block this chat._\nError: ${error.message}_`
        }, { quoted: msg });
    }
    break;
}
// Case: details (Message Details)
case 'details': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📋", // Clipboard emoji
            key: msg.key
        }
    });

    const context = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;

    if (!quoted) {
        return await socket.sendMessage(sender, {
            text: '📋 *Please reply to a message to view its raw details!*\n\n' +
                  'This command shows the complete message structure.'
        }, { quoted: fakevCard });
    }

    try {
        const json = JSON.stringify(quoted, null, 2);
        const parts = json.match(/[\s\S]{1,3500}/g) || [];

        if (parts.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ *No details available for this message.*'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, {
            text: `📋 *CaseyRhodes Message Details:*\n\n*Part 1/${parts.length}*`
        }, { quoted: fakevCard });

        for (let i = 0; i < parts.length; i++) {
            await socket.sendMessage(sender, {
                text: `\`\`\`json\n${parts[i]}\n\`\`\``
            });
            
            // Add small delay between messages to avoid rate limiting
            if (i < parts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (error) {
        console.error('Details command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Failed to read quoted message details!*'
        }, { quoted: fakevCard });
    }
    break;
}
// Case: setpp
case 'setpp': {
  try {
    await socket.sendMessage(sender, { react: { text: '🖼️', key: msg.key } });
    
    // Check if user is owner
    const isOwner = msg.key.fromMe;
    if (!isOwner) {
        await socket.sendMessage(from, { 
            text: '❌ *Owner Only Command*\n\nThis command is only available for the bot owner!' 
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '🚫', key: msg.key } });
        return;
    }

    // Check if message is a reply
    const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage) {
        await socket.sendMessage(from, { 
            text: '📸 *How to Use*\n\nPlease reply to an image with the `.setpp` command!\n\nExample: Reply to an image and type `.setpp`'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: 'ℹ️', key: msg.key } });
        return;
    }

    // Check if quoted message contains an image
    const imageMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
    if (!imageMessage) {
        await socket.sendMessage(from, { 
            text: '❌ *Invalid Media*\n\nThe replied message must contain an image or sticker!\n\nSupported formats: JPG, PNG, WebP'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        return;
    }

    // Create tmp directory if it doesn't exist
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Download the image
    await socket.sendMessage(from, { 
        text: '⏳ Downloading image...' 
    }, { quoted: msg });

    const stream = await downloadContentFromMessage(imageMessage, 'image');
    let buffer = Buffer.from([]);
    
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    const imagePath = path.join(tmpDir, `profile_${Date.now()}.jpg`);
    
    // Save the image
    fs.writeFileSync(imagePath, buffer);

    await socket.sendMessage(from, { 
        text: '🔄 Setting profile picture...' 
    }, { quoted: msg });

    // Set the profile picture
    await socket.updateProfilePicture(socket.user.id, { url: imagePath });

    // Clean up the temporary file
    fs.unlinkSync(imagePath);

    await socket.sendMessage(from, { 
        text: '✅ *Profile Picture Updated!*\n\nBot profile picture has been successfully updated!' 
    }, { quoted: msg });
    
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

  } catch (error) {
    console.error('Error in setpp command:', error);
    
    let errorMessage = '❌ *Update Failed*\n\nFailed to update profile picture!';
    
    if (error.message.includes('rate')) {
        errorMessage = '❌ *Rate Limited*\n\nPlease wait a few minutes before changing profile picture again.';
    } else if (error.message.includes('size')) {
        errorMessage = '❌ *File Too Large*\n\nPlease use a smaller image file.';
    } else if (error.message.includes('format')) {
        errorMessage = '❌ *Invalid Format*\n\nPlease use a valid image format (JPG, PNG).';
    }
    
    await socket.sendMessage(from, { 
        text: errorMessage 
    }, { quoted: msg });
    
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}

// Case: blocklist (Blocked Users)
case 'blocklist':
case 'blocked': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🚫", // No entry emoji
            key: msg.key
        }
    });

    try {
        const blockedJids = await socket.fetchBlocklist();
        
        if (!blockedJids || blockedJids.length === 0) {
            return await socket.sendMessage(sender, {
                text: '✅ *Your block list is empty!* 🌟\n\n' +
                      'No users are currently blocked.',
                buttons: [
                    { buttonId: '.block', buttonText: { displayText: '🚫 Block User' }, type: 1 },
                    { buttonId: '.allmenu', buttonText: { displayText: '📋 Menu' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        const formattedList = blockedJids.map((b, i) => 
            `${i + 1}. ${b.replace('@s.whatsapp.net', '')}`
        ).join('\n');

        await socket.sendMessage(sender, {
            text: `🚫 *Blocked Contacts:*\n\n${formattedList}\n\n` +
                  `*Total blocked:* ${blockedJids.length}\n\n` +
                  `> _Powered by CaseyRhodes Tech_ 🌟`,
            buttons: [
                { buttonId: '.unblock', buttonText: { displayText: '🔓 Unblock All' }, type: 1 },
                { buttonId: '.block', buttonText: { displayText: '🚫 Block More' }, type: 1 },
                { buttonId: '.allmenu', buttonText: { displayText: '📋 Main Menu' }, type: 1 }
            ]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Error fetching block list:', error);
        await socket.sendMessage(sender, {
            text: '❌ *An error occurred while retrieving the block list!*\n\n' +
                  'This command may require admin privileges.',
            buttons: [
                { buttonId: '.help block', buttonText: { displayText: '❓ Help' }, type: 1 },
                { buttonId: '.allmenu', buttonText: { displayText: '📋 Menu' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}
///fixed lyrics 😀
case 'lyrics': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🎶", // Music note emoji
            key: msg.key
        }
    });

    const axios = require('axios');
    
    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';
    
    const args = q.trim().split(' ').slice(1); // Remove the command itself
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '🎶 *Please provide a song name and artist...*\n\n' +
                  'Example: *.lyrics not afraid Eminem*\n' +
                  'Example: *.lyrics shape of you Ed Sheeran*',
            buttons: [ 
                { buttonId: '.lyrics shape of you', buttonText: { displayText: '🎵 Example 1' }, type: 1 },
                { buttonId: '.lyrics not afraid', buttonText: { displayText: '🎵 Example 2' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }

    try {
        const apiURL = `https://lyricsapi.fly.dev/api/lyrics?q=${encodeURIComponent(query)}`;
        const res = await axios.get(apiURL);
        const data = res.data;

        if (!data.success || !data.result || !data.result.lyrics) {
            return await socket.sendMessage(sender, {
                text: '❌ *Lyrics not found for the provided query.*\n\n' +
                      'Please check the song name and artist spelling.',
                buttons: [
                    { buttonId: '.help lyrics', buttonText: { displayText: '❓ Help' }, type: 1 },
                    { buttonId: '.lyrics', buttonText: { displayText: '🔍 Try Again' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        const { title, artist, image, link, lyrics } = data.result;
        const shortLyrics = lyrics.length > 4096 ? lyrics.slice(0, 4093) + '...' : lyrics;

        const caption =
            `🎶 *🌸 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐋𝐘𝐑𝐈𝐂𝐒 🌸*\n\n` +
            `*🎵 Title:* ${title}\n` +
            `*👤 Artist:* ${artist}\n` +
            `*🔗 Link:* ${link}\n\n` +
            `📜 *Lyrics:*\n\n` +
            `${shortLyrics}\n\n` +
            `> _Powered by CaseyRhodes Tech_ 🌟`;

        await socket.sendMessage(sender, {
            image: { url: image },
            caption: caption,
            buttons: [
                { buttonId: '.play ' + query, buttonText: { displayText: '🎵 Play Song' }, type: 1 },
                { buttonId: '.song ' + query, buttonText: { displayText: '📺 YouTube' }, type: 1 },
                { buttonId: '.lyrics', buttonText: { displayText: '🔍 New Search' }, type: 1 }
            ],
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363402973786789@newsletter',
                    newsletterName: 'CASEYRHODES-MINI🌸',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

    } catch (err) {
        console.error('[LYRICS ERROR]', err);
        await socket.sendMessage(sender, {
            text: '❌ *An error occurred while fetching lyrics!*\n\n' +
                  'Please try again later or check your internet connection.',
            buttons: [
                { buttonId: '.lyrics', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}
//=====[PLAY COMMAND]================//
case 'play': {
    try {
        // React to the command first
        await socket.sendMessage(sender, {
            react: {
                text: "🎵",
                key: msg.key
            }
        });

        const axios = require('axios');
        const yts = require('yt-search');

        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '*🎵 Audio Player*\nPlease provide a song name to play.*'
            }, { quoted: msg });
        }

        console.log('[PLAY] Searching YT for:', query);
        const search = await yts(query);
        const video = search.videos[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: '*❌ No Results Found*\nNo songs found for your query. Please try different keywords.*'
            }, { quoted: msg });
        }

        const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
        const fileName = `${safeTitle}.mp3`;
        const apiURL = `${BASE_URL}/dipto/ytDl3?link=${encodeURIComponent(video.videoId)}&format=mp3`;

        // Create single button for getting video
        const buttonMessage = {
            image: { url: video.thumbnail },
            caption: `
🎵 *NOW PLAYING* 🎵

🎶 *Title:* ${video.title}
⏱️ *Duration:* ${video.timestamp}
👁️ *Views:* ${video.views}
📅 *Uploaded:* ${video.ago}
🔗 *YouTube ID:* ${video.videoId}

⬇️ *Downloading your audio...* ⬇️

💡 *Tip:* Use *.video to get the video version*
            `.trim(),
            footer: 'CaseyRhodes Mini - Audio Player',
            buttons: [
                {
                    buttonId: '.video ' + video.title,
                    buttonText: { displayText: '🎬 Get Video' },
                    type: 1
                }
            ],
            headerType: 1
        };

        // Send song description with thumbnail and single button
        await socket.sendMessage(sender, buttonMessage, { quoted: msg });

        // Get download link
        const response = await axios.get(apiURL, { timeout: 30000 });
        const data = response.data;

        if (!data.downloadLink) {
            return await socket.sendMessage(sender, {
                text: '*❌ Download Failed*\nFailed to retrieve the MP3 download link. Please try again later.*'
            }, { quoted: msg });
        }

        // Send audio file
        await socket.sendMessage(sender, {
            audio: { url: data.downloadLink },
            mimetype: 'audio/mpeg',
            fileName: fileName,
            caption: `✅ *Download Complete!*\n🎵 ${video.title}`
        });

    } catch (err) {
        console.error('[PLAY] Error:', err.message);
        await socket.sendMessage(sender, {
            text: '*❌ Error Occurred*'
        }, { quoted: msg });
    }
    break;
}
//video case
//=====[VIDEO COMMAND]================//
case 'video': {
    try {
        // React to the command first
        await socket.sendMessage(sender, {
            react: {
                text: "🎬",
                key: msg.key
            }
        });

        const axios = require('axios');
        const yts = require('yt-search');

        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '*🎬 Video Downloader*\nPlease provide a video name to download.*'
            }, { quoted: msg });
        }

        console.log('[VIDEO] Searching YT for:', query);
        const search = await yts(query);
        const video = search.videos[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: '*❌ No Results Found*\nNo videos found for your query. Please try different keywords.*'
            }, { quoted: msg });
        }

        const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
        const fileName = `${safeTitle}.mp4`;
        const apiURL = `${BASE_URL}/dipto/ytDl3?link=${encodeURIComponent(video.videoId)}&format=mp4`;

        // Create fancy video description with emojis and formatting
        const videoInfo = `
🎬 *NOW DOWNLOADING* 🎬

📹 *Title:* ${video.title}
⏱️ *Duration:* ${video.timestamp}
👁️ *Views:* ${video.views}
📅 *Uploaded:* ${video.ago}
🔗 *YouTube ID:* ${video.videoId}

⬇️ *Downloading your video...* ⬇️
        `.trim();

        // Send video info with thumbnail first
        await socket.sendMessage(sender, {
            image: { url: video.thumbnail },
            caption: videoInfo
        }, { quoted: msg });

        // Get download link
        const response = await axios.get(apiURL, { timeout: 30000 });
        const data = response.data;

        if (!data.downloadLink) {
            return await socket.sendMessage(sender, {
                text: '*❌ Download Failed*\nFailed to retrieve the MP4 download link. Please try again later.*'
            }, { quoted: msg });
        }

        // Fetch thumbnail for the context info
        let thumbnailBuffer;
        try {
            const thumbnailResponse = await axios.get(video.thumbnail, { 
                responseType: 'arraybuffer',
                timeout: 8000
            });
            thumbnailBuffer = Buffer.from(thumbnailResponse.data);
        } catch (err) {
            console.error('[VIDEO] Error fetching thumbnail:', err.message);
            thumbnailBuffer = undefined;
        }

        // Send video with context info after a short delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const videoMessage = {
            video: { url: data.downloadLink },
            mimetype: 'video/mp4',
            fileName: fileName,
            caption: `🎬 *${video.title}*\n⏱️ ${video.timestamp} | 👁️ ${video.views}\n\n📥 Downloaded by CaseyRhodes Mini`
        };

        // Add contextInfo only if we have a thumbnail
        if (thumbnailBuffer) {
            videoMessage.contextInfo = {
                externalAdReply: {
                    title: video.title.substring(0, 40),
                    body: `Duration: ${video.timestamp} | Views: ${video.views}`,
                    mediaType: 2, // 2 for video
                    thumbnail: thumbnailBuffer,
                    sourceUrl: `https://youtu.be/${video.videoId}`,
                    renderLargerThumbnail: false
                }
            };
        }

        await socket.sendMessage(sender, videoMessage);

    } catch (err) {
        console.error('[VIDEO] Error:', err.message);
        await socket.sendMessage(sender, {
            text: '*❌ Error Occurred*\nFailed to process your video request. Please try again later.*'
        }, { quoted: msg });
    }
    break;
}
case 'gjid':
case 'groupjid':
case 'grouplist': {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: "❌ You are not the owner!"
        }, { quoted: msg });
        return;
    }
    
    try {
        const groups = await socket.groupFetchAllParticipating();
        const groupJids = Object.keys(groups).map((jid, i) => `${i + 1}. ${jid}`).join('\n');
        
        await socket.sendMessage(sender, {
            text: `📝 *Group JIDs List:*\n\n${groupJids}\n\n*Total Groups:* ${Object.keys(groups).length}`,
            buttons: [
                { buttonId: `${prefix}gjid`, buttonText: { displayText: '🔄 Refresh' }, type: 1 },
                { buttonId: `${prefix}bc`, buttonText: { displayText: '📢 Broadcast' }, type: 1 },
                { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 Owner Menu' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '📝', key: msg.key } });
        
    } catch (error) {
        console.error("Error fetching groups:", error);
        await socket.sendMessage(sender, {
            text: `❌ Failed to fetch groups: ${error.message}`,
            buttons: [
                { buttonId: `${prefix}support`, buttonText: { displayText: '🆘 Support' }, type: 1 },
                { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 Owner Menu' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
    }
    break;
}
//logo casey
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
case 'tiktok':
case 'tt':
case 'tiktokdl': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const tiktokUrl = args[0];

        if (!tiktokUrl || !tiktokUrl.includes("tiktok.com")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid TikTok URL.*\nExample: .tiktok https://vm.tiktok.com/abc123'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        let data;
        
        // Try primary API
        try {
            const res = await axios.get(`https://api.nexoracle.com/downloader/tiktok-nowm?apikey=free_key@maher_apis&url=${encodeURIComponent(tiktokUrl)}`, {
                timeout: 15000
            });
            if (res.data?.status === 200) data = res.data.result;
        } catch (primaryError) {
            console.log('Primary API failed, trying fallback...');
        }

        // Fallback API if primary fails
        if (!data) {
            try {
                const fallback = await axios.get(`https://api.tikwm.com/?url=${encodeURIComponent(tiktokUrl)}&hd=1`, {
                    timeout: 15000
                });
                if (fallback.data?.data) {
                    const r = fallback.data.data;
                    data = {
                        title: r.title,
                        author: {
                            username: r.author.unique_id,
                            nickname: r.author.nickname
                        },
                        metrics: {
                            digg_count: r.digg_count,
                            comment_count: r.comment_count,
                            share_count: r.share_count,
                            download_count: r.download_count
                        },
                        url: r.play,
                        thumbnail: r.cover
                    };
                }
            } catch (fallbackError) {
                console.error('Fallback API also failed');
            }
        }

        if (!data) {
            return await socket.sendMessage(sender, {
                text: '❌ *TikTok video not found or API services are down.*\nPlease try again later.'
            }, { quoted: msg });
        }

        const { title, author, url, metrics, thumbnail } = data;

        const caption = `🎬 *TikTok Downloader*\n
╭─❍ ᴄᴀsᴇʏʀʜᴏᴅᴇs-ᴡᴏʀʟᴅ ❍
┊🎵 *Title:* ${title || 'No title'}
┊👤 *Author:* @${author.username} (${author.nickname})
┊❤️ *Likes:* ${metrics.digg_count || 0}
┊💬 *Comments:* ${metrics.comment_count || 0}
┊🔁 *Shares:* ${metrics.share_count || 0}
┊📥 *Downloads:* ${metrics.download_count || 0}
╰─❍
> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send thumbnail and info first
        await socket.sendMessage(sender, {
            image: { url: thumbnail },
            caption: caption
        }, { quoted: msg });

        // Send downloading message
        const loadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Downloading video... Please wait*'
        }, { quoted: msg });

        try {
            // Download video
            const videoResponse = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const videoBuffer = Buffer.from(videoResponse.data, 'binary');

            // Send video
            await socket.sendMessage(sender, {
                video: videoBuffer,
                caption: `🎥 *Video by* @${author.username}\n\n> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
                contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                        title: 'TikTok Download',
                        body: `By @${author.username}`,
                        mediaType: 2,
                        sourceUrl: tiktokUrl,
                        thumbnailUrl: thumbnail
                    }
                }
            });

            // Update loading message to success
            await socket.sendMessage(sender, {
                text: '✅ *Video downloaded successfully!*',
                edit: loadingMsg.key
            });

            // Send success reaction
            await socket.sendMessage(sender, {
                react: {
                    text: "✅",
                    key: msg.key
                }
            });

        } catch (downloadError) {
            console.error('Video download failed:', downloadError);
            await socket.sendMessage(sender, {
                text: '❌ *Failed to download video.* The video might be too large or restricted.'
            }, { quoted: msg });
        }

    } catch (err) {
        console.error("TikTok download error:", err);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: '❌ *Failed to process TikTok video.*\nPlease check the URL and try again.'
        }, { quoted: msg });
    }
    break;
}
//case newsletters 
case 'newsletter':
case 'cjid':
case 'id': {
    try {
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const channelLink = args.join(' ');

        if (!channelLink) {
            return await socket.sendMessage(sender, {
                text: '❎ *Please provide a WhatsApp Channel link.*\n\n📌 *Example:*\n.newsletter https://whatsapp.com/channel/xxxxxxxxxx'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
        if (!match) {
            return await socket.sendMessage(sender, {
                text: '⚠️ *Invalid channel link!*\n\nMake sure it looks like:\nhttps://whatsapp.com/channel/xxxxxxxxx'
            }, { quoted: msg });
        }

        const inviteId = match[1];
        let metadata;

        try {
            // Try to get newsletter metadata
            metadata = await socket.newsletterMetadata("invite", inviteId);
        } catch (error) {
            console.error('Newsletter metadata error:', error);
            return await socket.sendMessage(sender, {
                text: '🚫 *Failed to fetch channel info.*\nDouble-check the link and try again.'
            }, { quoted: msg });
        }

        if (!metadata?.id) {
            return await socket.sendMessage(sender, {
                text: '❌ *Channel not found or inaccessible.*'
            }, { quoted: msg });
        }

        const infoText = `
『 📡 ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ 』
*ID:* ${metadata.id}
*Name:* ${metadata.name || 'N/A'}
*Followers:* ${metadata.subscribers?.toLocaleString() || "N/A"}
*Created:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString() : "Unknown"}

> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send channel info with or without image
        if (metadata.preview) {
            await socket.sendMessage(sender, {
                image: { url: `https://pps.whatsapp.net${metadata.preview}` },
                caption: infoText,
                contextInfo: {
                    externalAdReply: {
                        title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
                        body: metadata.name || 'ᴄʜᴀɴɴᴇʟ',
                        mediaType: 1,
                        sourceUrl: channelLink,
                        thumbnailUrl: `https://pps.whatsapp.net${metadata.preview}`
                    }
                }
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: infoText,
                contextInfo: {
                    externalAdReply: {
                        title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ',
                        body: metadata.name || 'Channel Details',
                        mediaType: 1,
                        sourceUrl: channelLink
                    }
                }
            }, { quoted: msg });
        }

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("Newsletter Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: '⚠️ *An unexpected error occurred while fetching the channel info.*\nPlease try again with a valid channel link.'
        }, { quoted: msg });
    }
    break;
}
//view once test
//view once test
case 'viewonce':
case 'vv':
case 'reveal':
case 'unviewonce': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "👀",
            key: msg.key
        }
    });

    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

    try {
        // Extract quoted message from your structure
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedImage = quoted?.imageMessage;
        const quotedVideo = quoted?.videoMessage;

        if (quotedImage && quotedImage.viewOnce) {
            // Download and send the image
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await socket.sendMessage(
                sender, 
                { 
                    image: buffer, 
                    caption: quotedImage.caption || '📸 *View Once Image Revealed*',
                    fileName: 'revealed-image.jpg',
                    buttons: [
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 },
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴍᴇɴᴜ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
            
        } else if (quotedVideo && quotedVideo.viewOnce) {
            // Download and send the video
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await socket.sendMessage(
                sender, 
                { 
                    video: buffer, 
                    caption: quotedVideo.caption || '🎥 *View Once Video Revealed*',
                    fileName: 'revealed-video.mp4',
                    buttons: [
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 },
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴍᴇɴᴜ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
            
        } else {
            await socket.sendMessage(
                sender, 
                { 
                    text: '❌ *Please reply to a view-once image or video.*\n\n💡 *How to use:* Reply to a view-once message with `.viewonce`',
                    buttons: [
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                        { buttonId: `${prefix}help viewonce`, buttonText: { displayText: 'ℹ️ ʜᴇʟᴘ' }, type: 1 },
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
        }

    } catch (error) {
        console.error('View Once Error:', error);
        
        await socket.sendMessage(
            sender, 
            { 
                text: `❌ *Failed to reveal view-once media*\n⚠️ *Error:* ${error.message || 'Unknown error'}`,
                buttons: [
                    { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: `${prefix}viewonce`, buttonText: { displayText: '🔄 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 },
                    { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 }
                ]
            }, 
            { quoted: msg }
        );
    }
    break;
}
//image case 
case 'img':
case 'image':
case 'googleimage':
case 'searchimg': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🦋",
            key: msg.key
        }
    });

    const axios = require("axios");
    const prefix = global.prefix || '.'; // Get the prefix from your global settings

    try {
        // Extract search query from message - fixed extraction
        let q = '';
        if (msg.message?.conversation) {
            q = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
            q = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage?.caption) {
            q = msg.message.imageMessage.caption;
        }

        // Remove prefix from the message
        const queryText = q.startsWith(prefix) ? q.slice(prefix.length).trim() : q.trim();
        
        // Extract command and query properly
        const parts = queryText.split(' ');
        const command = parts[0];
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: `🖼️ *Please provide a search query*\n*Example:* ${prefix}img cute cats`,
                buttons: [
                    { buttonId: `${prefix}allmenu`, buttonText: { displayText: '🌟 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: `${prefix}img cute cats`, buttonText: { displayText: '🐱 ᴇxᴀᴍᴘʟᴇ sᴇᴀʀᴄʜ' }, type: 1 }
                ]
            }, { quoted: msg });
        }

        // Send searching message
        await socket.sendMessage(sender, {
            text: `> 🔍 *Searching images for:* "${query}"...`
        }, { quoted: msg });

        // Fixed API URL with proper error handling
        const url = `https://iamtkm.vercel.app/api/img?query=${encodeURIComponent(query)}`;
        
        const response = await axios.get(url, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Validate response structure
        if (!response.data || (!response.data.results && !response.data.data)) {
            console.log('Unexpected API response structure:', response.data);
            throw new Error('Invalid API response structure');
        }

        // Handle different response formats
        const results = response.data.results || response.data.data || response.data;
        
        if (!Array.isArray(results) || results.length === 0) {
            return await socket.sendMessage(sender, {
                text: "❌ *No images found.* Try different keywords",
                buttons: [
                    { buttonId: `${prefix}allmenu`, buttonText: { displayText: '🏠 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: `${prefix}img ${query}`, buttonText: { displayText: '🔄 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 }
                ]
            }, { quoted: msg });
        }

        // Filter valid image URLs
        const validImages = results.filter(img => {
            if (typeof img === 'string') {
                return img.startsWith('http') && (img.endsWith('.jpg') || img.endsWith('.jpeg') || img.endsWith('.png') || img.includes('google'));
            } else if (typeof img === 'object' && img.url) {
                return img.url.startsWith('http') && (img.url.endsWith('.jpg') || img.url.endsWith('.jpeg') || img.url.endsWith('.png') || img.url.includes('google'));
            }
            return false;
        });

        if (validImages.length === 0) {
            return await socket.sendMessage(sender, {
                text: "❌ *No valid images found.* Try different keywords",
                buttons: [
                    { buttonId: `${prefix}allmenu`, buttonText: { displayText: '🏠 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: `${prefix}img`, buttonText: { displayText: '🔄 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 }
                ]
            }, { quoted: msg });
        }

        // Get 3 random images
        const selectedImages = validImages
            .sort(() => 0.5 - Math.random())
            .slice(0, 3)
            .map(img => typeof img === 'string' ? img : img.url);

        let sentCount = 0;
        
        for (const imageUrl of selectedImages) {
            try {
                await socket.sendMessage(
                    sender,
                    { 
                        image: { url: imageUrl },
                        caption: `📷 *Image Search Result*\n🔍 *Query:* ${query}\n📊 *Result:* ${sentCount + 1}/${selectedImages.length}\n\n✨ *Powered by CaseyRhodes-XMD*`,
                        buttons: [
                            { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                            { buttonId: `${prefix}img ${query}`, buttonText: { displayText: '🔄 ᴍᴏʀᴇ ɪᴍᴀɢᴇs' }, type: 1 }
                        ]
                    },
                    { quoted: msg }
                );
                
                sentCount++;
                
                // Add delay between sends to avoid rate limiting
                if (sentCount < selectedImages.length) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                
            } catch (imageError) {
                console.error('Failed to send image:', imageError);
                // Continue with next image if one fails
            }
        }

        // Completion message has been removed as requested

    } catch (error) {
        console.error('Image Search Error:', error);
        
        let errorMessage = "Failed to fetch images";
        if (error.code === 'ECONNABORTED') {
            errorMessage = "Request timeout - server took too long to respond";
        } else if (error.response?.status === 404) {
            errorMessage = "Image API endpoint not found";
        } else if (error.response?.status >= 500) {
            errorMessage = "Image search service is currently unavailable";
        } else if (error.message) {
            errorMessage = error.message;
        }

        await socket.sendMessage(sender, {
            text: `❌ *Search Failed*\n⚠️ *Error:* ${errorMessage}`,
            buttons: [
                { buttonId: `${prefix}allmenu`, buttonText: { displayText: '🏠 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                { buttonId: `${prefix}img`, buttonText: { displayText: '🔄 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 }
            ]
        }, { quoted: msg });
    }
    break;
}
//zip case 
//web zip 
case 'webzip':
case 'sitezip':
case 'web':
case 'archive': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const url = args[0];

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a URL*\nExample: .webzip https://example.com'
            }, { quoted: msg });
        }

        if (!url.match(/^https?:\/\//)) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid URL*\nPlease use http:// or https://'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const apiUrl = `https://api.giftedtech.web.id/api/tools/web2zip?apikey=gifted&url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl, { timeout: 30000 });

        if (!response.data?.success || !response.data?.result?.download_url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Failed to archive website*\nSite may be restricted, too large, or unavailable.'
            }, { quoted: msg });
        }

        const { siteUrl, copiedFilesAmount, download_url } = response.data.result;

        const caption = `
╭───[ *ᴡᴇʙᴢɪᴘ* ]───
├ *sɪᴛᴇ*: ${siteUrl} 🌐
├ *ғɪʟᴇs*: ${copiedFilesAmount} 📂
╰───[ *ᴄᴀsᴇʏʀʜᴏᴅᴇs* ]───
> *powered by caseyrhodes* ⚡`;

        // Send archiving message
        const loadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Archiving website... This may take a while* 📦'
        }, { quoted: msg });

        try {
            const zipResponse = await axios.get(download_url, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!zipResponse.data) {
                throw new Error('Empty zip response');
            }

            const zipBuffer = Buffer.from(zipResponse.data, 'binary');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `website_archive_${timestamp}.zip`;

            // Send the zip file with buttons
            const zipMessage = {
                document: zipBuffer,
                fileName: filename,
                mimetype: 'application/zip',
                caption: `${caption}\n✅ *Archive downloaded successfully*`,
                footer: 'Website archived successfully',
                buttons: [
                    {
                        buttonId: `.webzip ${url}`,
                        buttonText: { displayText: '🔄 Archive Again' },
                        type: 1
                    },
                    {
                        buttonId: '.allmenu',
                        buttonText: { displayText: '❓ Tools Help' },
                        type: 1
                    }
                ],
                headerType: 4,
                contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                        title: 'Website Archive',
                        body: `${copiedFilesAmount} files archived`,
                        mediaType: 1,
                        sourceUrl: url,
                        thumbnail: Buffer.from('') // Optional: add thumbnail
                    }
                }
            };

            await socket.sendMessage(sender, zipMessage, { quoted: msg });

            // Delete loading message
            await socket.sendMessage(sender, {
                delete: loadingMsg.key
            });

            // Send success reaction
            await socket.sendMessage(sender, {
                react: {
                    text: "✅",
                    key: msg.key
                }
            });

        } catch (downloadError) {
            console.error('Zip download error:', downloadError);
            await socket.sendMessage(sender, {
                text: '❌ *Failed to download archive*\nFile may be too large or download timed out.'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Webzip error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        let errorMsg = '❌ *Error archiving website*';
        
        if (error.message.includes('timeout')) {
            errorMsg = '❌ *Request timed out*\nPlease try again with a smaller website.';
        } else if (error.code === 'ENOTFOUND') {
            errorMsg = '❌ *API service unavailable*\nTry again later.';
        } else if (error.response?.status === 404) {
            errorMsg = '❌ *Website not found or inaccessible*';
        }

        await socket.sendMessage(sender, {
            text: errorMsg
        }, { quoted: msg });
    }
    break;
}
//screenshot case
case 'screenshot':
case 'ss':
case 'ssweb': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const url = args[0];

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid URL.*\nExample: `.screenshot https://github.com`'
            }, { quoted: msg });
        }

        // Validate the URL
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid URL.* Please include "http://" or "https://".'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Generate the screenshot URL using Thum.io API
        const screenshotUrl = `https://image.thum.io/get/fullpage/${url}`;

        // Send the screenshot as an image message
        await socket.sendMessage(sender, {
            image: { url: screenshotUrl },
            caption: `🌐 *Website Screenshot*\n\n🔗 *URL:* ${url}\n\n> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: 'Website Screenshot',
                    body: 'Powered by Thum.io API',
                    mediaType: 1,
                    sourceUrl: url,
                    thumbnailUrl: screenshotUrl
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("Screenshot Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        
        await socket.sendMessage(sender, {
            text: '❌ *Failed to capture the screenshot.*\nThe website may be blocking screenshots or the URL might be invalid.'
        }, { quoted: msg });
    }
    break;
}
//tts case
case 'tts': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🔊",
            key: msg.key
        }
    });

    const googleTTS = require('google-tts-api');

    try {
        // Extract text from message
        const q = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
        
        const args = q.split(' ').slice(1);
        const text = args.join(' ').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text: "❌ *Please provide some text to convert to speech.*\n\n*Example:* .tts Hello world"
            }, { quoted: msg });
        }

        const url = googleTTS.getAudioUrl(text, {
            lang: 'en-US',
            slow: false,
            host: 'https://translate.google.com',
        });

        // Send the audio
        await socket.sendMessage(sender, { 
            audio: { url: url }, 
            mimetype: 'audio/mpeg', 
            ptt: false,
            caption: `🔊 *Text to Speech*\n📝 *Text:* ${text}\n\n✨ *Powered by CASEYRHODES-TECH*`
        }, { quoted: msg });

    } catch (e) {
        console.error('TTS Error:', e);
        await socket.sendMessage(sender, {
            text: `❌ *Error:* ${e.message || e}`
        }, { quoted: msg });
    }
    break;
}
//fetch case
//fetch case
case 'fetch':
case 'get':
case 'api': {
    await socket.sendMessage(sender, {
        react: { text: "🌐", key: msg.key }
    });

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || '';
    
    const args = q.split(' ').slice(1);
    const url = args.join(' ').trim();

    if (!url) {
        return await socket.sendMessage(sender, {
            text: '*❌ Please provide a URL!*\n*Examples:*\n.fetch https://jsonplaceholder.typicode.com/posts/1\n.get https://api.github.com/users/caseyrhodes'
        }, { quoted: msg });
    }

    if (!/^https?:\/\//.test(url)) {
        return await socket.sendMessage(sender, {
            text: '*❌ Invalid URL format! Must start with http:// or https://*'
        }, { quoted: msg });
    }

    try {
        const axios = require('axios');
        const response = await axios.get(url, { timeout: 15000 });
        const data = response.data;
        
        let content = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

        // If content is too large, send as file
        if (content.length > 2000) {
            const filename = `fetched_data_${Date.now()}.json`;
            
            await socket.sendMessage(sender, {
                document: Buffer.from(content),
                fileName: filename,
                mimetype: 'application/json',
                caption: `🌐 *FETCHED DATA* 🌐\n\n` +
                        `*URL:* ${url}\n` +
                        `*Status:* ${response.status}\n` +
                        `*Size:* ${content.length} characters\n` +
                        `*Sent as file due to large size*\n\n` +
                        `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🌟`
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: `🌐 *FETCHED DATA* 🌐\n\n` +
                      `*URL:* ${url}\n` +
                      `*Status:* ${response.status}\n` +
                      `*Size:* ${content.length} characters\n\n` +
                      `\`\`\`${content}\`\`\`\n\n` +
                      `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🌟`
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Fetch error:', error);
        
        await socket.sendMessage(sender, {
            text: `❌ *FETCH FAILED* ❌\n\n` +
                  `*URL:* ${url}\n` +
                  `*Error:* ${error.message}\n\n` +
                  `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🌟`
        }, { quoted: msg });
    }
    break;
}
//case wallpaper 
case 'rw':
case 'randomwall':
case 'wallpaper': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ') || 'random';

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Send fetching message
        await socket.sendMessage(sender, {
            text: `🔍 *Fetching wallpaper for* \"${query}\"...`
        }, { quoted: msg });

        const apiUrl = `https://pikabotzapi.vercel.app/random/randomwall/?apikey=anya-md&query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { timeout: 15000 });

        if (!data?.status || !data?.imgUrl) {
            await socket.sendMessage(sender, {
                text: `❌ *No wallpaper found for* \"${query}\" 😔\nTry a different keyword.`
            }, { quoted: msg });
            
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return;
        }

        const caption = `
╭━━〔*🌌 ᴡᴀʟʟᴘᴀᴘᴇʀ* 〕━━┈⊷
├ *ᴋᴇʏᴡᴏʀᴅ*: ${query}
╰──────────────┈⊷
> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send wallpaper with buttons
        const wallpaperMessage = {
            image: { url: data.imgUrl },
            caption: caption,
            footer: 'Choose an option below',
            buttons: [
                {
                    buttonId: `.rw ${query}`,
                    buttonText: { displayText: '🔄 Another' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '❓ Help' },
                    type: 1
                }
            ],
            headerType: 4,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                externalAdReply: {
                    title: 'Random Wallpaper',
                    body: `Keyword: ${query}`,
                    mediaType: 1,
                    sourceUrl: data.imgUrl,
                    thumbnailUrl: data.imgUrl
                }
            }
        };

        await socket.sendMessage(sender, wallpaperMessage, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Wallpaper error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        let errorMsg = '❌ *Failed to fetch wallpaper* 😞';
        
        if (error.message.includes('timeout')) {
            errorMsg = '❌ *Request timed out* ⏰\nPlease try again.';
        } else if (error.code === 'ENOTFOUND') {
            errorMsg = '❌ *API service unavailable* 🔧\nTry again later.';
        } else if (error.response?.status === 404) {
            errorMsg = '❌ *Wallpaper API not found* 🚫';
        }

        await socket.sendMessage(sender, {
            text: errorMsg
        }, { quoted: msg });
    }
    break;
}

//bible case 
case 'bible': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📖",
            key: msg.key
        }
    });

    const axios = require("axios");

    try {
        // Extract query from message
        const q = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
        
        const args = q.split(' ').slice(1);
        const reference = args.join(' ').trim();

        if (!reference) {
            return await socket.sendMessage(sender, {
                text: `⚠️ *Please provide a Bible reference.*\n\n📝 *Example:*\n.bible John 1:1`
            }, { quoted: msg });
        }

        const apiUrl = `https://bible-api.com/${encodeURIComponent(reference)}`;
        const response = await axios.get(apiUrl, { timeout: 10000 });

        if (response.status === 200 && response.data.text) {
            const { reference: ref, text, translation_name } = response.data;
            const status = `📜 *Bible Verse Found!*\n\n` +
                         `📖 *Reference:* ${ref}\n` +
                         `📚 *Text:* ${text}\n\n` +
                         `🗂️ *Translation:* ${translation_name}\n\n` +
                         `> © CASEYRHODES XMD BIBLE`;

            await socket.sendMessage(sender, { 
                image: { url: `https://files.catbox.moe/y3j3kl.jpg` },
                caption: status,
                footer: "Choose an option below",
                buttons: [
                    { buttonId: '.allmenu', buttonText: { displayText: '🎀ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: '.bible', buttonText: { displayText: '🔍 sᴇᴀʀᴄʜ ᴀɴᴏᴛʜᴇʀ' }, type: 1 }
                ],
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363420261263259 newsletter',
                        newsletterName: 'CASEYRHODES BIBLE 🎉🙏',
                        serverMessageId: 143
                    }
                }
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: "❌ *Verse not found.* Please check the reference and try again."
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Bible Error:', error);
        
        if (error.response?.status === 404) {
            await socket.sendMessage(sender, {
                text: "❌ *Verse not found.* Please check the reference and try again."
            }, { quoted: msg });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            await socket.sendMessage(sender, {
                text: "⏰ *Request timeout.* Please try again later."
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: "⚠️ *An error occurred while fetching the Bible verse.* Please try again."
            }, { quoted: msg });
        }
    }
    break;
}
//delete case 
case 'delete':
case 'del':
case 'd': {
    try {
        // Check if the message is a reply
        if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please reply to a message to delete it!*'
            }, { quoted: msg });
        }

        const quoted = msg.message.extendedTextMessage.contextInfo;
        const isGroup = sender.endsWith('@g.us');
        
        // For groups - check if user is admin
        if (isGroup) {
            try {
                const groupMetadata = await socket.groupMetadata(sender);
                const participant = msg.key.participant || msg.key.remoteJid;
                const isAdmins = groupMetadata.participants.find(p => p.id === participant)?.admin;
                const isOwner = groupMetadata.owner === participant;
                
                if (!isAdmins && !isOwner) {
                    return await socket.sendMessage(sender, {
                        text: '❌ *You need admin rights to delete messages in groups!*'
                    }, { quoted: msg });
                }
            } catch (groupError) {
                console.error('Group metadata error:', groupError);
            }
        }

        // Delete the quoted message
        const deleteParams = {
            remoteJid: sender,
            id: quoted.stanzaId,
            participant: quoted.participant,
            fromMe: quoted.participant === (msg.key.participant || msg.key.remoteJid)
        };

        await socket.sendMessage(sender, { delete: deleteParams });

        // Send success message with button instead of deleting command
        const successMessage = {
            text: '✅ *Message deleted successfully!*',
            buttons: [
                {
                    buttonId: '.delete',
                    buttonText: { displayText: '🗑️ Delete Another' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '🎌Help' },
                    type: 1
                }
            ],
            footer: 'Powered by CASEYRHODES XTECH',
            headerType: 1
        };

        await socket.sendMessage(sender, successMessage, { quoted: msg });

    } catch (error) {
        console.error('Delete error:', error);
        
        // Send error message with button
        const errorMessage = {
            text: `❌ *Failed to delete message!*\n${error.message || 'Unknown error'}`,
            buttons: [
                {
                    buttonId: '.almenu',
                    buttonText: { displayText: '❓ Get Help' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '🆘 Support' },
                    type: 1
                }
            ],
            footer: 'Powered by caseyrhodes 🌸',
            headerType: 1
        };
        
        await socket.sendMessage(sender, errorMessage, { quoted: msg });
    }
    break;
}
//jid case

case 'jid': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📍",
            key: msg.key
        }
    });

    try {
        // Check if it's a group and user has permission
        // You'll need to implement your own permission logic
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        const isOwner = true; // Replace with your actual owner check logic
        const isAdmin = true; // Replace with your actual admin check logic

        // Permission check - only owner in private chats or admin/owner in groups
        if (!isGroup && !isOwner) {
            return await socket.sendMessage(sender, {
                text: "⚠️ Only the bot owner can use this command in private chats."
            }, { quoted: msg });
        }

        if (isGroup && !isOwner && !isAdmin) {
            return await socket.sendMessage(sender, {
                text: "⚠️ Only group admins or bot owner can use this command."
            }, { quoted: msg });
        }

        // Newsletter message configuration
        const newsletterConfig = {
            mentionedJid: [sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363420261263259@newsletter',
                newsletterName: '𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐓𝐄𝐂𝐇',
                serverMessageId: 143
            }
        };

        // Prepare the appropriate response
        let response;
        if (isGroup) {
            response = `🔍 *Group JID*\n${msg.key.remoteJid}`;
        } else {
            response = `👤 *Your JID*\n${sender.split('@')[0]}@s.whatsapp.net`;
        }

        // Send the newsletter-style message with button
        await socket.sendMessage(sender, {
            text: response,
            footer: "Need help? Contact owner",
            buttons: [
                { buttonId: '.owner', buttonText: { displayText: '👑 CONTACT OWNER' }, type: 1 }
            ],
            contextInfo: newsletterConfig
        }, { quoted: msg });

    } catch (e) {
        console.error("JID Error:", e);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred: ${e.message || e}`
        }, { quoted: msg });
    }
    break;
}
//vcf case
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
case 'joke': {
    try {
        const axios = require('axios');
        
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const { data } = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 15000 });
        if (!data?.setup || !data?.punchline) {
            throw new Error('Failed to fetch joke');
        }

        const caption = `
╭━━〔 *ʀᴀɴᴅᴏᴍ ᴊᴏᴋᴇ* 〕━━┈⊷
├ *sᴇᴛᴜᴘ*: ${data.setup} 🤡
├ *ᴘᴜɴᴄʜʟɪɴᴇ*: ${data.punchline} 😂
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Joke error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch joke* 😞'
        }, { quoted: msg });
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
case 'readmore':
case 'rm':
case 'rmore':
case 'readm': {
    try {
        // Extract text from message
        const q = msg.message?.conversation || '';
        const args = q.split(' ').slice(1);
        const inputText = args.join(' ') || 'No text provided';

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const readMore = String.fromCharCode(8206).repeat(4000);
        const message = `${inputText}${readMore} *Continue Reading...*`;

        const caption = `
╭───[ *ʀᴇᴀᴅ ᴍᴏʀᴇ* ]───
├ *ᴛᴇxᴛ*: ${message} 📝
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Readmore error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: `❌ *Error creating read more:* ${error.message || 'unknown error'}`
        }, { quoted: msg });
    }
    break;
}
//case cat
case "cat": {
    try {
        await socket.sendMessage(sender, { react: { text: '🐱', key: msg.key } });
        const res = await fetch('https://api.thecatapi.com/v1/images/search');
        const data = await res.json();
        if (!data || !data[0]?.url) {
            await socket.sendMessage(sender, { 
                text: '❌ Couldn\'t fetch cat image.' 
            }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data[0].url },
            caption: '🐱 Meow~ Here\'s a cute cat for you!',
            buttons: [
                { buttonId: '.cat', buttonText: { displayText: '🐱 Another Cat' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { 
            text: '❌ Failed to fetch cat image.',
            buttons: [
                { buttonId: '.cat', buttonText: { displayText: '🔄 Try Again' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}
//case dog 
case "dog": {
    try {
        await socket.sendMessage(sender, { react: { text: '🦮', key: msg.key } });
        const res = await fetch('https://dog.ceo/api/breeds/image/random');
        const data = await res.json();
        if (!data || !data.message) {
            await socket.sendMessage(sender, { 
                text: '❌ Couldn\'t fetch dog image.' 
            }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.message },
            caption: '🐶 Woof! Here\'s a cute dog!',
            buttons: [
                { buttonId: '.dog', buttonText: { displayText: '🐶 Another Dog' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { 
            text: '❌ Failed to fetch dog image.',
            buttons: [
                { buttonId: '.dog', buttonText: { displayText: '🔄 Try Again' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}

case 'fact': {
    try {
        const axios = require('axios');
        
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const { data } = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 15000 });
        if (!data?.text) throw new Error('Failed to fetch fact');

        const caption = `
╭───[ *ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ* ]───
├ *ғᴀᴄᴛ*: ${data.text} 🧠
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Fact error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch fun fact* 😞'
        }, { quoted: msg });
    }
    break;
}
case 'flirt':
case 'masom':
case 'line': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/flirt?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ғʟɪʀᴛ ʟɪɴᴇ* ]───
├ *ʟɪɴᴇ*: ${result} 💘
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Flirt error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch flirt line* 😞'
        }, { quoted: msg });
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

case 'truth':
case 'truthquestion': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/truth?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴛʀᴜᴛʜ ǫᴜᴇsᴛɪᴏɴ* ]───
├ *ǫᴜᴇsᴛɪᴏɴ*: ${result} ❓
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Truth error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch truth question* 😞'
        }, { quoted: msg });
    }
    break;
}
// ┏━━━━━━━━━━━━━━━❖
// ┃ ROMANTIC, SAVAGE & THINKY COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case 'pickupline':
case 'pickup': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://api.popcat.xyz/pickuplines', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { pickupline } = await res.json();
        if (!pickupline) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ* ]───
├ *ʟɪɴᴇ*: ${pickupline} 💬
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Pickupline error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch pickup line* 😞'
        }, { quoted: msg });
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
case 'dare':
case 'truthordare': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/dare?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴅᴀʀᴇ ᴄʜᴀʟʟᴇɴɢᴇ* ]───
├ *ᴅᴀʀᴇ*: ${result} 🎯
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Dare error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch dare* 😞'
        }, { quoted: msg });
    }
    break;
}

//===============================
case 'fbdl':
case 'facebook':
case 'fbvideo':
case 'fb': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const fbUrl = args[0];

        if (!fbUrl || !fbUrl.includes("facebook.com")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid Facebook video URL.*\nExample: .fbdl https://facebook.com/video/123'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Prepare the primary API URL
        const primaryApiUrl = `https://apis.davidcyriltech.my.id/facebook2?url=${encodeURIComponent(fbUrl)}`;
        
        // Prepare fallback APIs
        const fallbackApis = [
            `https://kaiz-apis.gleeze.com/api/fbdl?url=${encodeURIComponent(fbUrl)}&apikey=cf2ca612-296f-45ba-abbc-473f18f991eb`,
            `https://api.giftedtech.web.id/api/download/facebook?apikey=gifted&url=${encodeURIComponent(fbUrl)}`
        ];

        let videoData = null;
        let apiIndex = 0;
        const apis = [primaryApiUrl, ...fallbackApis];

        // Try each API until we get a successful response
        while (apiIndex < apis.length && !videoData) {
            try {
                const response = await axios.get(apis[apiIndex], { timeout: 15000 });
                
                // Parse response based on which API responded
                if (apiIndex === 0) {
                    // Primary API response format
                    if (response.data && response.data.status && response.data.video) {
                        const { title, thumbnail, downloads } = response.data.video;
                        videoData = {
                            title: title || "Facebook Video",
                            thumbnail,
                            downloadUrl: downloads.find(d => d.quality === "HD")?.downloadUrl || downloads[0]?.downloadUrl,
                            quality: downloads.find(d => d.quality === "HD") ? "HD" : "SD"
                        };
                    }
                } else if (apiIndex === 1) {
                    // Kaiz API response format
                    if (response.data && response.data.videoUrl) {
                        videoData = {
                            title: response.data.title || "Facebook Video",
                            thumbnail: response.data.thumbnail,
                            downloadUrl: response.data.videoUrl,
                            quality: response.data.quality || "HD"
                        };
                    }
                } else if (apiIndex === 2) {
                    // GiftedTech API response format
                    if (response.data && response.data.success && response.data.result) {
                        const result = response.data.result;
                        videoData = {
                            title: result.title || "Facebook Video",
                            thumbnail: result.thumbnail,
                            downloadUrl: result.hd_video || result.sd_video,
                            quality: result.hd_video ? "HD" : "SD"
                        };
                    }
                }
            } catch (error) {
                console.error(`Error with API ${apiIndex}:`, error.message);
            }
            apiIndex++;
        }

        if (!videoData) {
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return await socket.sendMessage(sender, {
                text: '❌ *All download services failed.*\nPlease try again later or use a different Facebook URL.'
            }, { quoted: msg });
        }

        // Send downloading message
        const loadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Downloading Facebook video... Please wait* 📥'
        }, { quoted: msg });

        try {
            // Download the video with timeout
            const videoResponse = await axios.get(videoData.downloadUrl, { 
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!videoResponse.data) {
                throw new Error('Empty video response');
            }

            // Prepare the video buffer
            const videoBuffer = Buffer.from(videoResponse.data, 'binary');

            // Send the video with details
            await socket.sendMessage(sender, {
                video: videoBuffer,
                caption: `📥 *Facebook Video Download*\n\n` +
                    `🔖 *Title:* ${videoData.title}\n` +
                    `📏 *Quality:* ${videoData.quality}\n\n` +
                    `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
                contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                        title: 'Facebook Video Download',
                        body: `Quality: ${videoData.quality}`,
                        mediaType: 2,
                        sourceUrl: fbUrl,
                        thumbnailUrl: videoData.thumbnail
                    }
                }
            }, { quoted: msg });

            // Delete the loading message
            await socket.sendMessage(sender, {
                delete: loadingMsg.key
            });

            // Send success reaction
            await socket.sendMessage(sender, {
                react: {
                    text: "✅",
                    key: msg.key
                }
            });

        } catch (downloadError) {
            console.error('Video download failed:', downloadError);
            await socket.sendMessage(sender, {
                text: '❌ *Failed to download video.*\nThe video might be too large or restricted.'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Facebook download error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: '❌ *Unable to process Facebook video.*\nPlease check the URL and try again later.'
        }, { quoted: msg });
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

        // Using URL directly (if your library supports it)
        await socket.sendMessage(from, {
            text: `👥 Active Members: *${activeCount}*\n\nNumbers:\n${activeNumbers}`,
            contextInfo: {
                externalAdReply: {
                    title: 'Powered by CaseyRhodes Tech 👻',
                    body: 'Active Members Report',
                    mediaType: 1,
                    sourceUrl: 'https://wa.me/1234567890',
                    thumbnailUrl: 'https://files.catbox.moe/k3wgqy.jpg'
                }
            }
        }, { quoted: msg });

    } catch (error) {
        console.error('Error in .active command:', error);
        await socket.sendMessage(from, { text: '❌ Oh, darling, I couldn\'t count the active souls! 💔 Try again?' }, { quoted: fakevCard });
    }
    break;
}
                //===============================
// 22
case 'ai': {
    const axios = require("axios");

    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, {
            text: `❓ *Please ask me something*\n\n` +
                  `*Example:* ${config.PREFIX}ai Who are you?`
        }, { quoted: fakevCard });
    }

    // Function to handle custom responses
    const getCustomResponse = (text, prefix) => {
        const lowerText = text.toLowerCase();
        
        // Check for owner/developer related queries
        if (lowerText.includes('owner') || lowerText.includes('developer') || lowerText.includes('creator') || 
            lowerText.includes('who owns you') || lowerText.includes('who created you') || 
            lowerText.includes('who developed you') || lowerText.includes('who built you')) {
            
            return {
                text: `*👨‍💻 MEET THE DEVELOPER*\n\n🇰🇪 *Primary Developer:* CaseyRhodes Tech\n• Location: Kenya\n• Specialization: AI Integration & Bot Development\n• Role: Lead Developer & Project Owner\n\n🤖 *Technical Partner:* Caseyrhodes\n• Specialization: Backend Systems & API Management\n• Role: Technical Support & Infrastructure\n\n*About Our Team:*\nCasey AI is the result of a CaseyRhodes Tech  Together, we bring you cutting-edge AI technology with reliable bot functionality, ensuring you get the best AI experience possible.\n\n*Proudly Made in Kenya* 🇰🇪`,
                footer: "CaseyRhodes Tech - Kenyan Innovation",
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: "MAIN MENU" }, type: 1 },
                    { buttonId: `${prefix}aimenu`, buttonText: { displayText: "AI MENU" }, type: 1 },
                    { buttonId: `${prefix}owner`, buttonText: { displayText: "GET SUPPORT" }, type: 1 }
                ],
                headerType: 1
            };
        }
        
        // Check for creation date/when made queries
        if (lowerText.includes('when were you made') || lowerText.includes('when were you created') || 
            lowerText.includes('when were you developed') || lowerText.includes('creation date') || 
            lowerText.includes('when did you start') || lowerText.includes('how old are you') ||
            lowerText.includes('when were you built') || lowerText.includes('release date')) {
            
            return {
                text: `*📅 CASEY AI TIMELINE*\n\n🚀 *Development Started:* December 2025\n🎯 *First Release:* January 2025\n🔄 *Current Version:* 2.0 (February 2025)\n\n*Development Journey:*\n• *Phase 1:* Core AI integration and basic functionality\n• *Phase 2:* Enhanced response system and multi-API support\n• *Phase 3:* Advanced customization and user experience improvements\n\n*What's Next:*\nWe're constantly working on updates to make Casey AI smarter, faster, and more helpful. Stay tuned for exciting new features!\n\n*Age:* Just a few months old, but getting smarter every day! 🧠✨`,
                footer: "Casey AI - Born in Kenya, Growing Worldwide",
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: "MAIN MENU" }, type: 1 },
                    { buttonId: `${prefix}aimenu`, buttonText: { displayText: "AI MENU" }, type: 1 },
                    { buttonId: `${prefix}owner`, buttonText: { displayText: "MEET DEVS OF ME" }, type: 1 }
                ],
                headerType: 1
            };
        }

        // Check for AI name queries
        if (lowerText.includes('what is your name') || lowerText.includes('what\'s your name') || 
            lowerText.includes('tell me your name') || lowerText.includes('your name') || 
            lowerText.includes('name?') || lowerText.includes('called?')) {
            
            return {
                text: `*🏷️ MY NAME*\n\n👋 Hello! My name is *CASEY AI*\n\n*About My Name:*\n• Full Name: Casey AI\n• Short Name: Casey\n• You can call me: Casey, Casey AI, or just AI\n\n*Name Origin:*\nI'm named after my primary developer *CaseyRhodes Tech*, combining the personal touch of my creator with the intelligence of artificial intelligence technology.\n\n*What Casey Stands For:*\n🔹 *C* - Creative Problem Solving\n🔹 *A* - Advanced AI Technology\n🔹 *S* - Smart Assistance\n🔹 *E* - Efficient Responses\n🔹 *Y* - Your Reliable Companion\n\n*Made in Kenya* 🇰🇪 *by CaseyRhodes Tech*`,
                footer: "Casey AI - That's Me! 😊",
                buttons: [
                    { buttonId: `${prefix}aimenu`, buttonText: { displayText: "AI MENU" }, type: 1 },
                    { buttonId: `${prefix}bowner`, buttonText: { displayText: "MEET MY DEVS" }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: "MAIN MENU" }, type: 1 }
                ],
                headerType: 1
            };
        }

        // Check for general info about Casey AI
        if (lowerText.includes('what are you') || lowerText.includes('tell me about yourself') || 
            lowerText.includes('who are you') || lowerText.includes('about casey')) {
            
            return {
                text: `👋 Hi! I'm *Casey AI*, your intelligent WhatsApp assistant developed by CaseyRhodes Tech.\n\n*What I Can Do:*\n• Answer questions on any topic\n• Help with problem-solving\n• Provide information and explanations\n• Assist with creative tasks\n• Engage in meaningful conversations\n\n*My Features:*\n✅ Advanced AI technology\n✅ Multi-language support\n✅ Fast response times\n✅ Reliable dual-API system\n✅ User-friendly interface\n\n*My Identity:*\n• Name: Casey AI\n• Origin: Kenya 🇰🇪\n• Purpose: Making AI accessible and helpful\n\n*Proudly Kenyan:* 🇰🇪\nBuilt with passion in Kenya, serving users worldwide with cutting-edge AI technology.\n\nHow can I assist you today?`,
                footer: "Casey AI - Your Intelligent WhatsApp Companion",
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: "AI MENU" }, type: 1 },
                    { buttonId: `${prefix}owner`, buttonText: { displayText: "MEET DEVS" }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: "MAIN MENU" }, type: 1 }
                ],
                headerType: 1
            };
        }

        // Return null if no custom response matches
        return null;
    };

    // Check for custom responses first
    const customResponse = getCustomResponse(q, config.PREFIX);
    if (customResponse) {
        return await socket.sendMessage(sender, {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: customResponse.text,
            footer: customResponse.footer,
            buttons: customResponse.buttons,
            headerType: customResponse.headerType
        }, { quoted: fakevCard });
    }

    const apis = [
        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(q)}`,
        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(q)}`,
        `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(q)}`
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
            text: `❌ *I'm experiencing technical difficulties*\n` +
                  `Please try again in a moment.`
        }, { quoted: fakevCard });
    }

    // Add professional buttons
    const buttons = [
        {buttonId: `${config.PREFIX}ai`, buttonText: {displayText: '🌟 Ask Again'}, type: 1},
        {buttonId: `${config.PREFIX}menu`, buttonText: {displayText: '🎀 Menu'}, type: 1},
        {buttonId: `${config.PREFIX}owner`, buttonText: {displayText: '👨‍💻 Owner'}, type: 1}
    ];

    // Add owner message
    const ownerMessage = `\n\n👨‍💻 *Developer:* ${config.OWNER_NAME}`;

    // Send AI response with image and buttons
    await socket.sendMessage(sender, {
        image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
        caption: `🤖 *Caseyrhodes AI:*\n\n` + response + ownerMessage,
        footer: "Powered by Caseyrhodes AI",
        buttons: buttons,
        headerType: 4
    }, { quoted: fakevCard });
    
    break;
}

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
                    { buttonId: '.menu', buttonText: { displayText: '🌸 Menu' }, type: 1 },
                    { buttonId: '.alive', buttonText: { displayText: '♻️ Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        } else {
            await socket.sendMessage(msg.key.remoteJid, {
                text: `@${targetUser.split('@')[0]} doesn't have a profile picture.`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: '.menu', buttonText: { displayText: '🌸 Menu' }, type: 1 },
                    { buttonId: '.alive', buttonText: { displayText: '♻️ Status' }, type: 1 }
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
                
         //get github username details 
case 'github':
case 'gh': {
  try {
    const username = args[0];

    if (!username) {
      await socket.sendMessage(from, {
        text: '📦 *Please provide a GitHub username.*\nExample: .github caseyrhodes'
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

    try {
      const response = await axios.get(`https://api.github.com/users/${username}`);
      const data = response.data;

      if (data.message === 'Not Found') {
        await socket.sendMessage(from, {
          text: '❌ *GitHub user not found.*\nPlease check the username and try again.'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        break;
      }

      const profilePic = `https://github.com/${data.login}.png`;

      const userInfo = `
🌐 *GitHub User Info*

👤 *Name:* ${data.name || 'N/A'}
🔖 *Username:* ${data.login}
📝 *Bio:* ${data.bio || 'N/A'}
🏢 *Company:* ${data.company || 'N/A'}
📍 *Location:* ${data.location || 'N/A'}
📧 *Email:* ${data.email || 'N/A'}
🔗 *Blog:* ${data.blog || 'N/A'}
📂 *Public Repos:* ${data.public_repos}
👥 *Followers:* ${data.followers}
🤝 *Following:* ${data.following}
📅 *Created:* ${new Date(data.created_at).toLocaleDateString()}
🔄 *Updated:* ${new Date(data.updated_at).toLocaleDateString()}
      `.trim();

      // Create a button to download the profile info
      const buttonMessage = {
        image: { url: profilePic },
        caption: userInfo,
        footer: 'Click the button below to download this profile info',
        buttons: [
          {
            buttonId: `.allmenu`,
            buttonText: { displayText: '🎀ᴀʟʟ ᴍᴇɴᴜ ' },
            type: 1
          }
        ],
        headerType: 4
      };

      await socket.sendMessage(from, buttonMessage, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
      console.error('GitHub API error:', err);
      await socket.sendMessage(from, {
        text: '⚠️ Error fetching GitHub user. Please try again later.'
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
  } catch (error) {
    console.error('GitHub command error:', error);
    await socket.sendMessage(from, {
      text: '❌ An unexpected error occurred. Please try again.'
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
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
                    buttonId: '.close',
                    buttonText: { displayText: '🔒 Close Group' },
                    type: 1
                },
                {
                    buttonId: '.settings',
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
            { buttonId: '.open', buttonText: { displayText: 'Open Group' }, type: 1 },
            { buttonId: '.settings', buttonText: { displayText: 'Settings' }, type: 1 }
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
case 'tiny':
case 'short':
case 'shorturl': {
    console.log("Command tiny triggered");
    
    if (!args[0]) {
        console.log("No URL provided");
        return await socket.sendMessage(sender, {
            text: "*🏷️ ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴍᴇ ᴀ ʟɪɴᴋ.*"
        }, { quoted: msg });
    }

    try {
        const link = args[0];
        console.log("URL to shorten:", link);
        const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`);
        const shortenedUrl = response.data;

        console.log("Shortened URL:", shortenedUrl);
        
        // Fetch an image for thumbnail (using a generic URL shortener icon)
        const thumbnailResponse = await axios.get('https://cdn-icons-png.flaticon.com/512/1006/1006771.png', { 
            responseType: 'arraybuffer' 
        });
        const thumbnailBuffer = Buffer.from(thumbnailResponse.data);
        
        const messageOptions = {
            text: `*🧑‍💻 YOUR SHORTENED URL*\n\n${shortenedUrl}`,
            headerType: 4,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                externalAdReply: {
                    title: 'powered by caseyrhodes tech 👻',
                    body: 'Link shortened successfully',
                    mediaType: 1,
                    sourceUrl: link,
                    thumbnail: thumbnailBuffer
                }
            }
        };
        
        return await socket.sendMessage(sender, messageOptions, { quoted: msg });
    } catch (e) {
        console.error("Error shortening URL:", e);
        return await socket.sendMessage(sender, {
            text: "An error occurred while shortening the URL. Please try again."
        }, { quoted: msg });
    }
    break;
}
///ᴏᴡɴᴇʀ ᴅᴇᴀᴛᴀɪʟs
case 'owner':
case 'creator':
case 'developer': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "👑", // Crown emoji for owner
            key: msg.key
        }
    });

    const botOwner = "ᴄᴀsᴇʏʀʜᴏᴅᴇs"; // Owner name
    const ownerNumber = "254704472907"; // Hardcoded owner number

    const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:${botOwner}
TEL;waid=${ownerNumber}:${ownerNumber}
END:VCARD
`;

    await socket.sendMessage(sender, {
        contacts: {
            displayName: botOwner,
            contacts: [{ vcard }]
        }
    }, { quoted: fakevCard });

    // Send message with button
    const buttonMessage = {
        text: `*👑 Bot Owner Details*\n\n` +
              `*Name:* ${botOwner}\n` +
              `*Contact:* ${ownerNumber}\n\n` +
              `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ🌟`,
        footer: 'Need help or have questions?',
        buttons: [
            {
                buttonId: '.contact-owner',
                buttonText: { displayText: '🎀 Contact Owner' },
                type: 1
            }
        ],
        headerType: 1
    };

    await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    
    break;
}
// Add this to your button handling section
case 'contact-owner': {
    try {
        // Send a pre-filled message to contact the owner
        await socket.sendMessage(from, {
            text: `Hello! I'd like to get in touch with you about your bot.`
        }, { quoted: msg });
        
        // Optionally send the contact card again
        const botOwner = "ᴄᴀsᴇʏʀʜᴏᴅᴇs";
        const ownerNumber = "254704472907";
        
        const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:${botOwner}
TEL;waid=${ownerNumber}:${ownerNumber}
END:VCARD
`;

        await socket.sendMessage(from, {
            contacts: {
                displayName: botOwner,
                contacts: [{ vcard }]
            }
        }, { quoted: msg });
        
    } catch (error) {
        console.error('Contact button error:', error);
        await socket.sendMessage(from, {
            text: '❌ Error processing your request.'
        }, { quoted: msg });
    }
    break;
}
// case 39: weather
case 'weather':
case 'climate': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "❄️", // Snowflake emoji for weather
            key: msg.key
        }
    });

    const axios = require('axios');

    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';
    
    const args = q.trim().split(' ').slice(1); // Remove the command itself
    const location = args.join(' ');

    if (!location) {
        return await socket.sendMessage(sender, {
            text: '❄️ *Please provide a location to check the weather!*\n\n' +
                  'Example: *.weather London*\n' +
                  'Example: *.weather New York*\n' +
                  'Example: *.weather Tokyo, Japan*'
        }, { quoted: fakevCard });
    }

    try {
        const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
            params: {
                q: location,
                units: 'metric',
                appid: '060a6bcfa19809c2cd4d97a212b19273',
                language: 'en'
            }
        });

        const data = res.data;
        const sunrise = new Date(data.sys.sunrise * 1000).toLocaleTimeString();
        const sunset = new Date(data.sys.sunset * 1000).toLocaleTimeString();
        const rain = data.rain ? data.rain['1h'] : 0;

        const text = `❄️ *🌸 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐖𝐄𝐀𝐓𝐇𝐄𝐑 🌸*\n\n` +
                     `*📍 Location:* ${data.name}, ${data.sys.country}\n\n` +
                     `🌡️ *Temperature:* ${data.main.temp}°C\n` +
                     `🤔 *Feels like:* ${data.main.feels_like}°C\n` +
                     `📉 *Min:* ${data.main.temp_min}°C  📈 *Max:* ${data.main.temp_max}°C\n` +
                     `📝 *Condition:* ${data.weather[0].description}\n` +
                     `💧 *Humidity:* ${data.main.humidity}%\n` +
                     `🌬️ *Wind:* ${data.wind.speed} m/s\n` +
                     `☁️ *Cloudiness:* ${data.clouds.all}%\n` +
                     `🌧️ *Rain (last hour):* ${rain} mm\n` +
                     `🌄 *Sunrise:* ${sunrise}\n` +
                     `🌅 *Sunset:* ${sunset}\n` +
                     `🧭 *Coordinates:* ${data.coord.lat}, ${data.coord.lon}\n\n` +
                     `_Powered by CaseyRhodes Tech_ 🌟`;

        await socket.sendMessage(sender, {
            text: text,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ🎀',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('[WEATHER ERROR]', error);
        await socket.sendMessage(sender, {
            text: '❌ *Failed to fetch weather data!*\n\n' +
                  'Please check:\n' +
                  '• Location spelling\n' +
                  '• Internet connection\n' +
                  '• Try a different location\n\n' +
                  'Example: *.weather Paris* or *.weather Mumbai*'
        }, { quoted: fakevCard });
    }
    break;
}
//Helloo
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
      //case repository 
//case repository 
case 'repo':
case 'sc':
case 'script': {
    try {
        await socket.sendMessage(sender, { react: { text: '🪄', key: msg.key } });
        const githubRepoURL = 'https://github.com/caseyweb/CASEYRHODES-XMD';
        
        const response = await fetch(`https://api.github.com/repos/caseyweb/CASEYRHODES-XMD`);
        
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        
        const repoData = await response.json();

        const formattedInfo = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 🎀*
*╭──────────────⊷*
*┃* *ɴᴀᴍᴇ*   : ${repoData.name}
*┃* *sᴛᴀʀs*    : ${repoData.stargazers_count}
*┃* *ғᴏʀᴋs*    : ${repoData.forks_count}
*┃* *ᴏᴡɴᴇʀ*   : ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃* *ᴅᴇsᴄ* : ${repoData.description || 'ɴ/ᴀ'}
*╰──────────────⊷*
`;

        const imageContextInfo = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363420261263259@newsletter',
                newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                serverMessageId: -1
            }
        };

        const repoMessage = {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: formattedInfo,
            contextInfo: imageContextInfo,
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
            ]
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
    
    // Fetch thumbnail and convert to buffer
    const thumbnailResponse = await fetch('https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png');
    const thumbnailBuffer = await thumbnailResponse.arrayBuffer();
    
    await socket.sendMessage(sender, {
        text: `🌐 *Click to visit the repo:*\nhttps://github.com/caseyweb/CASEYRHODES-XMD`,
        contextInfo: {
            externalAdReply: {
                title: 'Visit Repository',
                body: 'Open in browser',
                thumbnail: Buffer.from(thumbnailBuffer),
                mediaType: 1,
                mediaUrl: 'https://github.com/caseyweb/CASEYRHODES-XMD',
                sourceUrl: 'https://github.com/caseyweb/CASEYRHODES-XMD',
                renderLargerThumbnail: false
            }
        }
    }, { quoted: fakevCard });
    break;
}

case 'repo-owner': {
    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
    
    // Fetch thumbnail and convert to buffer
    const thumbnailResponse = await fetch('https://i.ibb.co/fGSVG8vJ/caseyweb.jpg');
    const thumbnailBuffer = await thumbnailResponse.arrayBuffer();
    
    await socket.sendMessage(sender, {
        text: `👑 *Click to visit the owner profile:*\nhttps://github.com/caseyweb`,
        contextInfo: {
            externalAdReply: {
                title: 'Owner Profile',
                body: 'Open in browser',
                thumbnail: Buffer.from(thumbnailBuffer),
                mediaType: 1,
                mediaUrl: 'https://github.com/caseyweb',
                sourceUrl: 'https://github.com/caseyweb',
                renderLargerThumbnail: false
            }
        }
    }, { quoted: fakevCard });
    break;
}

case 'repo-audio': {
    await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
    
    // Send audio file instead of video to avoid errors
    try {
        await socket.sendMessage(sender, {
            audio: { url: 'https://files.catbox.moe/0aoqzx.mp3' }, // Replace with actual audio URL
            mimetype: 'audio/mp4',
            ptt: false
        }, { quoted: fakevCard });
    } catch (audioError) {
        console.error("Audio error:", audioError);
        // Fallback to text if audio fails
        await socket.sendMessage(sender, {
            text: "🎵 *Audio Introduction*\n\nSorry, the audio is currently unavailable. Please try again later."
        }, { quoted: fakevCard });
    }
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

// Single message with image, buttons, and newsletter context
await socket.sendMessage(userJid, {
    image: { url: config.RCD_IMAGE_PATH },
    caption: formatMessage(
        '👻 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 👻',
        `✅ Successfully connected!\n\n` +
        `🔢 ɴᴜᴍʙᴇʀ: ${sanitizedNumber}\n` +
        `🏠 ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}\n` +
        `⏰ ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}\n\n` +
        `📢 ғᴏʟʟᴏᴡ ᴍᴀɪɴ ᴄʜᴀɴɴᴇʟ 👇\n` +
        `> https://whatsapp.com/channel/0029Vb6TqBXGk1Ftb9397f0r\n\n` +
        `🤖 ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!`,
        '> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ 🎀'
    ),
    buttons: [
        { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: '👑 OWNER' }, type: 1 },
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🎀 MENU' }, type: 1 }
    ],
    headerType: 4,
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363420261263259@newsletter',
            newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
            serverMessageId: -1
        }
    }
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
