/**
 * MotionStyle — 运镜/光标风格与弹簧参数。
 *
 * Swift source: Sources/RecorderCore/ProjectModel.swift @ laogou717/dogsc 567fd6e
 *   - struct MotionStyle          (L1248)
 *   - enum ScreenMotionStyle      (L486)
 *   - enum CursorMotionStyle      (L493)
 *
 * 注意：Swift 用中文 rawValue 作为持久化键。这里保留中文常量，
 * 以便读取原项目 project.json 时语义一致。
 */

import type { ScreenMotionCreationStyle } from './ScreenMotionCreationStyle'

export type ScreenMotionStyle = '聚焦' | '平滑';

export type CursorMotionStyle = '平滑' | '适中' | '快速' | '无';

export const SCREEN_MOTION_STYLES: readonly ScreenMotionStyle[] = ['聚焦', '平滑'];
export const CURSOR_MOTION_STYLES: readonly CursorMotionStyle[] = ['平滑', '适中', '快速', '无'];

export interface MotionStyle {
  screen: ScreenMotionStyle;
  cursor: CursorMotionStyle;
  screenSpringMass: number;
  screenSpringStiffness: number;
  screenSpringDamping: number;
  cursorSpringMass: number;
  cursorSpringStiffness: number;
  cursorSpringDamping: number;
  defaultZoomEasing: string;
  defaultZoomTransitionDuration: number;
  /**
   * 工程持有的创建默认值。老工程在作者应用预设之前，
   * 仍可继承应用记住的放大倍数。
   */
  defaultZoomScale?: number | null;
  /** 新建动画时继承的屏幕 3D 样式（Swift ScreenMotionCreationStyle?）。 */
  defaultScreenMotion?: ScreenMotionCreationStyle | null;
}

/** Swift 默认值逐项对照 MotionStyle.init 的缺省参数。 */
export function makeMotionStyle(overrides: Partial<MotionStyle> = {}): MotionStyle {
  const merged: MotionStyle = {
    screen: '聚焦',
    cursor: '平滑',
    screenSpringMass: 2.4,
    screenSpringStiffness: 210,
    screenSpringDamping: 42,
    cursorSpringMass: 2.8,
    cursorSpringStiffness: 450,
    cursorSpringDamping: 66,
    defaultZoomEasing: '弹簧',
    defaultZoomTransitionDuration: 0.7,
    ...overrides,
  };
  // 对应 Swift init 中的 min(max(defaultZoomTransitionDuration, 0), 5)
  merged.defaultZoomTransitionDuration = clamp(merged.defaultZoomTransitionDuration, 0, 5);
  return merged;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}
