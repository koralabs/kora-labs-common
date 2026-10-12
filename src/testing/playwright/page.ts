import type { Page } from '@playwright/test';

/**
 * Run `work` (a multi-minute Node-side chain/indexer wait) with the page parked on about:blank and
 * pulsed, so the renderer is never reaped as idle. The app page keeps polling/retrying resources and
 * over a long idle that churn can grow the renderer until it dies; a blank page cannot. The CALLER
 * navigates back to the app afterwards.
 */
export const keepPageAlive = async <T>(page: Page, work: Promise<T>, intervalMs = 3000): Promise<T> => {
    try {
        await page.goto('about:blank');
    } catch {
        // already navigating / closed — the heartbeat still covers it
    }
    let done = false;
    const beat = (async () => {
        while (!done) {
            try {
                await page.evaluate(() => void document.hidden);
            } catch {
                // mid-navigation or teardown — ignore
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    })();
    try {
        return await work;
    } finally {
        done = true;
        await beat;
    }
};

const NEXT_DEV_OVERLAY_CSS = `
    nextjs-portal {
        display: none !important;
        pointer-events: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        z-index: -9999 !important;
        position: fixed !important;
        top: -9999px !important;
    }
`;

/**
 * Hide the Next.js dev error overlay, which blocks pointer events under `next dev`. Call after every
 * navigation. Prefer a short `actionTimeout` instead when the overlay's error should fail the scope:
 * hiding it also hides the app error it reports.
 */
export const hideNextDevOverlay = async (page: Page): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            await page.waitForLoadState('domcontentloaded');
            await page.addStyleTag({ content: NEXT_DEV_OVERLAY_CSS });
            return;
        } catch (error) {
            lastError = error;
            // A navigation between the load-state wait and the injection destroys the context: retry.
            if (!/Execution context was destroyed|Target closed|frame was detached/i.test((error as Error).message ?? String(error))) throw error;
            await page.waitForTimeout(1500);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
