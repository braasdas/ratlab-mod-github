
export default {
    template: `
        <div class="h-screen flex flex-col">
            <header class="bg-gray-800 p-4 flex justify-between items-center shadow-md">
                <button @click="goBack" class="btn-back bg-gray-700 hover:bg-accent text-white font-bold py-2 px-4 rounded transition-colors duration-300">
                    ← Back to Sessions
                </button>
                <div class="text-center">
                    <h2 class="text-2xl font-bold">{{ session.mapName }}</h2>
                    <div class="flex gap-4 text-gray-400 text-sm">
                        <span>{{ colonistCount }} colonists</span>
                        <span>Wealth: \${{ wealth.toLocaleString() }}</span>
                        <span>{{ viewerCount }} viewers</span>
                    </div>
                </div>
                <div class="w-32"></div>
            </header>

            <main class="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 overflow-hidden">
                <!-- Main content: Video Stream and Actions -->
                <div class="lg:col-span-3 flex flex-col gap-4">
                    <div class="flex-1 relative rounded-lg overflow-hidden bg-black">
                        <video ref="videoPlayer" autoplay muted playsinline class="w-full h-full object-contain"></video>
                        <div v-if="connectionStatus" class="absolute top-4 left-4 px-3 py-1 rounded text-sm font-semibold"
                             :class="connectionStatus === 'Connected' ? 'bg-green-600' : connectionStatus === 'Connecting...' ? 'bg-yellow-600' : 'bg-red-600'">
                            {{ connectionStatus }}
                        </div>
                        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-white">
                            {{ streamInfo }}
                        </div>
                    </div>
                    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
                        <h3 class="text-xl font-bold mb-4 text-accent">Storyteller Actions</h3>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <button @click="sendAction('raid')" class="action-btn bg-gray-700 hover:bg-red-600">Send Raid</button>
                            <button @click="sendAction('resource')" class="action-btn bg-gray-700 hover:bg-green-600">Send Resources</button>
                            <button @click="sendAction('event')" class="action-btn bg-gray-700 hover:bg-blue-600">Random Event</button>
                            <button @click="sendAction('weather')" class="action-btn bg-gray-700 hover:bg-yellow-600">Change Weather</button>
                        </div>
                    </div>
                </div>

                <!-- Side panel: Colonists and Stats -->
                <aside class="bg-gray-800 rounded-lg p-4 overflow-y-auto shadow-inner">
                    <div class="mb-6">
                        <h3 class="text-xl font-bold mb-4 text-accent">Colonists</h3>
                        <div v-if="colonists.length > 0" class="space-y-4">
                            <div v-for="colonist in colonists" :key="colonist.id" class="bg-gray-700 p-3 rounded-lg">
                                <h4 class="font-bold">{{ colonist.colonist.name }}</h4>
                                <div class="text-sm text-gray-400">
                                    <p>Health: {{ Math.round(colonist.colonist.health * 100) }}%</p>
                                    <p>Mood: {{ Math.round(colonist.colonist.mood * 100) }}%</p>
                                </div>
                            </div>
                        </div>
                        <p v-else class="text-gray-500">No colonist data available.</p>
                    </div>

                    <div>
                        <h3 class="text-xl font-bold mb-4 text-accent">Colony Stats</h3>
                        <div class="space-y-4 text-sm">
                            <div>
                                <h4 class="font-semibold mb-2">Power</h4>
                                <p>Generated: {{ power.current_power || 0 }} W</p>
                                <p>Consumed: {{ power.total_consumption || 0 }} W</p>
                            </div>
                            <div>
                                <h4 class="font-semibold mb-2">Creatures</h4>
                                <p>Enemies: {{ creatures.enemies_count || 0 }}</p>
                                <p>Animals: {{ creatures.animals_count || 0 }}</p>
                            </div>
                             <div>
                                <h4 class="font-semibold mb-2">Research</h4>
                                <p>{{ research.label || 'None' }} ({{ Math.round(research.progress_percent || 0) }}%)</p>
                            </div>
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    `,
    data() {
        return {
            session: {},
            colonists: [],
            power: {},
            creatures: {},
            research: {},
            viewerCount: 0,
            wealth: 0,
            colonistCount: 0,
            connectionStatus: 'Disconnected',
            streamInfo: 'Waiting for stream...',
            streamWs: null,
            mediaSource: null,
            sourceBuffer: null,
            segmentQueue: [],
            isAppending: false
        };
    },
    methods: {
        goBack() {
            this.$router.push('/');
        },
        sendAction(action) {
            fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.$route.params.id,
                    action: action,
                    data: {}
                })
            }).then(res => res.json()).then(data => {
                console.log(`Action '${action}' sent.`);
            }).catch(err => console.error(err));
        },
        updateGameState(gameState) {
            this.colonists = gameState.colonists || [];
            this.power = gameState.power || {};
            this.creatures = gameState.creatures || {};
            this.research = gameState.research || {};
            const resources = gameState.resources || {};
            this.wealth = resources.total_market_value || resources.totalMarketValue || 0;
            this.colonistCount = this.colonists.length;
        },
        connectVideoStream(sessionId) {
            this.connectionStatus = 'Connecting...';

            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}/stream?session=${sessionId}`;

            console.log('[Video] Connecting to:', wsUrl);
            this.streamWs = new WebSocket(wsUrl);
            this.streamWs.binaryType = 'arraybuffer';

            this.streamWs.onopen = () => {
                console.log('[Video] WebSocket connected');
                this.connectionStatus = 'Connected';
                this.initMediaSource();
            };

            this.streamWs.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    this.handleVideoSegment(new Uint8Array(event.data));
                }
            };

            this.streamWs.onerror = (error) => {
                console.error('[Video] WebSocket error:', error);
                this.connectionStatus = 'Error';
                this.streamInfo = 'Connection error';
            };

            this.streamWs.onclose = () => {
                console.log('[Video] WebSocket closed');
                this.connectionStatus = 'Disconnected';
                this.streamInfo = 'Stream disconnected';

                // Auto-reconnect after 2 seconds
                setTimeout(() => {
                    if (this.$route.params.id === sessionId) {
                        console.log('[Video] Reconnecting...');
                        this.connectVideoStream(sessionId);
                    }
                }, 2000);
            };
        },
        initMediaSource() {
            if (!window.MediaSource) {
                console.error('[Video] MediaSource API not supported');
                this.streamInfo = 'Browser not supported';
                return;
            }

            this.mediaSource = new MediaSource();
            const video = this.$refs.videoPlayer;
            video.src = URL.createObjectURL(this.mediaSource);

            this.mediaSource.addEventListener('sourceopen', () => {
                console.log('[Video] MediaSource opened');

                try {
                    // Exact match for Rust Sidecar (Constrained Baseline Profile, Level 4.2)
                    this.sourceBuffer = this.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42C02A"');
                    this.sourceBuffer.mode = 'sequence';

                    this.sourceBuffer.addEventListener('updateend', () => {
                        this.isAppending = false;
                        this.processSegmentQueue();
                    });

                    this.sourceBuffer.addEventListener('error', (e) => {
                        console.error('[Video] SourceBuffer error:', e);
                    });

                    console.log('[Video] SourceBuffer ready');
                    this.streamInfo = 'Stream ready';
                } catch (e) {
                    console.error('[Video] Failed to create SourceBuffer:', e);
                    this.streamInfo = 'Stream initialization failed';
                }
            });

            this.mediaSource.addEventListener('sourceended', () => {
                console.log('[Video] MediaSource ended');
            });

            this.mediaSource.addEventListener('error', (e) => {
                console.error('[Video] MediaSource error:', e);
                this.streamInfo = 'Stream error';
            });
        },
        handleVideoSegment(data) {
            if (!this.sourceBuffer) {
                console.warn('[Video] Received segment before SourceBuffer ready');
                return;
            }

            this.segmentQueue.push(data);
            this.processSegmentQueue();
        },
        processSegmentQueue() {
            if (this.isAppending || this.segmentQueue.length === 0 || !this.sourceBuffer) {
                return;
            }

            if (this.sourceBuffer.updating) {
                return;
            }

            const segment = this.segmentQueue.shift();
            this.isAppending = true;

            try {
                this.sourceBuffer.appendBuffer(segment);

                const video = this.$refs.videoPlayer;
                if (video.paused && video.readyState >= 2) {
                    video.play().catch(e => console.warn('[Video] Autoplay prevented:', e));
                }

                if (this.segmentQueue.length === 1) {
                    this.streamInfo = 'Live stream active';
                } else if (this.segmentQueue.length > 10) {
                    this.streamInfo = `Buffering... (${this.segmentQueue.length} segments)`;
                }
            } catch (e) {
                console.error('[Video] Failed to append segment:', e);
                this.isAppending = false;
            }
        }
    },
    mounted() {
        const sessionId = this.$route.params.id;
        this.session = this.$root.sessions.find(s => s.sessionId === sessionId) || {};

        this.$root.socket.emit('select-session', sessionId);

        this.$root.socket.on('gamestate-update', (data) => {
            if (data.sessionId === sessionId) {
                this.updateGameState(data.gameState);
            }
        });

        this.$root.socket.on('viewer-count-update', (data) => {
            if (data.sessionId === sessionId) {
                this.viewerCount = data.viewerCount;
            }
        });

        // Connect to video stream
        this.connectVideoStream(sessionId);
    },
    beforeUnmount() {
        // Clean up socket listeners
        this.$root.socket.off('gamestate-update');
        this.$root.socket.off('viewer-count-update');

        // Clean up video stream
        if (this.streamWs) {
            this.streamWs.close();
            this.streamWs = null;
        }

        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                console.warn('[Video] Failed to end MediaSource:', e);
            }
        }

        const video = this.$refs.videoPlayer;
        if (video && video.src) {
            URL.revokeObjectURL(video.src);
        }
    }
};
