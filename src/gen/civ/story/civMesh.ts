/**
 * 本地分支 modern-pace 第六十轮:历史 → 地块坐标。推演结果(Civ)里只有地块编号,没有坐标;
 * 城市带(cityBelts.ts)要量城与城的距离,按 civ.regions 记一份网格(换名、套作者人物出来的新对象共用同一个 regions)。
 * 生成历史时(generateCiv,主线程和后台线程各自)记;读存档打开的,主线程拿到世界时补记(App)。
 */
export interface CivMesh {
  x: Float32Array;
  y: Float32Array;
  /** 世界宽(左右相连) */
  width: number;
  n: number;
}

const meshes = new WeakMap<object, CivMesh>();

export function setCivMesh(civ: { regions: object; history?: { regions: object } }, world: { width: number; mesh: { x: Float32Array; y: Float32Array; n: number } }): void {
  const m: CivMesh = { x: world.mesh.x, y: world.mesh.y, width: world.width, n: world.mesh.n };
  meshes.set(civ.regions, m);
  if (civ.history) meshes.set(civ.history.regions, m);
}

export function civMesh(civ: { regions: object; history?: { regions: object } }): CivMesh | null {
  return meshes.get(civ.regions) ?? (civ.history ? meshes.get(civ.history.regions) : undefined) ?? null;
}
