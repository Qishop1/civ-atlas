/// <reference lib="webworker" />
/**
 * 本地分支 modern-pace:行星贴图的后台线程(planetTex.ts 排队发过来,一件一件算,算完把像素原样转回去)
 */
import { runJob, type TexJob } from './planetTexGen';

self.onmessage = (e: MessageEvent<{ id: string; job: TexJob }>) => {
  const { id, job } = e.data;
  try {
    const t = runJob(job);
    (self as unknown as Worker).postMessage({ id, px: t.px, w: t.w, h: t.h, glow: t.glow }, t.glow ? [t.px.buffer, t.glow.buffer] : [t.px.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
