
export default {
    template: `
        <div class="container mx-auto px-4 py-8">
            <header class="flex justify-between items-center mb-8">
                <h1 class="text-4xl font-bold text-white">🎮 RimWorld Player Storyteller</h1>
                <div :class="['status', { 'connected': connected, 'disconnected': !connected }]">
                    <span class="status-dot"></span>
                    <span class="status-text">{{ connected ? 'Connected' : 'Disconnected' }}</span>
                </div>
            </header>

            <h2 class="text-3xl font-bold text-center mb-8 text-white">Select a Game Session</h2>

            <div v-if="sessions.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div v-for="session in sessions" :key="session.sessionId" @click="selectSession(session.sessionId)"
                    class="session-card bg-gray-800 rounded-lg p-6 cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold text-accent">{{ session.mapName }}</h3>
                        <div class="network-quality-badge" :style="{ backgroundColor: getNetworkQualityColor(session.networkQuality) }">
                            {{ getNetworkQualityLabel(session.networkQuality) }}
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4 text-gray-400">
                        <div><span class="font-semibold text-gray-300">Colonists:</span> {{ session.colonistCount }}</div>
                        <div><span class="font-semibold text-gray-300">Wealth:</span> \${{ session.wealth.toLocaleString() }}</div>
                        <div><span class="font-semibold text-gray-300">Enemies:</span> {{ session.enemiesCount }}</div>
                        <div><span class="font-semibold text-gray-300">Viewers:</span> {{ session.playerCount }}</div>
                    </div>
                </div>
            </div>
            <div v-else class="text-center text-gray-500 mt-16">
                <p class="text-2xl">No active game sessions found</p>
                <p class="text-lg mt-2">Start RimWorld with the Player Storyteller mod to begin</p>
            </div>
        </div>
    `,
    data() {
        return {
            sessions: [],
            connected: false,
        };
    },
    methods: {
        selectSession(sessionId) {
            this.$router.push({ name: 'session', params: { id: sessionId } });
        },
        getNetworkQualityColor(quality) {
            switch (quality) {
                case 'high':
                case 'medium-high':
                    return '#4caf50'; // Green
                case 'medium':
                case 'low-medium':
                    return '#ff9800'; // Yellow/Orange
                case 'low':
                    return '#f44336'; // Red
                default:
                    return '#ff9800'; // Default to yellow
            }
        },
        getNetworkQualityLabel(quality) {
            switch (quality) {
                case 'high':
                    return 'High';
                case 'medium-high':
                    return 'Med-High';
                case 'medium':
                    return 'Medium';
                case 'low-medium':
                    return 'Low-Med';
                case 'low':
                    return 'Low';
                default:
                    return 'Unknown';
            }
        },
    },
    mounted() {
        this.sessions = this.$root.sessions;
        this.$root.socket.on('sessions-list', (data) => {
            this.sessions = data.sessions;
        });

        this.connected = this.$root.socket.connected;
        this.$root.socket.on('connect', () => {
            this.connected = true;
        });
        this.$root.socket.on('disconnect', () => {
            this.connected = false;
        });
    }
};
