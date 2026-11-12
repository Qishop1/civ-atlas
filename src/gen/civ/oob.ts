/**
 * 本地分支 modern-pace:编制(order of battle)。每一仗双方各出一种编制:按国都所在州的时代、要打的那州的地形、
 * 从哪种边打过去(渡河、翻山、渡海)、民族类型挑;兵种相克乘在胜率的兵力上(只在一方到了火药时代以后才算,古代只写不算)。
 * 编年史按它写"以两个重甲骑兵团冲击某国长枪步军""以多用途战斗机联队击溃某国合成装甲师"。
 * 纯计算,不用随机数(同一仗无论什么时候算、算几次,挑出来的都一样)。
 */
import { AdjKind, type CultureKind } from './types';

/** 兵种 */
export const enum Arm {
  Foot = 0,
  Mobile = 1,
  Air = 2,
  Sea = 3,
  Fire = 4,
  /** 本地分支 modern-pace 第九轮:天(未来时代的轨道打击) */
  Space = 5,
}

/** 各时代(0 石器 … 8 未来)各兵种的编制名;'' = 那个时代没有这一种 */
export const OOB_NAMES: readonly (readonly string[])[] = [
  /* 步     */ ['部落战团', '步卒方阵', '重步兵军团', '长枪步军', '火枪步兵团', '线列步兵师', '步兵师', '机械化步兵旅', '人机混编步兵旅'],
  /* 机动   */ ['', '战车队', '骑兵队', '重甲骑兵团', '胸甲骑兵团', '骑兵旅', '装甲师', '合成装甲师', '无人装甲集群'],
  /* 空     */ ['', '', '', '', '', '', '轰炸机联队', '多用途战斗机联队', '无人机蜂群'],
  /* 海     */ ['', '桨船队', '桨帆战船队', '战舰队', '风帆战列舰队', '铁甲舰分舰队', '战列舰队', '航母打击群', '无人舰艇集群'],
  /* 火力   */ ['', '', '', '弩手营', '野战炮兵营', '重炮团', '炮兵师', '导弹旅', '高超音速导弹旅'],
  /* 天     */ ['', '', '', '', '', '', '', '', '轨道打击群'],
];

/** 编制编号 = 时代 × 8 + 兵种(存在史事 Annal.oob 里) */
export const oobCode = (era: number, arm: Arm): number => era * 8 + arm;
export const oobEra = (code: number): number => Math.floor(code / 8);
export const oobArm = (code: number): Arm => (code % 8) as Arm;
export function oobName(code: number): string {
  const n = OOB_NAMES[oobArm(code)]?.[oobEra(code)];
  return n || OOB_NAMES[Arm.Foot][oobEra(code)] || '军';
}

/** 挑编制要看的地形 */
export interface OobTerrain {
  /** 要打的那州:平地(不是林地、不是高山) */
  open: boolean;
  /** 从哪种边打过去 */
  via: AdjKind;
  /** 那州沿海(守方能出海军) */
  coastal: boolean;
}

/** 有没有这一种 */
const has = (era: number, arm: Arm) => !!OOB_NAMES[arm]?.[era];

/**
 * 一方挑编制:attack = 攻方;salt = 让同一对国家不同的仗换着出(州号 + 年份,不是随机数)。
 * 渡海:攻方出海军登陆(没有就步兵),守方在岸上迎战;
 * 进攻:电气以后常出空军,开阔地出机动(游牧更常),翻山、林地出步兵,火药以后偶尔出火力;
 * 防守:多出步兵、火力,开阔地也出机动。
 */
export function pickOob(era: number, kind: CultureKind | undefined, t: OobTerrain, attack: boolean, salt: number): number {
  const e = Math.max(0, Math.min(8, Math.floor(era)));
  const sea = t.via === AdjKind.Strait || t.via === AdjKind.SeaRoute;
  if (sea && attack && has(e, Arm.Sea)) return oobCode(e, Arm.Sea);
  const v = ((salt % 7) + 7) % 7;
  const rough = !t.open || t.via === AdjKind.Mountain;
  if (attack) {
    if (has(e, Arm.Space) && v === 3) return oobCode(e, Arm.Space);
    if (has(e, Arm.Air) && v < 3) return oobCode(e, Arm.Air);
    if (!rough && has(e, Arm.Mobile) && (v < 5 || kind === 'nomad')) return oobCode(e, Arm.Mobile);
    if (has(e, Arm.Fire) && v === 6) return oobCode(e, Arm.Fire);
    return oobCode(e, Arm.Foot);
  }
  if (has(e, Arm.Air) && v === 0) return oobCode(e, Arm.Air);
  if (has(e, Arm.Fire) && (v === 1 || v === 2)) return oobCode(e, Arm.Fire);
  if (!rough && has(e, Arm.Mobile) && (v === 3 || kind === 'nomad')) return oobCode(e, Arm.Mobile);
  return oobCode(e, Arm.Foot);
}

/**
 * 兵种相克:a 方(编制 ca)对 b 方(编制 cb)兵力再乘几(> 1 a 占便宜)。只看兵种和地形,时代差另算(wars.ts 的技术代差)。
 */
export function oobEdge(ca: number, cb: number, t: OobTerrain): number {
  const a = oobArm(ca);
  const b = oobArm(cb);
  const ea = oobEra(ca);
  if (a === Arm.Space) return 1.35;
  if (b === Arm.Space) return a === Arm.Fire && ea >= 8 ? 1 : 0.85; // 反卫星、高超音速拦截
  if (a === Arm.Mobile && b === Arm.Foot) return t.open ? (ea >= 6 ? 1.4 : 1.25) : 0.85;
  if (a === Arm.Foot && b === Arm.Mobile) return ea >= 3 ? 1.15 : 0.9; // 长枪、火枪能挡骑兵
  if (a === Arm.Air && (b === Arm.Mobile || b === Arm.Foot || b === Arm.Fire)) return b === Arm.Mobile ? 1.4 : 1.25;
  if (a === Arm.Air && b === Arm.Sea) return 1.2;
  if (b === Arm.Air && a !== Arm.Air) return a === Arm.Fire && ea >= 7 ? 1.1 : 0.8; // 防空导弹
  if (a === Arm.Fire && (b === Arm.Foot || b === Arm.Mobile)) return 1.15;
  if (a === Arm.Sea && b !== Arm.Sea && b !== Arm.Air) return ea >= 7 ? 1 : 0.8; // 登陆难
  return 1;
}

/**
 * 本地分支 modern-pace 第九轮:协同(主编制之外配属的另一种):工业以后才有。
 * 机动配空军(电气以后)或火力;空军配机动(开阔地)或步兵;步兵配火力;海军配空军(电气以后);天配无人机蜂群。没有 = −1
 */
export function pickSupport(main: number, t: OobTerrain): number {
  const e = oobEra(main);
  if (e < 5) return -1;
  const arm = oobArm(main);
  const rough = !t.open || t.via === AdjKind.Mountain;
  if (arm === Arm.Mobile) return has(e, Arm.Air) ? oobCode(e, Arm.Air) : oobCode(e, Arm.Fire);
  if (arm === Arm.Air) return rough ? oobCode(e, Arm.Foot) : oobCode(e, Arm.Mobile);
  if (arm === Arm.Foot) return has(e, Arm.Fire) ? oobCode(e, Arm.Fire) : -1;
  if (arm === Arm.Sea) return has(e, Arm.Air) ? oobCode(e, Arm.Air) : -1;
  if (arm === Arm.Space) return oobCode(e, Arm.Air);
  return has(e, Arm.Mobile) && !rough ? oobCode(e, Arm.Mobile) : oobCode(e, Arm.Foot);
}

/** 本地分支 modern-pace 第九轮:协同的加成;天基支援(侦察卫星 1、卫星导航 2,按位)的加成 */
export const SUPPORT_EDGE = 1.1;
export const SPACE_RECON = 1;
export const SPACE_NAV = 2;
export function spaceEdge(bits: number): number {
  return (bits & SPACE_RECON ? 1.1 : 1) * (bits & SPACE_NAV ? 1.1 : 1);
}
