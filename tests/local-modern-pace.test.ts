/**
 * 本地分支 modern-pace:近现代节奏改动以后,跨过工业、电气、信息时代的历史"接着推"和"一口气推完"仍然逐字段一样
 * (Polity.modern 记下的那几刻在重放时照样重新预约扩张,见 polities.ts 的 grantModern)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { extendCiv } from '../src/gen/civ/extend';

function sameCiv(a: Civ, b: Civ, label: string) {
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
}

describe('近现代节奏(本地分支)', () => {
  it('seed 7:推到 3300 再推到 4000、推到 3700 再推到 4000,都和一次推到 4000 逐字段相等;到 4000 年有国家记了近现代', async () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const whole = generateCiv(w, { endYear: 4000 });
    expect(whole.polities.some((p) => (p.modern?.length ?? 0) > 0)).toBe(true);
    for (const mid of [3300, 3700]) {
      const base = generateCiv(w, { endYear: mid });
      const once = await extendCiv(w, base, { endYear: 4000 });
      sameCiv(once!, whole, `seed 7 ${mid} → 4000`);
    }
  }, 600_000);
});
