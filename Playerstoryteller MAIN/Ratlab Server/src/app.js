const express = require('express');
const path = require('path');
const decompressMiddleware = require('./middleware/decompress');
const { corsMiddleware } = require('./middleware/security');

function createApp() {
    const app = express();

    // 1. Security Middleware (CORS)
    app.use(corsMiddleware);

    // 2. Decompression Middleware (Handles 'Content-Encoding: gzip')
    app.use(decompressMiddleware);

    // 3. Standard Body Parsers
    app.use(express.json({ limit: '500mb' }));
    app.use(express.urlencoded({ extended: true, limit: '500mb' }));

    // Global JSON Error Handler (Prevents crashes on bad payloads)
    app.use((err, req, res, next) => {
        if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
            console.error('[App] JSON Parse Error (likely binary data):', err.message);
            return res.status(400).json({ error: 'Malformed JSON payload' });
        }
        next(err);
    });

    // Static Files
    app.use(express.static(path.join(__dirname, '../public'), { etag: false, maxAge: 0 }));

    // Note: Routes are now attached in server.js to allow passing the 'io' instance

    return app;
}

module.exports = createApp;
