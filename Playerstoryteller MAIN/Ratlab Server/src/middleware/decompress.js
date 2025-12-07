const zlib = require('zlib');

/**
 * Middleware to handle gzipped request bodies.
 * It checks the Content-Encoding header and decompresses the stream if needed.
 * This must be placed BEFORE body parsers (like express.json).
 */
function decompressMiddleware(req, res, next) {
    const contentEncoding = req.headers['content-encoding'] || '';

    // If not gzipped, proceed
    if (contentEncoding.toLowerCase() !== 'gzip') {
        return next();
    }

    // Create a gunzip stream
    const gunzip = zlib.createGunzip();

    // Handle errors in the decompression stream
    gunzip.on('error', (err) => {
        console.error('[Decompress] Error decompressing request:', err);
        // Avoid double response if headers already sent
        if (!res.headersSent) {
            res.status(400).json({ error: 'Invalid gzip data' });
        }
    });

    // Replace req with the decompressed stream
    // We keep the original properties of req
    req.pipe(gunzip);
    
    // This is the magic: we override the req events to point to the gunzip stream
    // but we need to be careful. 
    // A safer way in Express is to just replace the data source for body-parser.
    // However, body-parser reads from 'req'.
    // So we need to make 'req' look like the unzipped stream.
    
    // Strategy:
    // 1. Remove the content-encoding header so body-parser doesn't get confused
    //    or try to handle it again (though body-parser usually ignores this).
    // 2. Use the gunzip stream as the data source.
    
    delete req.headers['content-encoding'];
    
    // Preserve original pipe method
    const originalPipe = req.pipe;
    
    // Override req properties to behave like the gunzip stream
    req.pipe = (dest, options) => {
        return gunzip.pipe(dest, options);
    };
    
    req.on = (event, listener) => {
        if (event === 'data' || event === 'end' || event === 'error') {
             gunzip.on(event, listener);
        } else {
             // For other events, use the original req
             req.addListener(event, listener);
        }
        return req;
    };
    
    // Also delegate 'unpipe', 'read', etc. if strictly necessary, 
    // but usually 'on' and 'pipe' covers body-parser.
    
    next();
}

module.exports = decompressMiddleware;
