"use strict";

// Presence exposes only a connection ID and nickname, never addresses or admin data.
function sendAuxPresence(socket, connections) {
    if (socket.isObserver || socket.readyState !== 1) return;
    const aux = socket.clientInfo?.aux;
    const peers = aux == null ? [] : connections.filter(other => other !== socket && !other.isObserver &&
        other.readyState === 1 && other.clientInfo?.aux === aux).map(other => ({
        id: String(other.clientInfo.id), nickname: other.clientInfo.username || null
    }));
    try { socket.send(JSON.stringify({ presence: { aux, peers } })); } catch {}
}
function broadcastAuxPresence(connections, aux) {
    if (aux == null) return;
    for (const socket of connections) if (socket.clientInfo?.aux === aux) sendAuxPresence(socket, connections);
}
module.exports = { sendAuxPresence, broadcastAuxPresence };
