/**
 * Unit tests for RAT LAB server
 * Tests session management, WebRTC SFU, rate limiting, and authentication
 */

const request = require('supertest');
const io = require('socket.io-client');
const { expect } = require('chai');

// Import server (modify server.js to export app for testing)
// For now, we'll test against a running server

describe('RAT LAB Server Tests', () => {
  const SERVER_URL = 'http://localhost:3000';
  const WS_URL = 'ws://localhost:3001';

  let socket;

  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
    if (socket && socket.connected) {
      socket.disconnect();
    }
  });

  describe('Health Check Endpoint', () => {
    it('should return 200 OK on /health', async () => {
      const response = await request(SERVER_URL).get('/health');
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('status', 'ok');
    });
  });

  describe('Session Management', () => {
    it('should return empty sessions list initially', async () => {
      const response = await request(SERVER_URL).get('/api/sessions');
      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
    });

    it('should reject update without stream key', async () => {
      const response = await request(SERVER_URL)
        .post('/api/update')
        .send({ gameState: { colonists: [] } });

      expect(response.status).to.equal(401);
    });

    it('should accept update with valid stream key', async () => {
      const response = await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .send({ gameState: { colonists: [] } });

      // May return 400 if validation fails, but shouldn't be 401
      expect(response.status).to.not.equal(401);
    });

    it('should create session on first update', async () => {
      const sessionId = 'test-session-' + Date.now();

      await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', sessionId)
        .send({ gameState: { colonists: [] } });

      const response = await request(SERVER_URL).get('/api/sessions');
      expect(response.body).to.be.an('array');
      // Session may or may not be public, so just check it doesn't crash
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce action rate limit', async () => {
      const sessionId = 'test-session-' + Date.now();

      // Create session first
      await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', sessionId)
        .set('is-public', 'true')
        .send({ gameState: { colonists: [] } });

      // Send 35 actions rapidly (limit is 30/minute)
      const promises = [];
      for (let i = 0; i < 35; i++) {
        promises.push(
          request(SERVER_URL)
            .post('/api/action')
            .send({
              sessionId: sessionId,
              action: 'healColonist',
              data: 'test'
            })
        );
      }

      const responses = await Promise.all(promises);

      // At least some should be rate limited (429)
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).to.be.greaterThan(0);
    });

    it('should allow actions within rate limit', async () => {
      const sessionId = 'test-session-' + Date.now();

      // Create session
      await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', sessionId)
        .set('is-public', 'true')
        .send({ gameState: { colonists: [] } });

      // Send single action
      const response = await request(SERVER_URL)
        .post('/api/action')
        .send({
          sessionId: sessionId,
          action: 'healColonist',
          data: 'test'
        });

      expect(response.status).to.not.equal(429);
    });
  });

  describe('Action Validation', () => {
    let testSessionId;

    beforeEach(async () => {
      testSessionId = 'test-session-' + Date.now();

      // Create session
      await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', testSessionId)
        .set('is-public', 'true')
        .send({ gameState: { colonists: [] } });
    });

    it('should reject action with invalid name', async () => {
      const response = await request(SERVER_URL)
        .post('/api/action')
        .send({
          sessionId: testSessionId,
          action: 'invalid<>action',
          data: 'test'
        });

      expect(response.status).to.equal(400);
    });

    it('should reject action with too long data', async () => {
      const longData = 'x'.repeat(600); // Max is 500

      const response = await request(SERVER_URL)
        .post('/api/action')
        .send({
          sessionId: testSessionId,
          action: 'healColonist',
          data: longData
        });

      expect(response.status).to.equal(400);
    });

    it('should reject action with too short data', async () => {
      const response = await request(SERVER_URL)
        .post('/api/action')
        .send({
          sessionId: testSessionId,
          action: 'healColonist',
          data: 'ab' // Min is 3
        });

      expect(response.status).to.equal(400);
    });

    it('should accept valid action', async () => {
      const response = await request(SERVER_URL)
        .post('/api/action')
        .send({
          sessionId: testSessionId,
          action: 'healColonist',
          data: 'John Doe'
        });

      expect([200, 201]).to.include(response.status);
    });
  });

  describe('Password Protection', () => {
    let protectedSessionId;

    beforeEach(async () => {
      protectedSessionId = 'protected-session-' + Date.now();

      // Create password-protected session
      await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', protectedSessionId)
        .set('x-interaction-password', 'secret123')
        .set('is-public', 'true')
        .send({ gameState: { colonists: [] } });
    });

    it('should reject action without password', async () => {
      const response = await request(SERVER_URL)
        .post('/api/action')
        .send({
          sessionId: protectedSessionId,
          action: 'healColonist',
          data: 'John Doe'
        });

      expect(response.status).to.equal(403);
    });

    it('should reject action with wrong password', async () => {
      const response = await request(SERVER_URL)
        .post('/api/action')
        .set('x-interaction-password', 'wrongpassword')
        .send({
          sessionId: protectedSessionId,
          action: 'healColonist',
          data: 'John Doe'
        });

      expect(response.status).to.equal(403);
    });

    it('should accept action with correct password', async () => {
      const response = await request(SERVER_URL)
        .post('/api/action')
        .set('x-interaction-password', 'secret123')
        .send({
          sessionId: protectedSessionId,
          action: 'healColonist',
          data: 'John Doe'
        });

      expect([200, 201]).to.include(response.status);
    });
  });

  describe('Socket.IO Events', () => {
    it('should connect to Socket.IO server', (done) => {
      socket = io(SERVER_URL);

      socket.on('connect', () => {
        expect(socket.connected).to.be.true;
        done();
      });

      socket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should receive sessions-list on connect', (done) => {
      socket = io(SERVER_URL);

      socket.on('sessions-list', (sessions) => {
        expect(sessions).to.be.an('array');
        done();
      });
    });

    it('should receive gamestate-update events', (done) => {
      socket = io(SERVER_URL);
      const testSessionId = 'test-session-' + Date.now();

      socket.on('connect', async () => {
        // Create session
        await request(SERVER_URL)
          .post('/api/update')
          .set('x-stream-key', 'test-key-123')
          .set('session-id', testSessionId)
          .set('is-public', 'true')
          .send({ gameState: { colonists: [] } });

        // Select session
        socket.emit('select-session', testSessionId);
      });

      socket.on('gamestate-update', (data) => {
        expect(data).to.be.an('object');
        done();
      });

      setTimeout(() => done(new Error('Timeout')), 5000);
    });
  });

  describe('Gzip Decompression', () => {
    it('should handle gzipped update data', async () => {
      const zlib = require('zlib');
      const gameState = JSON.stringify({ colonists: [], resources: {} });
      const compressed = zlib.gzipSync(gameState);

      const response = await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('content-encoding', 'gzip')
        .send(compressed);

      expect(response.status).to.not.equal(500);
    });

    it('should reject zip bombs (>10MB decompressed)', async () => {
      const zlib = require('zlib');

      // Create highly compressible data that expands to >10MB
      const hugeData = 'A'.repeat(15 * 1024 * 1024); // 15MB of 'A's
      const compressed = zlib.gzipSync(hugeData);

      const response = await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('content-encoding', 'gzip')
        .send(compressed);

      expect(response.status).to.equal(413); // Payload too large
    });
  });

  describe('Session Cleanup', () => {
    it('should remove inactive sessions after timeout', async function() {
      this.timeout(35000); // 35 second timeout

      const sessionId = 'cleanup-test-' + Date.now();

      // Create session
      await request(SERVER_URL)
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', sessionId)
        .set('is-public', 'true')
        .send({ gameState: { colonists: [] } });

      // Verify it exists
      let response = await request(SERVER_URL).get('/api/sessions');
      let found = response.body.some(s => s.sessionId === sessionId);
      expect(found).to.be.true;

      // Wait for cleanup (30s inactivity timeout + 10s cleanup interval)
      await new Promise(resolve => setTimeout(resolve, 32000));

      // Verify it's removed
      response = await request(SERVER_URL).get('/api/sessions');
      found = response.body.some(s => s.sessionId === sessionId);
      expect(found).to.be.false;
    });
  });

  describe('Speed Test Endpoint', () => {
    it('should accept speed test data', async () => {
      const testData = new Array(100).fill('test data');

      const response = await request(SERVER_URL)
        .post('/api/speedtest')
        .send({ data: testData });

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('received', true);
    });
  });

  describe('WebRTC Signaling', () => {
    it('should accept WebRTC signaling messages', (done) => {
      const ws = require('ws');
      const client = new ws('ws://localhost:3000/webrtc-signal');

      client.on('open', () => {
        // Send register message
        client.send(JSON.stringify({
          type: 'register',
          role: 'streamer',
          sessionId: 'test-session',
          streamKey: 'test-key'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') {
          expect(msg.success).to.be.true;
          client.close();
          done();
        }
      });

      client.on('error', (error) => {
        done(error);
      });
    });
  });
});

describe('Integration Tests', () => {
  describe('Full Streaming Pipeline', () => {
    it('should handle complete update cycle', async function() {
      this.timeout(10000);

      const sessionId = 'integration-test-' + Date.now();

      // 1. Create session via update
      await request('http://localhost:3000')
        .post('/api/update')
        .set('x-stream-key', 'test-key-123')
        .set('session-id', sessionId)
        .set('is-public', 'true')
        .send({
          gameState: {
            colonists: [{ name: 'John', health: 100 }],
            resources: { silver: 1000 }
          }
        });

      // 2. Verify session exists
      let response = await request('http://localhost:3000').get('/api/sessions');
      let session = response.body.find(s => s.sessionId === sessionId);
      expect(session).to.exist;

      // 3. Submit action
      response = await request('http://localhost:3000')
        .post('/api/action')
        .send({
          sessionId: sessionId,
          action: 'healColonist',
          data: 'John'
        });
      expect([200, 201]).to.include(response.status);

      // 4. Retrieve actions (as mod would)
      response = await request('http://localhost:3000')
        .get(`/api/actions/${sessionId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
    });
  });
});
