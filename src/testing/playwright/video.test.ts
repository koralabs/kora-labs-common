import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trimLeadingDeadAir, trimStaticSegments } from './video';

// Jest gives tests a private copy of process.env that child processes never see, so the boundary
// (spawning the ffmpeg binary) is redirected to the fake instead of editing PATH.
let fakeBin = '';
jest.mock('node:child_process', () => {
    const real = jest.requireActual('node:child_process');
    return {
        ...real,
        spawnSync: (cmd: string, args: string[], opts: any) =>
            real.spawnSync(cmd === 'ffmpeg' ? fakeBin : cmd, args, { ...opts, env: process.env })
    };
});

// Fake `ffmpeg`: records its args; behavior chosen by FAKE_FFMPEG_MODE.
const FAKE = `#!/bin/sh
echo "$@" >> "$FAKE_FFMPEG_LOG"
[ "$1" = "-version" ] && exit 0
case "$FAKE_FFMPEG_MODE" in
  fail) exit 1 ;;
esac
for last; do :; done
case " $* " in
  *freezedetect*) echo "freeze_start: 0.5" >&2; echo "freeze_end: 3.5" >&2; exit 0 ;;
esac
echo trimmed > "$last"
`;

describe('playwright video helpers', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'video-test-'));
        mkdirSync(path.join(dir, 'bin'));
        writeFileSync(path.join(dir, 'bin', 'ffmpeg'), FAKE);
        chmodSync(path.join(dir, 'bin', 'ffmpeg'), 0o755);
        fakeBin = path.join(dir, 'bin', 'ffmpeg');
        process.env.FAKE_FFMPEG_LOG = path.join(dir, 'log');
        process.env.FAKE_FFMPEG_MODE = 'ok';
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('trimStaticSegments writes the trimmed output and reports success', () => {
        writeFileSync(path.join(dir, 'in.webm'), 'raw');
        expect(trimStaticSegments(path.join(dir, 'in.webm'), path.join(dir, 'out.webm'))).toBe(true);
        expect(readFileSync(path.join(dir, 'out.webm'), 'utf8')).toBe('trimmed\n');
    });

    it('trimStaticSegments keeps a raw copy when ffmpeg fails', () => {
        process.env.FAKE_FFMPEG_MODE = 'fail';
        writeFileSync(path.join(dir, 'in.webm'), 'raw');
        expect(trimStaticSegments(path.join(dir, 'in.webm'), path.join(dir, 'out.webm'))).toBe(false);
        expect(readFileSync(path.join(dir, 'out.webm'), 'utf8')).toBe('raw');
    });

    it('trimLeadingDeadAir skips the leading freeze and writes an mp4 beside each webm (nested too)', () => {
        mkdirSync(path.join(dir, 'rec', 'sub'), { recursive: true });
        writeFileSync(path.join(dir, 'rec', 'sub', 'a.webm'), 'raw');
        writeFileSync(path.join(dir, 'rec', 'ignore.txt'), 'x');
        const lines: string[] = [];
        trimLeadingDeadAir(path.join(dir, 'rec'), (l) => lines.push(l));
        expect(existsSync(path.join(dir, 'rec', 'sub', 'a.mp4'))).toBe(true);
        expect(lines).toEqual(['[trimVideos] trimmed 3.5s of dead air -> ' + path.join('sub', 'a.mp4')]);
        expect(readFileSync(process.env.FAKE_FFMPEG_LOG!, 'utf8')).toContain('-ss 3.5');
    });

    it('trimLeadingDeadAir reports a failed encode, and does nothing for a missing dir', () => {
        process.env.FAKE_FFMPEG_MODE = 'fail';
        mkdirSync(path.join(dir, 'rec'));
        writeFileSync(path.join(dir, 'rec', 'a.webm'), 'raw');
        const lines: string[] = [];
        trimLeadingDeadAir(path.join(dir, 'rec'), (l) => lines.push(l));
        expect(lines).toEqual(['[trimVideos] failed on a.webm']);
        trimLeadingDeadAir(path.join(dir, 'nope'), (l) => lines.push(l));
        expect(lines).toHaveLength(1);
    });
});
