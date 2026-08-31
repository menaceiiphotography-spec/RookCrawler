const fs = require('fs');
const path = require('path');
const cuimp = require('cuimp');

const INPUT = 'proxy_sources/master-deduped.txt';
const OUTDIR = 'benchmark';
const RESULTS = path.join(OUTDIR, 'all-results.jsonl');
const SUMMARY = path.join(OUTDIR, 'summary.txt');
const MATRIX = path.join(OUTDIR, 'matrix.tsv');

const TARGET = process.env.TARGET || 'https://example.com';

const BROWSERS = ['chrome', 'firefox', 'edge', 'safari'];

const TIMEOUT = Number(process.env.TIMEOUT || 8000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);

fs.mkdirSync(OUTDIR, { recursive: true });

if (!fs.existsSync(INPUT)) {
    console.error(`[FATAL] Missing ${INPUT}`);
    process.exit(1);
}

const proxies = [...new Set(
    fs.readFileSync(INPUT, 'utf8')
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
)];

function key(proxy, browser) {
    return `${proxy}|${browser}`;
}

/*
 * Load completed tests so the benchmark is resumable.
 */
const completed = new Set();

if (fs.existsSync(RESULTS)) {
    const lines = fs.readFileSync(RESULTS, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean);

    for (const line of lines) {
        try {
            const r = JSON.parse(line);

            if (r.proxy && r.browser) {
                completed.add(key(r.proxy, r.browser));
            }
        } catch {
            console.warn('[WARN] Ignoring malformed result line.');
        }
    }
}

const jobs = [];

for (const proxy of proxies) {
    for (const browser of BROWSERS) {
        if (!completed.has(key(proxy, browser))) {
            jobs.push({ proxy, browser });
        }
    }
}

const totalTests = proxies.length * BROWSERS.length;
const alreadyDone = completed.size;

console.log('');
console.log('============================================================');
console.log(' ROOK CRAWLER - FULL PROXY/BROWSER BENCHMARK');
console.log('============================================================');
console.log(`Proxies:          ${proxies.length}`);
console.log(`Browsers:         ${BROWSERS.length}`);
console.log(`Total tests:      ${totalTests}`);
console.log(`Already complete: ${alreadyDone}`);
console.log(`Remaining:        ${jobs.length}`);
console.log(`Concurrency:      ${CONCURRENCY}`);
console.log(`Timeout:          ${TIMEOUT}ms`);
console.log(`Target:           ${TARGET}`);
console.log(`Results:          ${RESULTS}`);
console.log('============================================================');
console.log('');

if (jobs.length === 0) {
    console.log('All tests are already complete.');
    process.exit(0);
}

const appendResult = result => {
    fs.appendFileSync(
        RESULTS,
        JSON.stringify(result) + '\n'
    );
};

function classify(status, error) {
    if (status === 200) {
        return 'PASS';
    }

    if (status && status >= 400) {
        return 'CONNECTED_BUT_REJECTED';
    }

    if (error) {
        const text = String(error).toLowerCase();

        if (
            text.includes('timeout') ||
            text.includes('timed out') ||
            text.includes('etimedout') ||
            text.includes('operation timed out')
        ) {
            return 'TIMEOUT';
        }

        return 'ERROR';
    }

    return 'FAIL';
}

async function test(job) {
    const started = Date.now();

    let status = 0;
    let error = '';

    try {
        const client = cuimp.createCuimpHttp({
            descriptor: {
                browser: job.browser,
                version: 'latest'
            },
            autoDownload: false
        });

        const response = await client.get(TARGET, {
            proxy: job.proxy,
            timeout: TIMEOUT,
            headers: {
                'Accept':
                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        status = Number(response.status || 0);

    } catch (err) {
        error = String(err?.message || err || '')
            .replace(/\s+/g, ' ')
            .slice(0, 500);

        if (err?.response?.status) {
            status = Number(err.response.status);
        }
    }

    const elapsed = Date.now() - started;

    return {
        timestamp: new Date().toISOString(),
        proxy: job.proxy,
        browser: job.browser,
        classification: classify(status, error),
        status,
        response_time_ms: elapsed,
        error
    };
}

let nextJob = 0;
let finished = alreadyDone;

const counters = {
    PASS: 0,
    FAIL: 0,
    TIMEOUT: 0,
    CONNECTED_BUT_REJECTED: 0,
    ERROR: 0
};

async function worker(workerId) {
    while (true) {
        const index = nextJob++;

        if (index >= jobs.length) {
            return;
        }

        const job = jobs[index];
        const result = await test(job);

        appendResult(result);

        counters[result.classification]++;
        finished++;

        const marker =
            result.classification === 'PASS' ? '✓' :
            result.classification === 'TIMEOUT' ? 'T' :
            result.classification === 'CONNECTED_BUT_REJECTED' ? 'R' :
            result.classification === 'ERROR' ? 'E' : 'F';

        console.log(
            `[${finished}/${totalTests}] ${marker} ` +
            `${result.browser.padEnd(7)} ` +
            `${result.classification.padEnd(24)} ` +
            `${String(result.status).padEnd(4)} ` +
            `${String(result.response_time_ms).padStart(5)}ms ` +
            `${result.proxy}`
        );
    }
}

async function writeSummary() {
    const records = [];

    if (fs.existsSync(RESULTS)) {
        const lines = fs.readFileSync(RESULTS, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean);

        for (const line of lines) {
            try {
                records.push(JSON.parse(line));
            } catch {}
        }
    }

    const summary = {
        target: TARGET,
        proxies: proxies.length,
        browsers: BROWSERS,
        total_tests: totalTests,
        recorded_tests: records.length,
        generated_at: new Date().toISOString(),
        overall: {},
        browsers: {}
    };

    const classes = [
        'PASS',
        'FAIL',
        'TIMEOUT',
        'CONNECTED_BUT_REJECTED',
        'ERROR'
    ];

    for (const c of classes) {
        summary.overall[c] = records.filter(
            r => r.classification === c
        ).length;
    }

    for (const browser of BROWSERS) {
        const rows = records.filter(r => r.browser === browser);

        summary.browsers[browser] = {
            TOTAL: rows.length,
            PASS: rows.filter(r => r.classification === 'PASS').length,
            FAIL: rows.filter(r => r.classification === 'FAIL').length,
            TIMEOUT: rows.filter(r => r.classification === 'TIMEOUT').length,
            CONNECTED_BUT_REJECTED:
                rows.filter(r => r.classification === 'CONNECTED_BUT_REJECTED').length,
            ERROR: rows.filter(r => r.classification === 'ERROR').length
        };
    }

    fs.writeFileSync(
        SUMMARY,
        JSON.stringify(summary, null, 2) + '\n'
    );

    /*
     * Build browser matrix.
     */
    const lookup = new Map();

    for (const r of records) {
        lookup.set(key(r.proxy, r.browser), r);
    }

    const matrixLines = [
        [
            'proxy',
            'chrome',
            'firefox',
            'edge',
            'safari'
        ].join('\t')
    ];

    for (const proxy of proxies) {
        const cells = [proxy];

        for (const browser of BROWSERS) {
            const r = lookup.get(key(proxy, browser));

            if (!r) {
                cells.push('NOT_TESTED');
            } else {
                cells.push(
                    `${r.classification}:${r.status}:${r.response_time_ms}ms`
                );
            }
        }

        matrixLines.push(cells.join('\t'));
    }

    fs.writeFileSync(
        MATRIX,
        matrixLines.join('\n') + '\n'
    );

    /*
     * Create categorized proxy lists.
     */
    const categories = [
        'PASS',
        'FAIL',
        'TIMEOUT',
        'CONNECTED_BUT_REJECTED',
        'ERROR'
    ];

    for (const browser of BROWSERS) {
        const dir = path.join(OUTDIR, browser);
        fs.mkdirSync(dir, { recursive: true });

        for (const category of categories) {
            const file = path.join(
                dir,
                category.toLowerCase() + '.txt'
            );

            const values = records
                .filter(
                    r =>
                        r.browser === browser &&
                        r.classification === category
                )
                .map(r => r.proxy);

            fs.writeFileSync(
                file,
                [...new Set(values)].join('\n') +
                (values.length ? '\n' : '')
            );
        }
    }

    /*
     * Universal four-browser passes.
     */
    const universal = [];

    for (const proxy of proxies) {
        const rows = BROWSERS.map(
            browser => lookup.get(key(proxy, browser))
        );

        if (
            rows.length === 4 &&
            rows.every(r => r && r.classification === 'PASS')
        ) {
            universal.push(proxy);
        }
    }

    fs.writeFileSync(
        path.join(OUTDIR, 'universal-4-browser-pass.txt'),
        universal.join('\n') +
        (universal.length ? '\n' : '')
    );

    /*
     * Any-browser passes.
     */
    const anyBrowser = [];

    for (const proxy of proxies) {
        const rows = BROWSERS.map(
            browser => lookup.get(key(proxy, browser))
        );

        if (
            rows.some(r => r && r.classification === 'PASS')
        ) {
            anyBrowser.push(proxy);
        }
    }

    fs.writeFileSync(
        path.join(OUTDIR, 'passes-any-browser.txt'),
        anyBrowser.join('\n') +
        (anyBrowser.length ? '\n' : '')
    );

    console.log('');
    console.log('============================================================');
    console.log(' FINAL BENCHMARK SUMMARY');
    console.log('============================================================');

    console.log(`Total proxies:              ${proxies.length}`);
    console.log(`Total browser tests:        ${totalTests}`);
    console.log(`Recorded tests:             ${records.length}`);
    console.log('');

    for (const c of classes) {
        console.log(
            `${c.padEnd(28)} ${summary.overall[c]}`
        );
    }

    console.log('');

    for (const browser of BROWSERS) {
        const b = summary.browsers[browser];

        console.log(`--- ${browser.toUpperCase()} ---`);
        console.log(`PASS=                       ${b.PASS}`);
        console.log(`FAIL=                       ${b.FAIL}`);
        console.log(`TIME OUT=                   ${b.TIMEOUT}`);
        console.log(
            `CONNECTED BUT REJECTED=    ${b.CONNECTED_BUT_REJECTED}`
        );
        console.log(`ERROR=                      ${b.ERROR}`);
        console.log('');
    }

    console.log(
        `UNIVERSAL 4-BROWSER PASS=   ${universal.length}`
    );

    console.log(
        `PASS ON ANY BROWSER=        ${anyBrowser.length}`
    );

    console.log('');
    console.log(`Summary: ${SUMMARY}`);
    console.log(`Matrix:  ${MATRIX}`);
    console.log(
        `Universal: ${OUTDIR}/universal-4-browser-pass.txt`
    );
    console.log(
        `Any browser: ${OUTDIR}/passes-any-browser.txt`
    );
}

async function main() {
    const workers = [];

    for (
        let i = 0;
        i < Math.min(CONCURRENCY, jobs.length);
        i++
    ) {
        workers.push(worker(i));
    }

    await Promise.all(workers);

    await writeSummary();
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
