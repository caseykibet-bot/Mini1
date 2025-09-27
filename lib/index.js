const antilinkMap = new Map();

function setAntilink(chatId, status, action = 'delete') {
    try {
        antilinkMap.set(chatId, { enabled: status === 'on', action });
        return true;
    } catch (error) {
        console.error('Error setting antilink:', error);
        return false;
    }
}

function getAntilink(chatId) {
    return antilinkMap.get(chatId) || { enabled: false, action: 'delete' };
}

function removeAntilink(chatId) {
    return antilinkMap.delete(chatId);
}

module.exports = {
    setAntilink,
    getAntilink,
    removeAntilink
};
