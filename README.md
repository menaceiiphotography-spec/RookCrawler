# Rook Crawler + Stealth Proxy

A local web crawler with a browser UI, backed by a Node CORS proxy that fetches
through rotating HTTP/HTTPS/SOCKS5 proxies with a Chrome fingerprint. One process
serves the UI and does the fetching -- open http://localhost:8010 and go.

## Files
- index.html  -- Crawler UI (served by the server at /)
- server.js   -- Serves the UI + /?url= proxy (cuimp, rotation, SSRF, token)
- proxies.txt -- Rotating proxy list, one per line (hot-reloaded)
- token.txt   -- Optional auth token (hot-reloaded)
- package.json-- Dependencies + npm start
- start.sh    -- Termux / Android launcher

## Requirements
Node.js 18+ and npm.

## Run (Termux / Android)
    pkg update && pkg install nodejs
    cd ~/Rook-Crawler
    chmod +x start.sh
    ./start.sh
Then open http://localhost:8010 in a browser.

## How it works
- The browser page is same-origin with the proxy, so it calls /?url=<encoded target>.
- server.js fetches the target through cuimp (Chrome fingerprint) and a rotating
  proxy from proxies.txt, with per-request failover.
- The crawler enforces depth, page cap, include/exclude regex, file-type and
  social filters, robots.txt (own-origin, at fetch time), and SHA-256 content dedup.

## Proxies
Add one per line to proxies.txt (hot-reloaded):
    http://user:pass@host:8000
    socks5://12.34.56.78:1080

## Auth (recommended on a phone/LAN)
1. Put a secret on line 1 of token.txt (or set PROXY_TOKEN env var).
2. In the UI: Config -> Proxy Token -> paste the same value.
Without a token the proxy is open to anything that can reach the port.

## Crawl settings
- Max Depth = link hops from the seed (not path-segment count).
- Concurrency applies even to single-URL crawls (fixed worker pool).
- Sitemap URLs pass through the same filters as discovered links.

## Security
- Binds 0.0.0.0:8010 -- reachable on your LAN. Use a token or keep it to localhost.
- SSRF guard blocks loopback/RFC1918/link-local/169.254.169.254 by literal hostname
  (a public host that DNS-resolves to a private IP is not caught).

## Troubleshooting
- "Cannot find module 'express'" -- delete node_modules, re-run the launcher.
- cuimp install/runtime errors -- verify the package name/export and SOCKS5 support.
  On Termux, native builds need: pkg install python clang make binutils
