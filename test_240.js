const fs = require('fs');
const cuimp = require('cuimp');

const INPUT = 'proxies.240.txt';
const RESULTS = 'proxy_test_results.txt';
const WORKING = 'proxies_working.txt';
const FAILED = 'proxies_failed.txt';

const TARGET = 'https://example.com';
const BROWSER = process.argv[2] || 'safari';
const TIMEOUT = 8000;
const CONCURRENCY = 8;

const proxies = fs.readFileSync(INPUT, 'utf8')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

function testProxy(proxy) {
    return new Promise(async resolve => {
        const started = Date.now();

        try {
            const client = cuimp.createCuimpHttp({
                descriptor: {
                    browser: BROWSER,
                    version: 'latest'
                },
                autoDownload: false
            });

            const r = await client.get(TARGET, {
                proxy,
                timeout: TIMEOUT,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml'
                }
            });

            const ms = Date.now() - started;

            resolve({
                proxy,
                browser: BROWSER,
                status: r.status || 0,
                ms,
                ok: r.status === 200,
                error: ''
            });

        } catch (err) {
            resolve({
                proxy,
                browser: BROWSER,
                status: 0,
                ms: Date.now() - started,
                ok: false,
                error: String(err.message || err).replace(/\s+/g, ' ')
            });
        }
    });
}

async function main() {
    fs.writeFileSync(RESULTS, '');
    fs.writeFileSync(WORKING, '');
    fs.writeFileSync(FAILED, '');

    console.log('=== ROOK CRAWLER 240-PROXY BENCHMARK ===');
    console.log(`Target:      ${TARGET}`);
    console.log(`Browser:     ${BROWSER}`);
    console.log(`Proxies:     ${proxies.length}`);
    console.log(`Timeout:     ${TIMEOUT}ms`);
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log();

    let next = 0;
    let completed = 0;
    let good = 0;
    let bad = 0;

    async function worker() {
        while (true) {
            const index = next++;
            if (index >= proxies.length) return;

            const result = await testProxy(proxies[index]);

            completed++;

            const line =
                `${result.proxy}\t${result.browser}\t${result.status}\t${result.ms}ms\t${result.error}\n`;

            fs.appendFileSync(RESULTS, line);

            if (result.ok) {
                good++;
                fs.appendFileSync(WORKING, `${result.proxy}\n`);

                console.log(
                    `[${completed}/${proxies.length}] ✓ ${result.proxy} HTTP=200 ${result.ms}ms`
                );
            } else {
                bad++;
                fs.appendFileSync(FAILED, `${result.proxy}\n`);

                console.log(
                    `[${completed}/${proxies.length}] ✗ ${result.proxy} HTTP=${result.status || 'TIMEOUT'} ${result.ms}ms`
                );
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(CONCURRENCY, proxies.length) },
            worker
        )
    );

    console.log();
    console.log('=== FINAL RESULT ===');
    console.log(`Tested:     ${completed}`);
    console.log(`HTTP 200:   ${good}`);
    console.log(`Failed:     ${bad}`);
    console.log(`Success:    ${((good / completed) * 100).toFixed(1)}%`);
    console.log();
    console.log(`Working:    ${WORKING}`);
    console.log(`Results:    ${RESULTS}`);
    console.log(`Failed:     ${FAILED}`);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
