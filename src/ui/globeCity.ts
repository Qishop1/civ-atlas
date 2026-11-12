/**
 * 本地分支 modern-pace 第六十九轮:地球仪上的城区贴图(用户"快速拖动时候还不跟着星球走")。
 * 原来城区层是另一张画布,每帧按球的投影把贴图切成 64 × 32 块一块块贴 —— 慢,又比球晚一拍。
 * 现在 CityLayer(地球仪模式)把整张世界坐标的城区贴图交到这里,Globe 换进球的贴图槽 city,由着色器跟地形一起画:
 * mode 1 = 白天(叠在地形上、文明色块和云下面,跟着昼夜明暗走);2 = 夜景(球整体压暗,灯按发光叠加,云下面暗一些);0 = 不画
 */
type Listener = () => void;

export const globeCity: { src: HTMLCanvasElement | null; mode: number; ver: number } = { src: null, mode: 0, ver: 0 };
const subs = new Set<Listener>();

export function setGlobeCity(src: HTMLCanvasElement | null, mode: number): void {
  globeCity.src = src;
  globeCity.mode = src ? mode : 0;
  globeCity.ver++;
  subs.forEach((f) => f());
}

export function subscribeGlobeCity(f: Listener): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
