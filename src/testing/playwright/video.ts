/**
 * Video post-processing for live-suite evidence (ffmpeg). Best-effort by design: a missing ffmpeg
 * or a failed trim keeps the raw recording — evidence is never dropped because a trim failed.
 * ffmpeg comes from the optional `ffmpeg-static` package when installed, else from PATH.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** The ffmpeg binary to use, or null when there is none. */
export const resolveFfmpeg = (): string | null => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bundled = require('ffmpeg-static') as string | null;
        if (bundled && existsSync(bundled)) return bundled;
    } catch {
        // not installed — fall back to PATH
    }
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? 'ffmpeg' : null;
};

/**
 * Drop the static stretches (chain/indexer waits with an idle page) from a recording, keeping
 * high quality (scene threshold 0.002, VP9 CRF 15). Writes `output`; on any failure `output` is a raw
 * copy. Returns whether the trim succeeded.
 */
export const trimStaticSegments = (input: string, output: string): boolean => {
    const ffmpeg = resolveFfmpeg();
    if (ffmpeg) {
        const result = spawnSync(
            ffmpeg,
            [
                '-i', input,
                '-vf', "select='gt(scene,0.002)',setpts=N/FRAME_RATE/TB",
                '-af', "aselect='gt(scene,0.002)',asetpts=N/SR/TB",
                '-c:v', 'libvpx-vp9', '-crf', '15', '-b:v', '0',
                '-y', output
            ],
            { stdio: 'pipe', timeout: 120_000 }
        );
        if (result.status === 0 && existsSync(output) && statSync(output).size > 0) return true;
    }
    if (path.resolve(input) !== path.resolve(output)) copyFileSync(input, output);
    return false;
};

/**
 * For Playwright `globalTeardown`: for every `.webm` under `dir`, cut the leading frozen segment
 * (the blank page while a scope waits before its first navigation) and write a shareable `.mp4`
 * beside it (mp4 previews inline on Discord/GitHub where webm often does not). Skips quietly without ffmpeg.
 */
export const trimLeadingDeadAir = (dir: string, log: (line: string) => void = console.log) => {
    if (!existsSync(dir)) return;
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) {
        log('[trimVideos] ffmpeg not found — skipping video trim');
        return;
    }
    const webms: string[] = [];
    const walk = (d: string) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.webm')) webms.push(p);
        }
    };
    walk(dir);
    for (const webm of webms) {
        const detect = spawnSync(ffmpeg, ['-i', webm, '-vf', 'freezedetect=n=-50dB:d=2', '-map', '0:v', '-f', 'null', '-'], { encoding: 'utf8' });
        const stderr = detect.stderr ?? '';
        const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
        const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
        const skip = starts.length && starts[0] <= 1.5 && ends.length ? ends[0] : 0;
        const mp4 = webm.replace(/\.webm$/, '.mp4');
        const encode = spawnSync(ffmpeg, ['-y', '-ss', String(skip), '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', mp4], { stdio: 'ignore' });
        if (encode.status === 0) log(`[trimVideos] trimmed ${skip.toFixed(1)}s of dead air -> ${path.relative(dir, mp4)}`);
        else log(`[trimVideos] failed on ${path.basename(webm)}`);
    }
};
