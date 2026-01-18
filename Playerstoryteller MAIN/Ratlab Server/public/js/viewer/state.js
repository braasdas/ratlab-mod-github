export const STATE = {
    currentSession: null,
    sessions: [],
    sessionRequiresPassword: false,
    sessionPassword: null,
    username: localStorage.getItem('username'),
    actionCosts: {},
    queueTimerInterval: null,
    
    // Stream State
    streamWebSocket: null,
    streamConnected: false,
    useWebSocket: false,
    useHLS: false,
    hls: null,

    // MSE State
    mediaSource: null,
    sourceBuffer: null,
    h264Queue: [],
    initSegmentReceived: false,
    stickyBuffer: new Uint8Array(0),
    cachedInitSegment: null,
    
    // My Pawn
    myPawnId: null,

    // Caches
    itemIcons: {},
    colonistPortraits: {},
    storedResources: [], // Items in storage zones for equip browser

    // Map
    mapSize: {x: 250, z: 250},

    // Camera bounds for ping functionality
    cameraBounds: null
};
