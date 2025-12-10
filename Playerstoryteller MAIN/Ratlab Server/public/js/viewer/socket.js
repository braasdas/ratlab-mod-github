import { updateConnectionStatus } from './ui.js';

export const socket = io();

socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
    socket.emit('get-sessions');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
});
