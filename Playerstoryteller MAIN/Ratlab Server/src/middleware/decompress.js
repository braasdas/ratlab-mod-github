const zlib = require('zlib');

/**
 * Middleware to handle gzipped request bodies.
 * Decompresses the stream, parses the JSON, and sets req.body directly.
 * Sets req._body = true to bypass downstream body-parsers.
 */
function decompressMiddleware(req, res, next) {
    // Debug Logging
    // console.log(`[Decompress] ${req.method} ${req.url} | Encoding: ${req.headers['content-encoding']} | Type: ${req.headers['content-type']}`);

    let contentEncoding = req.headers['content-encoding'] || '';

    // FORCE GZIP for /api/update if header is missing
    // The C# Mod always sends this endpoint compressed, but sometimes the header is dropped.
    if (req.url === '/api/update' && !contentEncoding) {
        contentEncoding = 'gzip';
        req.headers['content-encoding'] = 'gzip'; 
    }

    // If not gzipped, proceed immediately
    if (contentEncoding.toLowerCase() !== 'gzip') {
        return next();
    }

    // Prepare to collect decompressed data
    const chunks = [];
    const gunzip = zlib.createGunzip();

    // Error handling for decompression
    gunzip.on('error', (err) => {
        console.error('[Decompress] Gzip Error:', err);
        if (!res.headersSent) {
            res.status(400).json({ error: 'Invalid gzip data' });
        }
    });

    // Collect chunks
    gunzip.on('data', (chunk) => {
        chunks.push(chunk);
    });

    // When done, parse JSON and populate req.body
    gunzip.on('end', () => {
        try {
            const buffer = Buffer.concat(chunks);
            const str = buffer.toString('utf8');
            
            // Clean headers
            delete req.headers['content-encoding'];
            delete req.headers['content-length'];
            
            // CRITICAL: Remove Content-Type so express.json() ignores this request
            // We have already parsed the body manually.
            delete req.headers['content-type'];

            // Manually parse JSON
            // This assumes the compressed content is JSON, which matches the Mod's behavior.
            if (str.trim().length > 0) {
                req.body = JSON.parse(str);
            } else {
                req.body = {};
            }

            // Flag to tell express.json() / body-parser to skip this request
            req._body = true;

            next();
        } catch (e) {
            console.error('[Decompress] JSON Parse Error:', e.message);
            // Log first 100 chars to debug
            // console.error('Payload start:', buffer.slice(0, 100).toString());
            if (!res.headersSent) {
                res.status(400).json({ error: 'Invalid JSON in compressed body' });
            }
        }
    });

    // Start piping the original request to gunzip
    req.pipe(gunzip);
}

module.exports = decompressMiddleware;
