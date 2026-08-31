const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const cuimp = require('cuimp');

const app = express();
const PORT = process.env.PORT || 8010;
const INDEX_FILE = path.join(__dirname, 'index.html');
const PROXIES_FILE = path.join(__dirname, 'proxies.txt');
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const TOR_CONFIG_FILE = path.join(__dirname, 'tor.json');

// Proxy schemes: HTTP, HTTPS, SOCKS4, SOCKS5, Tor
const ALLOWED_PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks5:'];
const TOR_PATTERNS = /^tor:\/\/|\.onion$/i;

app.use(express.raw({ type: '*/*', limit: '10mb' }));

let proxyPool = [];
let currentProxyIndex = 0;
let PROXY_TOKEN = '';
let torConfig = { enabled: false, socksPort: 9050, controlPort: 9051, password: '' };

// ---- Auth token ----
function loadToken() {
    if (process.env.PROXY_TOKEN && process.env.PROXY_TOKEN.trim()) {
        PROXY_TOKEN = process.env.PROXY_TOKEN.trim();
    } else {
        try {
            PROXY_TOKEN = fs.existsSync(TOKEN_FILE)
                ? (fs.readFileSync(TOKEN_FILE, 'utf8').split('\n').map(l => l.trim())
                    .find(l => l.length > 0 && !l.startsWith('#')) || '')
                : '';
        } catch (err) {
            console.error('[ERROR] token.txt:', err.message);
            PROXY_TOKEN = '';
        }
    }
    console.log(PROXY_TOKEN
        ? '[SECURITY] Token auth ENABLED.'
        : '[SECURITY] WARNING: no token set - proxy is OPEN to anything that can reach it.');
}

function safeEqual(a, b) {
    const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// ---- Tor Configuration ----
function loadTorConfig() {
    try {
        if (fs.existsSync(TOR_CONFIG_FILE)) {
            const cfg = JSON.parse(fs.readFileSync(TOR_CONFIG_FILE, 'utf8'));
            torConfig = { enabled: false, socksPort: 9050, controlPort: 9051, password: '', ...cfg };
            if (torConfig.enabled) {
                console.log(`[TOR] Config loaded: SOCKS on port ${torConfig.socksPort}, Control on ${torConfig.controlPort}`);
            }
        } else {
            const defaultConfig = {
                enabled: false,
                socksPort: 9050,
                controlPort: 9051,
                password: ''
            };
            fs.writeFileSync(TOR_CONFIG_FILE,
                JSON.stringify(defaultConfig, null, 2),
                'utf8');
            console.log('[TOR] Created default tor.json (disabled). Set "enabled": true to use Tor.');
            torConfig = defaultConfig;
        }
    } catch (err) {
        console.error('[ERROR] tor.json:', err.message);
        torConfig = { enabled: false, socksPort: 9050, controlPort: 9051, password: '' };
    }
}

// ---- Proxy pool with Tor support ----
function loadProxies() {
    try {
        if (fs.existsSync(PROXIES_FILE)) {
            const lines = fs.readFileSync(PROXIES_FILE, 'utf8').split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('#'));
            
            proxyPool = lines.filter(l => {
                // Check for Tor indicator
                if (TOR_PATTERNS.test(l)) {
                    if (torConfig.enabled) {
                        console.log('[TOR] Tor entry detected in proxies.txt');
                        return true;
                    } else {
                        console.warn('[TOR] Skipping Tor entry: Tor not enabled in tor.json');
                        return false;
                    }
                }
                
                // Validate standard proxy schemes
                try {
                    return ALLOWED_PROXY_SCHEMES.includes(new URL(l).protocol);
                } catch {
                    console.warn(`[SYSTEM] Skipping malformed proxy line: ${l}`);
                    return false;
                }
            });
            
            console.log(`[SYSTEM] Loaded ${proxyPool.length} proxies from proxies.txt`);
        } else {
            fs.writeFileSync(PROXIES_FILE,
                '# Paste your proxies here, one per line.\n# Lines starting with \'#\' are ignored.\n# Supports HTTP, HTTPS, SOCKS5, and Tor (tor:// or .onion domains).\n# Example:\n# http://user:pass@host:8000\n# socks5://127.0.0.1:1080\n# tor://\n',
                'utf8');
            console.log('[SYSTEM] Created empty proxies.txt file.');
            proxyPool = [];
        }
    } catch (err) {
        console.error('[ERROR] proxies.txt:', err.message);
    }
}

function getNextProxy() {
    if (proxyPool.length === 0) return null;
    const p = proxyPool[currentProxyIndex];
    currentProxyIndex = (currentProxyIndex + 1) % proxyPool.length;
    return p;
}

function maskProxy(s) {
    if (TOR_PATTERNS.test(s)) return 'tor://';
    try {
        const u = new URL(s);
        return `${u.protocol}//${u.host}`;
    } catch {
        return s.includes('@') ? s.split('@').pop() : s;
    }
}

function resolveProxyForUrl(proxyEntry, targetUrl) {
    // If Tor is requested or target is .onion
    if (TOR_PATTERNS.test(proxyEntry) || TOR_PATTERNS.test(targetUrl)) {
        if (!torConfig.enabled) {
            throw new Error('Tor is not enabled in tor.json');
        }
        return `socks5://127.0.0.1:${torConfig.socksPort}`;
    }
    return proxyEntry;
}

// ---- SSRF guard ----
function isBlockedHost(hostname) {
    const host = hostname.toLowerCase();
    
    // Allow .onion domains (they are only accessible through Tor)
    if (host.endsWith('.onion')) return false;
    
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
    if (net.isIP(host) === 4) {
        const p = host.split('.').map(Number);
        if (p[0] === 127 || p[0] === 10 || p[0] === 0) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 169 && p[1] === 254) return true;
    }
    if (net.isIP(host) === 6) {
        if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
    }
    return false;
}

// ---- Browser profiles ----
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'edge', 'safari'];
let currentBrowserIndex = 0;

function resolveBrowser(req) {
    const requested = String(
        (req.query && req.query.browser) || 'chrome'
    ).trim().toLowerCase();

    if (requested === 'auto') {
        const browser = SUPPORTED_BROWSERS[currentBrowserIndex];
        currentBrowserIndex = (currentBrowserIndex + 1) % SUPPORTED_BROWSERS.length;
        return browser;
    }

    if (!SUPPORTED_BROWSERS.includes(requested)) {
        return null;
    }

    return requested;
}

// ---- cuimp method dispatch (with validation) ----
function fetchViaCuimp(method, targetUrl, options) {
    if (typeof cuimp.createCuimpHttp !== 'function') {
        throw new Error('cuimp.createCuimpHttp is not available. Ensure cuimp is properly installed: npm install cuimp');
    }

    const m = method.toUpperCase();

    let client;
    try {
        client = cuimp.createCuimpHttp({
            descriptor: {
                browser: options.browser,
                version: 'latest'
            },
            autoDownload: false
        });
    } catch (err) {
        throw new Error(`Failed to create cuimp client: ${err.message}`);
    }

    const reqOptions = {
        ...options,
        headers: options.headers || {}
    };

    // Pass proxy as string
    if (options.proxy) {
        reqOptions.proxy = options.proxy;
    }

    delete reqOptions.browser;

    try {
        if (typeof client[m.toLowerCase()] === 'function') {
            return client[m.toLowerCase()](targetUrl, reqOptions);
        }

        if (typeof client.request === 'function') {
            return client.request({
                ...reqOptions,
                url: targetUrl,
                method: m
            });
        }

        throw new Error(`cuimp client has no handler for method '${method}'`);
    } catch (err) {
        throw new Error(`cuimp request failed: ${err.message}`);
    }
}

// ---- Target resolution ----
function resolveTarget(req) {
    if (req.query && typeof req.query.url === 'string' && req.query.url.trim()) return req.query.url.trim();
    const raw = req.originalUrl.replace(/^\/+/, '');
    return /^https?:\/\//i.test(raw) ? raw : null;
}

// Initialize
loadTorConfig();
loadProxies();
loadToken();

// File watchers
fs.watchFile(PROXIES_FILE, (curr, prev) => {
    try {
        console.log('[SYSTEM] proxies.txt changed, reloading...');
        loadProxies();
        currentProxyIndex = 0;
    } catch (err) {
        console.error('[ERROR] Failed to reload proxies.txt:', err.message);
    }
});

fs.watchFile(TOKEN_FILE, (curr, prev) => {
    try {
        console.log('[SYSTEM] token.txt changed, reloading...');
        loadToken();
    } catch (err) {
        console.error('[ERROR] Failed to reload token.txt:', err.message);
    }
});

fs.watchFile(TOR_CONFIG_FILE, (curr, prev) => {
    try {
        console.log('[SYSTEM] tor.json changed, reloading...');
        loadTorConfig();
    } catch (err) {
        console.error('[ERROR] Failed to reload tor.json:', err.message);
    }
});

app.use(async (req, res) => {
    const target = resolveTarget(req);

    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, X-Proxy-Token');
    if (origin !== '*') res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);

    // No target -> serve app or 400
    if (!target) {
        if (req.method === 'GET') {
            if (fs.existsSync(INDEX_FILE)) return res.sendFile(INDEX_FILE);
            return res.status(404).send('index.html not found next to server.js');
        }
        return res.status(400).send('No target. Use /?url=<encoded> or /<http...>.');
    }
    if (!/^https?:\/\//i.test(target)) return res.status(400).send('Invalid target URL.');

    let parsed;
    try {
        parsed = new URL(target);
    } catch {
        return res.status(400).send('Malformed target URL.');
    }

    // Token validation
    let token = req.headers['x-proxy-token'] || (req.query && req.query.token) || null;
    if (PROXY_TOKEN && !token && parsed.searchParams.has('token')) {
        token = parsed.searchParams.get('token');
        parsed.searchParams.delete('token');
    }
    if (PROXY_TOKEN && (!token || !safeEqual(token, PROXY_TOKEN))) {
        return res.status(401).send('Unauthorized: missing or invalid proxy token.');
    }

    // SSRF check (allows .onion)
    if (isBlockedHost(parsed.hostname)) {
        return res.status(403).send('Target host is blocked.');
    }

    const targetUrl = parsed.toString();

    const browser = resolveBrowser(req);
    if (!browser) {
        return res.status(400).send(
            `Invalid browser. Supported: ${SUPPORTED_BROWSERS.join(', ')}, auto`
        );
    }

    const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;

    const baseOptions = {
        browser,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {})
        },
        timeout: 15000,
        ...(hasBody ? { data: req.body } : {})
    };

    const attempts = proxyPool.length > 0 ? Math.min(proxyPool.length, 3) : 1;
    let lastError;

    for (let i = 0; i < attempts; i++) {
        const proxyEntry = getNextProxy();
        const fetchOptions = { ...baseOptions };

        try {
            if (proxyEntry) {
                const resolvedProxy = resolveProxyForUrl(proxyEntry, targetUrl);
                fetchOptions.proxy = resolvedProxy;
                console.log(`[FETCH] ${maskProxy(proxyEntry)} -> ${req.method} ${targetUrl}`);
            } else {
                console.log(`[FETCH] direct -> ${req.method} ${targetUrl}`);
            }

            const r = await fetchViaCuimp(req.method, targetUrl, fetchOptions);
            const ct = r.headers && r.headers['content-type'];
            if (ct) res.setHeader('Content-Type', ct);
            return res.status(r.status || 200).send(r.data);
        } catch (error) {
            lastError = error;
            console.error(`[PROXY ERROR] attempt ${i + 1}/${attempts}: ${error.message}`);
            if (error.response) {
                const ct = error.response.headers && error.response.headers['content-type'];
                if (ct) res.setHeader('Content-Type', ct);
                return res.status(error.response.status).send(error.response.data);
            }
        }
    }

    const errorMsg = lastError ? lastError.message : 'all proxies failed';
    res.status(502).send(`Anti-bot routing failure: ${errorMsg}`);
});

const server = app.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`[LIVE] Rook Crawler + Stealth Proxy (with Tor support)`);
    console.log(`[OPEN] http://localhost:${PORT}/`);
    console.log(`[AUTH] ${PROXY_TOKEN ? 'token required' : 'OPEN - no token set'}`);
    console.log(`[PROXY] ${proxyPool.length} rotating proxies loaded`);
    console.log(`[TOR] ${torConfig.enabled ? 'ENABLED' : 'disabled'}`);
    console.log(`============================================================\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[ERROR] Port ${PORT} is already in use. Try: PORT=8011 npm start`);
    } else {
        console.error(`[ERROR] Server error: ${err.message}`);
    }
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('[SYSTEM] SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('[SYSTEM] Server closed');
        process.exit(0);
    });
});
