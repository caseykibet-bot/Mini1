async function isAdmin(chatId, msg) {
    try {
        const groupMetadata = await socket.groupMetadata(chatId);
        const participants = groupMetadata.participants;
        const user = participants.find(p => p.id === msg.key.participant || p.id === msg.key.remoteJid);
        return user && (user.admin === 'admin' || user.admin === 'superadmin');
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

module.exports = isAdmin;
