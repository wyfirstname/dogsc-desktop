/**
 * 24 位 sRGB 颜色 —— Swift HexColor 的 TypeScript 转写。
 *
 * Swift source: Sources/RecorderCore/HexColor.swift
 * Upstream    : https://github.com/laogou717/dogsc @ 567fd6e
 *
 * 原版语义：项目持久化、预览场景求值、导出渲染三者共用的唯一颜色表示。
 * 只接受 RRGGBB / #RRGGBB，严格校验，解析失败返回 null（对应 Swift 的可失败构造器）。
 */

export interface RgbComponents {
  readonly red: number // 0..1
  readonly green: number
  readonly blue: number
}

export class HexColor {
  /** 0x000000..0xFFFFFF */
  readonly rgb24: number

  private constructor(rgb24: number) {
    this.rgb24 = rgb24
  }

  /** 由 24 位字面量构造（对应 Swift init(rgb24:)，越界即抛错） */
  static fromRgb24(rgb24: number): HexColor {
    if (!Number.isInteger(rgb24) || rgb24 < 0 || rgb24 > 0xff_ff_ff) {
      throw new RangeError('HexColor 需要 24 位 RGB 值')
    }
    return new HexColor(rgb24)
  }

  /** 严格解析 RRGGBB 或 #RRGGBB（允许首尾空白），失败返回 null */
  static parse(source: string): HexColor | null {
    const trimmed = source.trim()
    const digits = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
    if (!/^[0-9a-fA-F]{6}$/.test(digits)) return null
    return new HexColor(parseInt(digits, 16))
  }

  get components(): RgbComponents {
    return {
      red: ((this.rgb24 >> 16) & 0xff) / 255,
      green: ((this.rgb24 >> 8) & 0xff) / 255,
      blue: (this.rgb24 & 0xff) / 255
    }
  }

  /** 唯一的持久化与显示形式（对应 Swift hexString） */
  get hexString(): string {
    return '#' + this.rgb24.toString(16).toUpperCase().padStart(6, '0')
  }

  /** CSS 可用形式 */
  get css(): string {
    return this.hexString
  }

  static readonly white = HexColor.fromRgb24(0xff_ff_ff)
  static readonly black = HexColor.fromRgb24(0x00_00_00)
  /** 原版默认画布背景色 */
  static readonly defaultBackground = HexColor.fromRgb24(0x2d_33_42)

  equals(other: HexColor): boolean {
    return this.rgb24 === other.rgb24
  }
}
