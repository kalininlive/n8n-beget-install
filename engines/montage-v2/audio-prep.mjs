#!/usr/bin/env node
// Audio cleanup and word-timed pause removal for GENESIS workflow 7.
// Auphonic is primary when AUPHONIC_API_KEY is configured; FFmpeg is the local fallback.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { planEditEdl } from './edit-edl.mjs';

const API = 'https://auphonic.com/api';
const run = (bin, args, opts = {}) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const fail = message => { out({ ok: false, error: String(message) }); process.exit(1); };
const dur = file => Number(run('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0',file]).toString().trim());

function pcmEnvelope(file) {
  // Jingle alignment needs a 10 ms loudness envelope, not 48 kHz speech samples.
  // Use a duration-sized buffer: even 8 kHz PCM can exceed execFileSync's 1 MiB
  // default for clips longer than ~32 seconds, which caused an ENOBUFS fallback.
  const maxBuffer = Math.max(1024 * 1024, Math.ceil(dur(file) * 8000 * 4 + 1024 * 1024));
  const raw = run('ffmpeg', ['-hide_banner','-loglevel','error','-i',file,'-vn','-ac','1','-ar','8000','-f','f32le','-'], { maxBuffer });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const frame = 80; // 10 ms at 8 kHz
  const env = new Float64Array(Math.floor(samples.length / frame));
  for (let i = 0; i < env.length; i++) {
    let sum = 0;
    for (let j = i * frame; j < (i + 1) * frame; j++) sum += samples[j] * samples[j];
    env[i] = Math.log10(Math.sqrt(sum / frame) + 1e-4);
  }
  let mean = 0; for (const x of env) mean += x; mean /= Math.max(1, env.length);
  let variance = 0; for (const x of env) variance += (x - mean) ** 2;
  const sd = Math.sqrt(variance / Math.max(1, env.length));
  for (let i = 0; i < env.length; i++) env[i] = (env[i] - mean) / (sd || 1);
  return env;
}

function alignJingle(source, cleaned, extra) {
  const a = pcmEnvelope(source), b = pcmEnvelope(cleaned);
  const maxShift = Math.min(Math.floor((extra + 1) * 100), Math.max(0, b.length - 100));
  if (!maxShift) return { shift: 0, corr: -1, z: 0 };
  // Coarse 100 ms scan, then 10 ms refinement around the best candidate.
  const score = (shift, stride) => {
    const n = Math.min(a.length, b.length - shift);
    if (n < 100) return -1;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, c = 0;
    for (let i = 0; i < n; i += stride) { const x = a[i], y = b[shift + i]; sx += x; sy += y; sxx += x*x; syy += y*y; sxy += x*y; c++; }
    const vx = sxx - sx*sx/c, vy = syy - sy*sy/c;
    return vx > 0 && vy > 0 ? (sxy - sx*sy/c) / Math.sqrt(vx*vy) : -1;
  };
  let best = 0, peak = -1;
  for (let k = 0; k <= maxShift; k += 10) { const s = score(k, 10); if (s > peak) { peak = s; best = k; } }
  for (let k = Math.max(0, best - 10); k <= Math.min(maxShift, best + 10); k++) { const s = score(k, 1); if (s > peak) { peak = s; best = k; } }
  const candidates = [];
  for (let k = 0; k <= maxShift; k += 10) candidates.push(score(k, 10));
  const sorted = [...candidates].sort((x,y) => x-y), median = sorted[Math.floor(sorted.length/2)];
  const mean = candidates.reduce((s,x) => s+x, 0) / candidates.length;
  const sd = Math.sqrt(candidates.reduce((s,x) => s + (x-mean)**2, 0) / candidates.length) || 1;
  return { shift: best / 100, corr: peak, z: (peak - median) / sd };
}

async function auphonic(src, dst, title, key) {
  key = String(key || '').trim();
  if (!key) throw new Error('Auphonic credential не передан из n8n');
  // The user asked for no-cost processing. Auphonic's API reports whether an account has paid credits;
  // only run productions on an account explicitly identified as free, otherwise use local FFmpeg.
  const accountResponse = await fetch(`${API}/user.json`, {
    headers: { Authorization: `bearer ${key}` }, signal: AbortSignal.timeout(30000)
  });
  if (!accountResponse.ok) throw new Error(`Auphonic account check: HTTP ${accountResponse.status}`);
  const account = (await accountResponse.json())?.data;
  if (account?.is_paying_user !== false) throw new Error('Auphonic не подтвердил бесплатный аккаунт; для защиты от списаний включён локальный FFmpeg');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-auphonic-'));
  const input = path.join(tmp, 'voice.flac'), downloaded = path.join(tmp, 'auphonic.wav');
  try {
    run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',src,'-vn','-ac','1','-ar','48000',input]);
    const headers = { Authorization: `bearer ${key}` };
    const create = await fetch(`${API}/productions.json`, { method:'POST', headers:{...headers,'Content-Type':'application/json'},
      body: JSON.stringify({ metadata:{title}, output_files:[{format:'wav'}], algorithms:{
        denoise:true, denoisemethod:'speech_isolation', denoiseamount:0, deverbamount:0, dehum:0, dehumamount:0,
        filtering:true, filtermethod:'autoeq', leveler:true, normloudness:true, loudnesstarget:-16, maxpeak:-1,
        silence_cutter:false, filler_cutter:false, cough_cutter:false
      } }), signal:AbortSignal.timeout(60000) });
    if (!create.ok) throw new Error(`Auphonic create: HTTP ${create.status}`);
    const created = await create.json();
    const uuid = created?.data?.uuid;
    if (!uuid) throw new Error('Auphonic не вернул UUID production');
    const form = new FormData();
    form.append('input_file', new Blob([fs.readFileSync(input)], {type:'audio/flac'}), 'voice.flac');
    const upload = await fetch(`${API}/production/${uuid}/upload.json`, {method:'POST',headers,body:form,signal:AbortSignal.timeout(600000)});
    if (!upload.ok) throw new Error(`Auphonic upload: HTTP ${upload.status}`);
    const start = await fetch(`${API}/production/${uuid}/start.json`, {method:'POST',headers,signal:AbortSignal.timeout(60000)});
    if (!start.ok) throw new Error(`Auphonic start: HTTP ${start.status}`);
    const until = Date.now() + 900000;
    let details;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await fetch(`${API}/production/${uuid}.json`, {headers,signal:AbortSignal.timeout(60000)});
      if (!poll.ok) throw new Error(`Auphonic poll: HTTP ${poll.status}`);
      details = (await poll.json())?.data;
      if (details?.status === 3) break;
      if (details?.status === 2) throw new Error(`Auphonic: ${details.error_message || details.status_string || 'обработка не удалась'}`);
    }
    if (details?.status !== 3) throw new Error('Auphonic: превышен лимит ожидания 15 минут');
    const url = details.output_files?.find(x => x.download_url)?.download_url;
    if (!url) throw new Error('Auphonic не вернул ссылку на чистый звук');
    const response = await fetch(url, {headers,signal:AbortSignal.timeout(600000)});
    if (!response.ok) throw new Error(`Auphonic download: HTTP ${response.status}`);
    fs.writeFileSync(downloaded, Buffer.from(await response.arrayBuffer()));
    const inputDur = dur(input), outputDur = dur(downloaded);
    let jingle = 0;
    if (outputDur - inputDur > 1) {
      const match = alignJingle(input, downloaded, outputDur - inputDur);
      if (match.corr < 0.5 && !(Math.abs(match.shift - (outputDur - inputDur)) <= 0.15 && match.z >= 3))
        throw new Error(`Auphonic: длина +${(outputDur-inputDur).toFixed(2)}с и джингл нельзя надёжно совместить`);
      jingle = match.shift;
      const trimmed = path.join(tmp, 'trimmed.wav');
      run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',downloaded,'-af',`atrim=start=${jingle.toFixed(3)}:duration=${inputDur.toFixed(3)},asetpts=PTS-STARTPTS`,'-ac','1','-ar','48000',trimmed]);
      fs.copyFileSync(trimmed, downloaded);
    }
    if (Math.abs(inputDur - dur(downloaded)) > 0.05) throw new Error('Auphonic изменил длительность: синхронизация с видео небезопасна');
    fs.copyFileSync(downloaded, dst);
    return {method:'auphonic',denoisemethod:'speech_isolation',uuid,credits_used_h:details.used_credits?.combined ?? null,jingle_trimmed_s:jingle || undefined};
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

function normalizeWords(words, unit='auto') {
  const ms = unit === 'milliseconds' || (unit === 'auto' && (Array.isArray(words) ? words : []).some(w => Number(w.start ?? w.t ?? 0) > 1000 || Number(w.end ?? w.e ?? 0) > 1000));
  return (Array.isArray(words) ? words : []).map(w => ({
    text: String(w.text ?? w.word ?? w.w ?? '').trim(),
    start: Number(w.start ?? w.t ?? 0), end: Number(w.end ?? w.e ?? 0),
    confidence: w.confidence ?? w.probability
  })).filter(w => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map(w => ({...w, start: ms ? w.start / 1000 : w.start, end: ms ? w.end / 1000 : w.end}));
}

function silencePlan(words, duration) {
  const headKeep = 0.25, tailKeep = 0.6, gapMin = 0.70, gapKeep = 0.15, grid = 0.2;
  if (!words.length) return [[0,duration]];
  const cuts = [];
  const snapUp = x => Math.ceil((x - 1e-7) / grid) * grid;
  const snapDown = x => Math.floor((x + 1e-7) / grid) * grid;
  for (let i=1;i<words.length;i++) {
    const a = words[i-1].end, b = words[i].start, gap = b-a;
    if (gap <= gapMin) continue;
    // Keep a short natural breath beside each word; remove the middle of a long gap.
    let ca = snapUp(a + gapKeep/2);
    let cb = snapDown(b - gapKeep/2);
    if (cb-ca >= 0.20) cuts.push([ca,cb]);
  }
  const first = Math.max(0, snapDown(words[0].start - headKeep));
  const last = Math.min(duration, snapUp(words.at(-1).end + tailKeep));
  const keep = []; let cursor = first;
  for (const [a,b] of cuts) { const x=Math.max(cursor,a), y=Math.min(last,b); if (x>cursor) keep.push([cursor,x]); cursor=Math.max(cursor,y); }
  if (last>cursor) keep.push([cursor,last]);
  return keep.length ? keep : [[0,duration]];
}

function mapTime(t, ranges) {
  let elapsed=0;
  for (const [a,b] of ranges) { if (t < a) return elapsed; if (t <= b) return elapsed + Math.max(0,t-a); elapsed += b-a; }
  return elapsed;
}

function readF32Audio(file) {
  const maxBuffer = Math.max(1024 * 1024, Math.ceil(dur(file) * 16000 * 4 + 1024 * 1024));
  const raw = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer });
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}

export async function processDirectory(request, apiKey) {
  const dir = path.resolve(String(request.directory || ''));
  if (!dir.startsWith('/data/genesis/')) throw new Error('разрешены только папки задачи в /data/genesis');
  if (!fs.existsSync(dir) || fs.realpathSync(dir) !== dir) throw new Error('папка задачи отсутствует или проходит через symlink');
  const words = normalizeWords(request.words, request.timeUnit || 'auto');
  if (!Array.isArray(request.words)) throw new Error('в запросе нет списка слов');
  const marker = path.join(dir,'audio_prep.json'), video = path.join(dir,'video.mp4'), backup=path.join(dir,'video_raw.mp4');
  if (fs.existsSync(marker) && fs.existsSync(video)) {
    const saved=JSON.parse(fs.readFileSync(marker,'utf8'));
    if ((saved.version===1 || saved.version===2) && saved.completed) {
      return {ok:true,words:saved.words,duration:saved.duration,audio:saved.audio,cut:saved.cut,skipped:true};
    }
  }
  let src = [video,path.join(dir,'heygen_video.mp4'),path.join(dir,'input_video.mp4'),path.join(dir,'_whisper_src.mp4'),backup].find(f=>fs.existsSync(f)&&fs.statSync(f).size>0);
  if (!src) throw new Error('в папке задачи нет исходного видео');
  const temp=path.join(dir,`.audio-prep-${process.pid}`); fs.mkdirSync(temp,{recursive:true});
  try {
    const cleanAudio=path.join(temp,'voice_clean.wav'), cutFile=path.join(temp,'video_cut.mp4');
    let audio;
    try { audio=await auphonic(src,cleanAudio,path.basename(dir),apiKey); }
    catch(e) {
      const msg=String(e?.message||e);
      run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',src,'-vn','-af','highpass=f=70,lowpass=f=15000,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=2.5:attack=10:release=100,loudnorm=I=-16:TP=-1.5:LRA=11','-ac','1','-ar','48000',cleanAudio]);
      audio={method:'ffmpeg',fallback_reason:msg.slice(0,220)};
    }
    const sourceDur=dur(src);
    if (!words.length) throw new Error('нет пословного транскрипта для безопасной вырезки пауз');

    const audioSamples = readF32Audio(cleanAudio);
    const edl = planEditEdl({
      duration: sourceDur,
      words,
      samples: audioSamples,
      jobId: path.basename(dir),
      profileId: 'vertical-9x16-v1',
      rules: { silenceMin: 0.18, silenceKeep: 0.10, sentenceSilenceKeep: 0.22 },
    });

    const parts = [], chains = [];
    for (const [index, segment] of edl.timelineMap.entries()) {
      const segDur = segment.sourceEnd - segment.sourceStart;
      const fadeOut = Math.max(0, segDur - 0.01).toFixed(3);
      parts.push(`[0:v]trim=start=${segment.sourceStart.toFixed(3)}:end=${segment.sourceEnd.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`);
      parts.push(`[1:a]atrim=start=${segment.sourceStart.toFixed(3)}:end=${segment.sourceEnd.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010,afade=t=out:st=${fadeOut}:d=0.010[a${index}]`);
      chains.push(`[v${index}][a${index}]`);
    }
    parts.push(`${chains.join('')}concat=n=${edl.timelineMap.length}:v=1:a=1[vout][aout]`);
    const filter = parts.join(';\n');

    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      '-i',
      cleanAudio,
      '-filter_complex',
      filter,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-crf',
      '17',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      cutFile,
    ]);

    const cutDur = dur(cutFile);
    if (Math.abs(cutDur - edl.outputDuration) > Math.max(0.35, edl.timelineMap.length * 0.04)) {
      throw new Error(`ffmpeg длительность после реза отличается от плана (${cutDur.toFixed(2)} vs ${edl.outputDuration.toFixed(2)}с)`);
    }

    const finalVideo = path.join(temp, 'video_final.mp4');
    fs.renameSync(cutFile, finalVideo);
    if (src === video && !fs.existsSync(backup)) fs.copyFileSync(video, backup);
    fs.renameSync(finalVideo, video);

    const result = {
      version: 2,
      completed: true,
      source: src === backup ? 'video_raw.mp4' : path.basename(src),
      sourceDuration: sourceDur,
      duration: dur(video),
      audio,
      edl,
      cut: {
        removedSeconds: edl.stats.removedSeconds,
        cuts: edl.stats.cuts,
        snappedSilenceSec: edl.stats.snappedSilenceSec,
        words: edl.words,
      },
      words: edl.words.map((w) => ({
        ...w,
        start: Math.round(w.start * 1000),
        end: Math.round(w.end * 1000),
      })),
    };
    const markerTmp = marker + '.tmp';
    fs.writeFileSync(markerTmp, JSON.stringify(result, null, 2) + '\n');
    fs.renameSync(markerTmp, marker);
    return { ok: true, words: result.words, duration: result.duration, audio: result.audio, cut: result.cut };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
