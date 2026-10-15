/**
 * Per-scope evidence: `<slug>-success.png` + `<slug>.webm`. A scope without both is not done.
 *
 * The screenshot is taken only AFTER the scope's success state is visible, so it shows what the scope
 * proved; a scope that never reaches it leaves `<slug>-failure.png` instead (and fails). The video is
 * finalized once the page closes — call `saveVideo` from `afterEach` so it is kept on failure too.
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { trimStaticSegments } from './video';

export interface EvidenceOptions {
    /** Where the evidence goes, e.g. `<app>/test-results/live-cip30-runs`. */
    dir: string;
    /**
     * Drive the page from "loaded" to the success state before it is checked, through user controls
     * only (e.g. open a card pack and turn its cards).
     */
    reachSuccess?: (page: Page, successSelector: string, timeoutMs: number) => Promise<void>;
    /** Drop the static stretches from each video (ffmpeg; raw copy when unavailable). */
    trimVideo?: boolean;
    log?: (line: string) => void;
}

export interface Evidence {
    dir: string;
    /** The scope's evidence: success screenshot now, video when `saveVideo` runs. */
    saveEvidence(page: Page, testInfo: TestInfo, slug: string, successSelector: string, timeoutMs?: number): Promise<void>;
    /** For `afterEach`: closes the page and saves the video of a scope that called `saveEvidence`. */
    saveVideo(page: Page, testInfo: TestInfo): Promise<void>;
    /** Evidence for a further tab of a multi-tab scope. Call the returned function at the end of the scope to close it and save its video. */
    saveTabEvidence(page: Page, slug: string, successSelector: string, timeoutMs?: number): Promise<() => Promise<void>>;
}

const EVIDENCE_ANNOTATION = 'evidence';

export const createEvidence = (options: EvidenceOptions): Evidence => {
    const { dir } = options;
    const log = options.log ?? console.log;

    const screenshotSuccess = async (page: Page, slug: string, successSelector: string, timeoutMs: number) => {
        mkdirSync(dir, { recursive: true });
        try {
            if (options.reachSuccess) await options.reachSuccess(page, successSelector, timeoutMs);
            await page.locator(successSelector).first().waitFor({ state: 'visible', timeout: timeoutMs });
        } catch (error) {
            await page.screenshot({ path: path.join(dir, `${slug}-failure.png`) }).catch(() => undefined);
            throw new Error(`${slug}: success state "${successSelector}" not reached: ${(error as Error).message}`, { cause: error });
        }
        await page.screenshot({ path: path.join(dir, `${slug}-success.png`) });
        log(`SCREENSHOT: ${slug}-success.png`);
    };

    const finalizeVideo = async (page: Page, slug: string) => {
        const video = page.video();
        if (!page.isClosed()) await page.close();
        if (!video) throw new Error(`${slug}: video recording is unavailable; the scope evidence is incomplete.`);
        const target = path.join(dir, `${slug}.webm`);
        mkdirSync(dir, { recursive: true });
        if (!options.trimVideo) {
            await video.saveAs(target);
        } else {
            const raw = path.join(dir, `${slug}.raw.webm`);
            await video.saveAs(raw);
            const trimmed = trimStaticSegments(raw, target);
            rmSync(raw, { force: true });
            if (!trimmed) log(`VIDEO (untrimmed): ${slug}.webm`);
        }
        log(`VIDEO: ${slug}.webm`);
    };

    return {
        dir,
        saveEvidence: async (page, testInfo, slug, successSelector, timeoutMs = 180_000) => {
            testInfo.annotations.push({ type: EVIDENCE_ANNOTATION, description: slug });
            await screenshotSuccess(page, slug, successSelector, timeoutMs);
        },
        saveVideo: async (page, testInfo) => {
            const slug = testInfo.annotations.find((a) => a.type === EVIDENCE_ANNOTATION)?.description;
            if (slug) await finalizeVideo(page, slug);
        },
        saveTabEvidence: async (page, slug, successSelector, timeoutMs = 180_000) => {
            await page.bringToFront(); // the user looks at this tab (animations only run in the visible one)
            await screenshotSuccess(page, slug, successSelector, timeoutMs);
            return async () => {
                await page.unrouteAll({ behavior: 'ignoreErrors' });
                await finalizeVideo(page, slug);
            };
        }
    };
};
