const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const cuimp = require('cuimp'); // NOTE: verify this export shape matches your installed package.

const app = express();
const PORT = process.env.PORT || 8010;
const INDEX_FILE = path.join(__dirname, 'index.html');
const PROXIES_FILE = path.join(__dirname, 'proxies.txt');
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const ALLOWED_PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks5:'];

app.use(express.raw({ type: '*/*', limit: '10mb' })); // forward bodies verbatim

let proxyPool = [];
let currentProxyIndex = 0;
let PROXY_TOKEN = '';

// ---- Auth token: PROXY_TOKEN env var > first line of token.txt > none ----
function loadToken() {
    if (process.env.PROXY_TOKEN && process.env.PROXY_TOKEN.trim()) {
        PROXY_TOKEN = process.env.PROXY_TOKEN.trim();
    } else {
        try {
            PROXY_TOKEN = fs.existsSync(TOKEN_FILE)
                ? (fs.readFileSync(TOKEN_FILE, 'utf8').split('\n').map(l => l.trim())
                    .find(l => l.length > 0 && !l.startsWith('#')) || '')
                : '';
        } catch (err) { console.error('[ERROR] token.txt:', err.message); PROXY_TOKEN = ''; }
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

// ---- Proxy pool ----
function loadProxies() {
    try {
        if (fs.existsSync(PROXIES_FILE)) {
            proxyPool = fs.readFileSync(PROXIES_FILE, 'utf8').split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('#'))
                .filter(l => {
                    try { return ALLOWED_PROXY_SCHEMES.includes(new URL(l).protocol); }
                    catch { console.warn(`[SYSTEM] Skipping malformed proxy line: ${l}`); return false; }
                });
            console.log(`[SYSTEM] Loaded ${proxyPool.length} proxies from proxies.txt`);
        } else {
            fs.writeFileSync(PROXIES_FILE,
                '# Paste your proxies here, one per line.\n# Lines starting with \'#\' are ignored.\n# Supports HTTP, HTTPS, and SOCKS5.\n',
                'utf8');
            console.log('[SYSTEM] Created empty proxies.txt file.');
            proxyPool = [];
        }
    } catch (err) { console.error('[ERROR] proxies.txt:', err.message); }
}
function getNextProxy() {
    if (proxyPool.length === 0) return null;
    const p = proxyPool[currentProxyIndex];
    currentProxyIndex = (currentProxyIndex + 1) % proxyPool.length;
    return p;
}
function maskProxy(s) {
    try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
    catch { return s.includes('@') ? s.split('@').pop() : s; }
}

// ---- SSRF guard (literal-hostname; a public host resolving to a private IP is NOT caught) ----
function isBlockedHost(hostname) {
    const host = hostname.toLowerCase();
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
        currentBrowserIndex =
            (currentBrowserIndex + 1) % SUPPORTED_BROWSERS.length;
        return browser;
    }

    if (!SUPPORTED_BROWSERS.includes(requested)) {
        return null;
    }

    return requested;
}

// ---- cuimp method dispatch ----
function fetchViaCuimp(method, targetUrl, options) {
    if (typeof cuimp.createCuimpHttp !== 'function') {
        throw new Error('cuimp.createCuimpHttp is not available');
    }

    const m = method.toLowerCase();

    const client = cuimp.createCuimpHttp({
        descriptor: {
            browser: options.browser,
            version: 'latest'
        },
        autoDownload: false
    });

    if (typeof client[m] === 'function') {
        return client[m](targetUrl, options);
    }

    if (typeof client.request === 'function') {
        return client.request({
            ...options,
            url: targetUrl,
            method: m
        });
    }

    throw new Error(`cuimp client has no handler for method '${method}'`);
}

// ---- Target resolution: ?url= (query, encoded) OR /<http...> (path) ----
function resolveTarget(req) {
    if (req.query && typeof req.query.url === 'string' && req.query.url.trim()) return req.query.url.trim();
    const raw = req.originalUrl.replace(/^\/+/, '');
    return /^https?:\/\//i.test(raw) ? raw : null;
}

loadProxies();
loadToken();
fs.watchFile(PROXIES_FILE, () => { console.log('[SYSTEM] proxies.txt changed, reloading...'); loadProxies(); currentProxyIndex = 0; });
fs.watchFile(TOKEN_FILE, () => { console.log('[SYSTEM] token.txt changed, reloading...'); loadToken(); });

app.use(async (req, res) => {
    const target = resolveTarget(req);

    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, X-Proxy-Token');
    if (origin !== '*') res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);

    // No target -> serve the app (bare GET) or 400
    if (!target) {
        if (req.method === 'GET') {
            if (fs.existsSync(INDEX_FILE)) return res.sendFile(INDEX_FILE);
            return res.status(404).send('index.html not found next to server.js');
        }
        return res.status(400).send('No target. Use /?url=<encoded> or /<http...>.');
    }
    if (!/^https?:\/\//i.test(target)) return res.status(400).send('Invalid target URL.');

    let parsed;
    try { parsed = new URL(target); } catch { return res.status(400).send('Malformed target URL.'); }

    // Token: header, then ?token= query, then (only when auth is on) strip it off the target
    let token = req.headers['x-proxy-token'] || (req.query && req.query.token) || null;
    if (PROXY_TOKEN && !token && parsed.searchParams.has('token')) {
        token = parsed.searchParams.get('token');
        parsed.searchParams.delete('token');
    }
    if (PROXY_TOKEN && (!token || !safeEqual(token, PROXY_TOKEN))) {
        return res.status(401).send('Unauthorized: missing or invalid proxy token.');
    }

    if (isBlockedHost(parsed.hostname)) return res.status(403).send('Target host is blocked.');

    const targetUrl = parsed.toString();

    const browser = resolveBrowser(req);
    if (!browser) {
        return res.status(400).send(
            `Invalid browser. Supported browsers: ${SUPPORTED_BROWSERS.join(', ')}, auto`
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
        ...(hasBody ? { body: req.body } : {}) // rename 'body' -> 'data' if your lib expects axios-style
    };

    const attempts = proxyPool.length > 0 ? Math.min(proxyPool.length, 3) : 1;
    let lastError;
    for (let i = 0; i < attempts; i++) {
        const activeProxy = getNextProxy();
        const fetchOptions = { ...baseOptions };
        if (activeProxy) {
            fetchOptions.proxy = activeProxy;
            console.log(`[FETCH] ${maskProxy(activeProxy)} -> ${req.method} ${targetUrl}`);
        } else {
            console.log(`[FETCH] direct -> ${req.method} ${targetUrl}`);
        }
        try {
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
    res.status(502).send(`Anti-bot routing failure: ${lastError ? lastError.message : 'all proxies failed'}`);
});

app.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`[LIVE] Rook Crawler + Stealth Proxy`);
    console.log(`[OPEN] http://localhost:${PORT}/   (the app is served here)`);
    console.log(`[AUTH] ${PROXY_TOKEN ? 'token required' : 'OPEN - no token set'}`);
    console.log(`[PROXY] ${proxyPool.length} rotating proxies loaded`);
    console.log(`============================================================\n`);
});
