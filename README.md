# Rook Crawler + Stealth Proxy (Advanced Edition)

A production-grade local web crawler with a dark-themed browser UI, backed by a Node CORS proxy with **Tor Browser integration**, **DNS over HTTPS (DoH)**, **multi-device fingerprint rotation**, and an **AI-driven crawler intelligence layer**. Bypass anti-bot measures with Chrome TLS fingerprinting, rotating proxies, and adaptive delay strategies.

**Supported Platforms:** Windows (PowerShell 7.6.5+), macOS, Linux, Termux/Android

## 🚀 Quick Start

### Windows (PowerShell 7+)

```powershell
# Clone or download
git clone https://github.com/psfr4590-afk/Rook-Crawler.git
cd Rook-Crawler

# Install dependencies
npm install

# Start server
npm start

# Open browser
Start-Process http://localhost:8010
```

### macOS / Linux

```bash
git clone https://github.com/psfr4590-afk/Rook-Crawler.git
cd Rook-Crawler
npm install
npm start
# Open http://localhost:8010 in browser
```

### Termux / Android

```bash
pkg update && pkg install nodejs
cd ~/Rook-Crawler
chmod +x start.sh
./start.sh
# Open http://localhost:8010 in browser
```

---

## ✨ Advanced Features

### 🧅 Tor Browser Integration

Enable `.onion` domain crawling with circuit isolation:

**tor.json:**
```json
{
  "enabled": true,
  "mode": "local",
  "socksPort": 9050,
  "controlPort": 9051,
  "autoLaunch": false,
  "circuitIsolation": true,
  "circuitRotationInterval": 300000
}
```

**Then add to proxies.txt:**
```
tor://
```

Supported modes:
- `local`: Use local Tor daemon (requires `tor` running separately)
- `remote`: Use Tor Browser (requires Tor Browser installed)

### 🌐 DNS over HTTPS (DoH)

Prevent DNS leaks with multiple DoH providers:

**doh.json:**
```json
{
  "enabled": true,
  "provider": "cloudflare",
  "cache": true,
  "cacheTTL": 3600
}
```

Supported providers:
- `cloudflare` (1.1.1.1)
- `google` (dns.google)
- `quad9` (dns.quad9.net)
- `nextdns` (dns.nextdns.io)

### 👤 8+ Browser Fingerprints

Rotate through multiple device profiles to avoid detection:

**fingerprints.json includes:**
- Chrome (Windows, Linux, macOS) – Latest + v120
- Firefox (Windows, Linux) – Latest + v120
- Edge (Windows) – Latest
- Safari (macOS) – Latest

Enable automatic rotation in `crawler-intelligence.json`:
```json
{
  "strategies": {
    "dynamic_ua_rotation": {
      "enabled": true,
      "interval": 10
    }
  }
}
```

### 🧠 Crawler Intelligence Layer

Adaptive crawling with anti-bot evasion:

**crawler-intelligence.json strategies:**

| Strategy | Purpose |
|----------|---------|
| `adaptive_delay` | Auto-backoff on 429/503 responses |
| `anti_bot_detection` | Detect & respond to captcha/challenges |
| `cookie_persistence` | Maintain sessions across requests |
| `dynamic_ua_rotation` | Rotate fingerprints every N requests |
| `link_quality_scoring` | Prioritize high-value URLs |
| `content_prioritization` | Extract main content first |
| `javascript_rendering` | Optional JS rendering (headless) |

**Response handling:**
- `429` (Rate Limit) → Increase delay, switch proxy
- `403` (Forbidden) → Try different fingerprint/proxy
- `503` (Unavailable) → Exponential backoff
- `999` (LinkedIn) → Use residential proxy

---

## 📁 Files & Configuration

```
server.js                    -- Main proxy server (all features)
index.html                   -- Dark-themed crawler UI
proxies.txt                  -- Rotating proxy list (hot-reloaded)
token.txt                    -- Auth token (hot-reloaded)
tor.json                     -- Tor Browser config
doh.json                     -- DNS over HTTPS config
fingerprints.json            -- Browser profiles (8+)
crawler-intelligence.json    -- AI strategies & response analysis
package.json                 -- Dependencies
start.sh                     -- Linux/macOS/Termux launcher
start.ps1                    -- Windows PowerShell launcher
.gitignore                   -- Ignore node_modules, secrets
README.md                    -- This file
```

---

## 🔧 Configuration

### Proxies (proxies.txt)

```
# HTTP/HTTPS proxies
http://user:pass@proxy-host:8000
https://user:pass@proxy-host:8000

# SOCKS5 proxy
socks5://127.0.0.1:1080

# Tor (requires tor.json enabled: true)
tor://

# Comments
# This is a comment
```

### Authentication (token.txt)

```
your-secret-token-123
```

Or set environment variable:
```powershell
# PowerShell
$env:PROXY_TOKEN="your-secret-token-123"
npm start

# CMD
set PROXY_TOKEN=your-secret-token-123
npm start

# Bash
export PROXY_TOKEN="your-secret-token-123"
npm start
```

### Custom Port

```powershell
$env:PORT=8011
npm start

# Or
npm start -- --port 8011
```

---

## 🕷️ Crawl Settings (UI)

| Setting | Default | Description |
|---------|---------|-------------|
| **Max Depth** | 3 | Link hops from seed URL |
| **Max Pages** | 50 | Total pages to fetch |
| **Concurrency** | 3 | Parallel workers |
| **Delay (ms)** | 500 | Time between requests (adaptive with intelligence) |
| **Allow External** | ✗ | Crawl outside main domain |
| **Allow Subdomains** | ✓ | Include subdomains |
| **Allow Backward** | ✗ | Crawl paths above seed |
| **Obey Robots.txt** | ✓ | Respect robots.txt rules |
| **Only Main Content** | ✓ | Filter ads/nav/sidebar |

---

## 🔒 Security & Privacy

| Feature | Benefit |
|---------|---------|
| **SSRF Guard** | Blocks internal IPs (127.0.0.1, 192.168.x, etc.) but allows `.onion` |
| **Tor Integration** | Circuit isolation, IP rotation, `.onion` access |
| **DoH** | DNS queries encrypted, prevents ISP monitoring |
| **Fingerprinting** | TLS + HTTP mimicry (Chrome/Firefox/Edge/Safari) |
| **Token Auth** | Proxy access control (recommended for LANs) |
| **Hot-Reload** | Update configs without server restart |

---

## 🏗️ Architecture

```
Browser (index.html)
    ↓
Express Server (server.js)
    ├─→ CORS Headers
    ├─→ Token Validation
    ├─→ Target URL Validation
    ├─→ SSRF Guard (.onion allowed)
    ├─→ DoH Resolution + Cache
    ├─→ Fingerprint Selection
    ├─→ Proxy Pool Rotation
    ├─→ Tor Integration (if enabled)
    ├─→ Crawler Intelligence
    │   ├─→ Response Analysis
    │   ├─→ Adaptive Delay
    │   ├─→ Anti-Bot Detection
    │   └─→ Error Memory/Blacklist
    └─→ cuimp (Chrome TLS + HTTP Fingerprint)
        └─→ Target Website
```

---

## 🚨 Troubleshooting

### Windows PowerShell Issues

**Error: "cannot be loaded because running scripts is disabled"**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Port already in use**
```powershell
# Find process using port 8010
netstat -ano | findstr :8010

# Kill process (replace PID)
taskkill /PID <PID> /F

# Or use different port
$env:PORT=8011; npm start
```

**Module not found: 'express'**
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
npm start
```

### Tor Issues

**Tor not connecting**
```bash
# Verify Tor daemon running
telnet 127.0.0.1 9050

# Or start Tor manually
tor --SocksPort 9050 --ControlPort 9051
```

**Error: "Tor is not enabled"**
- Edit `tor.json` and set `"enabled": true`
- Make sure `tor://` is in `proxies.txt`

### DoH Issues

**DNS resolution failed**
- Check internet connectivity
- Try alternative provider: `"provider": "google"` or `"provider": "quad9"`
- Verify URL is correct in `doh.json`

### High Rate Limits

**Getting 429 responses frequently**
1. Increase `crawl settings → Delay (ms)`
2. Enable `adaptive_delay` in `crawler-intelligence.json`
3. Add more proxies to `proxies.txt`
4. Use **residential proxies** (not datacenter)
5. Reduce `Concurrency` to 1–2

### Fingerprint Detection

**Still getting blocked despite rotating profiles**
1. Add more profiles to `fingerprints.json`
2. Use residential proxies (datacenter IPs are flagged)
3. Increase delay between requests
4. Enable `cookie_persistence` for session handling

---

## 📊 Performance Tips

| Tip | Benefit |
|-----|---------|
| Use **residential proxies** | Harder to detect than datacenter IPs |
| Enable **DoH caching** | Reduces DNS latency |
| Set **concurrency = 1–3** | Avoid rate limits & bans |
| Use **Tor for .onion only** | Tor is slow; use standard proxies for clearnet |
| Enable **cookie persistence** | Required for sites with sessions |
| Adjust **adaptive delay thresholds** | Auto-tune delays based on responses |

---

## 🔌 Proxy Examples

### Free Proxies (unreliable, slow)
```
http://10.10.1.10:3128
http://proxy.example.com:8080
socks5://proxy.example.com:1080
```

### Residential Proxies (recommended, paid)
```
http://residential-proxy-api.com:port
socks5://user:pass@residential-proxy.com:1080
```

### Datacenter Proxies (fast, easier to detect)
```
http://datacenter-proxy.com:8080
socks5://dc-proxy.example.com:1080
```

### Tor Network
```
tor://
```

---

## 🛠️ Advanced Usage

### Export Results

**JSON Format**
```javascript
// Results auto-saved in memory
// UI provides "Export JSON" button
// Each result includes: url, title, description, matched_keywords, content
```

**CSV Format**
```
URL,Title,Description,Keywords
https://example.com,Page Title,Description,"keyword1,keyword2"
```

### Custom Crawl Rules

Edit `crawler-intelligence.json`:
```json
{
  "response_analysis": {
    "content_signals": {
      "min_content_length": 500,
      "redirect_chains": 5
    }
  }
}
```

### Learn from Errors

Enable memory system:
```json
{
  "memory": {
    "learnFromErrors": true,
    "blacklistDurations": {
      "rate_limit": 1800000,
      "temporary": 300000
    }
  }
}
```

---

## 📦 Dependencies

```json
{
  "express": "^4.19.2",
  "cuimp": "*"
}
```

**cuimp**: Chrome fingerprint HTTP client for TLS mimicry + SOCKS5 support.

Install manually:
```bash
npm install express cuimp
```

---

## 🧪 Testing

### Local Test

```powershell
# Start server
npm start

# In another terminal, test proxy
curl -x http://localhost:8010 https://httpbin.org/headers

# Or use browser
# http://localhost:8010/?url=https://example.com
```

### With Authentication

```powershell
# Edit token.txt
echo "my-secret-token" > token.txt

# Test with token
curl -H "X-Proxy-Token: my-secret-token" `
  -x http://localhost:8010 `
  https://httpbin.org/headers
```

---

## 📜 License

MIT

---

## 🤝 Contributing

Issues and PRs welcome. Please test on Windows PowerShell, macOS, and Linux.

---

## ⚠️ Legal Notice

This tool is for **educational and authorized testing only**. Ensure you have permission to crawl target websites. Respect `robots.txt`, rate limits, and Terms of Service. Misuse may violate laws (CFAA, GDPR, etc.).

---

## 🎯 Roadmap

- [ ] Persistent result database (SQLite)
- [ ] Headless browser rendering (Puppeteer)
- [ ] Machine learning for link prioritization
- [ ] REST API for remote crawling
- [ ] Multi-instance coordination
- [ ] Real-time WebSocket updates
- [ ] Export to CSV/JSON/XML

---

**Status:** Production-ready | **Last Updated:** 2026-08-31 | **Node:** 18+ | **Platforms:** Windows, macOS, Linux, Termux
