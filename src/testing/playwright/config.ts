/**
 * Playwright presets for live suites: long serial runs with multi-minute chain waits on one browser.
 */

/**
 * Keep a renderer alive across multi-minute idle chain waits and heavy scenes. Without these, headless
 * Chromium (WSL2/CI) backgrounds, timer-throttles or reaps an idle renderer, and the next `goto` fails
 * with "Target page, context or browser has been closed" although the tx succeeded. Software GL stays
 * available (`--disable-gpu` falls back to SwiftShader), so WebGL apps still render.
 */
export const LONG_RUN_CHROMIUM_ARGS = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-hang-monitor'
];

/**
 * Further renderer hardening for heavy 2D pages (e.g. a canvas designer). `--disable-software-rasterizer`
 * removes the software-GL fallback: do NOT use it for an app that needs WebGL.
 */
export const HARDENED_RENDERER_CHROMIUM_ARGS = [
    ...LONG_RUN_CHROMIUM_ARGS,
    '--disable-software-rasterizer',
    '--disable-features=IsolateOrigins,site-per-process,CalculateNativeWinOcclusion',
    '--disable-ipc-flooding-protection'
];

/** The *.handle.me WAF requires the kora backend-request token (`KORA_USER_AGENT`) in the User-Agent. */
export const koraUserAgent = ({ token = process.env.KORA_USER_AGENT || 'kora-backend-request/1.0', chromeVersion = '145.0.0.0' }: { token?: string; chromeVersion?: string } = {}) =>
    `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 ${token}`;
