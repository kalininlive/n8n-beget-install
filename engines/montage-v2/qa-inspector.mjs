// Visual QA inspector and keyframe extractor for Video Editing System.
// Extracts representative frames from rendered video and generates contact sheets for visual inspection / Agnes AI review.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getVideoProfile } from './video-profile.mjs';

export const QA_SCHEMA_VERSION = 'genesis.qa-inspector/v1';

export function planInspectionTimestamps(duration, scenes = []) {
  const points = new Set();
  // 1. Beginning and near start of video
  points.add(0.2);
  points.add(Math.min(1.0, duration * 0.1));

  // 2. Middle and key scene transitions
  if (Array.isArray(scenes) && scenes.length > 0) {
    for (const scene of scenes) {
      if (Number.isFinite(scene.t0)) points.add(Math.max(0, scene.t0 + 0.3));
      if (Number.isFinite(scene.t1)) points.add(Math.max(0, scene.t1 - 0.2));
    }
  } else {
    // Even sampling across duration
    const steps = Math.min(6, Math.max(3, Math.floor(duration / 5)));
    for (let i = 1; i <= steps; i++) {
      points.add(Number(((duration * i) / (steps + 1)).toFixed(2)));
    }
  }

  // 3. Near end of video
  if (duration > 1.0) points.add(Number((duration - 0.5).toFixed(2)));

  return Array.from(points)
    .filter((t) => t >= 0 && t <= duration)
    .sort((a, b) => a - b);
}

export function extractKeyframes(videoFile, timestamps, outputDir) {
  if (!fs.existsSync(videoFile)) throw new Error(`Video file not found: ${videoFile}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const extracted = [];
  for (const [index, time] of timestamps.entries()) {
    const filename = `frame_${String(index).padStart(2, '0')}_${time.toFixed(2)}s.jpg`;
    const target = path.join(outputDir, filename);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      time.toFixed(3),
      '-i',
      videoFile,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      target,
    ]);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      extracted.push({ index, time, path: target, filename });
    }
  }
  return extracted;
}

export function buildContactSheet(framePaths, outputFile, { cols = 3 } = {}) {
  if (!framePaths.length) throw new Error('No frames provided for contact sheet');
  const rows = Math.ceil(framePaths.length / cols);
  const inputs = framePaths.flatMap((f) => ['-i', f]);
  const filter = `nullsrc=size=1080x1920[base];[0:v]scale=360:640[v0];...`;

  // FFmpeg tile filter approach: create a list of inputs and tile them
  // Or concat them into a grid
  const scaleFilters = framePaths.map((_, i) => `[${i}:v]scale=360:640[s${i}]`).join(';');
  const tileChains = framePaths.map((_, i) => `[s${i}]`).join('');
  const complexFilter = `${scaleFilters};${tileChains}xstack=inputs=${framePaths.length}:layout=${generateGridLayout(framePaths.length, cols, 360, 640)}[out]`;

  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputs,
    '-filter_complex',
    complexFilter,
    '-map',
    '[out]',
    '-q:v',
    '3',
    outputFile,
  ]);

  return { outputFile, count: framePaths.length, rows, cols };
}

function generateGridLayout(count, cols, cellW, cellH) {
  const layouts = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    layouts.push(`${col * cellW}_${row * cellH}`);
  }
  return layouts.join('|');
}

export function buildAgnesQaPrompt({ profileId = 'vertical-9x16-v1', style = 'pro-montage-v3' } = {}) {
  const profile = getVideoProfile(profileId);
  return `Ты — профессиональный технический контролёр видеомонтажа (Visual Quality Assurance).
Оцени предоставленные кадры видеомонтажа (профиль ${profile.name}, стиль "${style}").
Проверь каждый кадр на следующие дефекты:
1. text_clipped: обрезан ли текст заголовков или субтитров краем кадра?
2. outside_safe_area: попадает ли текст в зоны системного интерфейса (верхние 180px, правые 160px, нижние 400px)?
3. overlap: перекрывают ли текст, плашки или карточки лицо спикера?
4. face_obscured: закрыто ли лицо говорящего артефактами или графикой?
5. style_mismatch: есть ли явные визуальные артефакты, искажённые пропорции или чёрные полосы?

Ответь строго в формате JSON:
{
  "verdict": "pass" | "warn" | "fail",
  "defectsCount": 0,
  "issues": [
    { "frameIndex": 0, "type": "outside_safe_area", "severity": "error"|"warning", "evidence": "описание проблемы" }
  ],
  "recommendations": "краткая рекомендация по исправлению или подтверждение качества"
}`;
}
