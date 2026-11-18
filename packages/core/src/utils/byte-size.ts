export type ByteSizeFormat = keyof typeof BYTE_UNITS;

export type ByteSizeString =
  `${number}${" " | ""}${ByteSizeFormat | Lowercase<ByteSizeFormat> | Uppercase<ByteSizeFormat>}`;

/**
 * Anything the arithmetic and {@link ByteSize.parse} accept: a size, a string form, or a raw byte
 * count. The string is not narrowed to {@link ByteSizeString}, since parsing validates at runtime.
 */
export type ByteSizeOperand = ByteSize | string | number;

const BYTE_UNITS = Object.freeze({
  B: 1,
  KB: 1000,
  MB: 1000 * 1000,
  GB: 1000 * 1000 * 1000,
  TB: 1000 * 1000 * 1000 * 1000,
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
  TiB: 1024 * 1024 * 1024 * 1024,
});

/** `Object.keys` widens to `string[]`; this is the one place that knows better. */
const formats = Object.freeze(Object.keys(BYTE_UNITS) as ByteSizeFormat[]);

const formatOf = (unit: string) =>
  formats.find((format) => format.toLowerCase() === unit.toLowerCase());

const bytesOf = (operand: ByteSizeOperand): number => ByteSize.parse(operand).toBytes();

/**
 * Represents a size in bytes, with support for various units.
 *
 * This is more like a general-purpose byte size utility, however used primarily to
 * reduce boilerplate, increase readability, and provide convenient operations on byte
 * sizes that often are hard to work with directly.
 *
 * @human
 */
export class ByteSize {
  private constructor(private readonly bytes: number) {}

  static fromBytes(bytes: number): ByteSize {
    return new ByteSize(bytes);
  }

  static from(value: number, format: ByteSizeFormat): ByteSize {
    return new ByteSize(BYTE_UNITS[format] * value);
  }

  /**
   * Interprets the operand by what it is: a size as itself, a number as a byte count,
   * and a string through {@link ByteSize.parseString}.
   */
  static parse(operand: ByteSizeOperand): ByteSize {
    if (operand instanceof ByteSize) return operand;

    return typeof operand === "number"
      ? ByteSize.fromBytes(operand)
      : ByteSize.parseString(operand);
  }

  /** Parses `"1.5 MiB"`, `"10mb"` or `"2 GB"`. Throws on anything it does not recognise. */
  static parseString(input: string): ByteSize {
    const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(input.trim());
    const [, value, unit] = match ?? [];

    if (value === undefined || unit === undefined) {
      throw new Error(`Invalid byte size: ${input}`);
    }

    const format = formatOf(unit);
    if (!format) throw new Error(`Unknown byte size unit: ${unit}`);
    return ByteSize.from(Number(value), format);
  }

  to(format: ByteSizeFormat): number {
    return this.bytes / BYTE_UNITS[format];
  }

  ceil() {
    return new ByteSize(Math.ceil(this.bytes));
  }

  floor() {
    return new ByteSize(Math.floor(this.bytes));
  }

  round() {
    return new ByteSize(Math.round(this.bytes));
  }

  toBytes(): number {
    return this.bytes;
  }

  /** Adds a size, a string form or a byte count. */
  add(operand: ByteSizeOperand): ByteSize {
    return new ByteSize(this.bytes + bytesOf(operand));
  }

  /** Subtracts a size, a string form or a byte count; refusing to go below zero. */
  subtract(operand: ByteSizeOperand): ByteSize {
    const bytes = this.bytes - bytesOf(operand);

    if (bytes < 0) {
      throw new RangeError(`Cannot subtract ${String(operand)} from ${this.format()}`);
    }

    return new ByteSize(bytes);
  }

  /** Scales by a factor, given as a number, a size or its string form (e.g. `"2 B"` for 2×). */
  multiply(factor: ByteSizeOperand): ByteSize {
    return new ByteSize(this.bytes * bytesOf(factor));
  }

  isZero(): boolean {
    return this.bytes === 0;
  }

  gt(other: ByteSizeOperand): boolean {
    return this.bytes > bytesOf(other);
  }

  gte(other: ByteSizeOperand): boolean {
    return this.bytes >= bytesOf(other);
  }

  lt(other: ByteSizeOperand): boolean {
    return this.bytes < bytesOf(other);
  }

  lte(other: ByteSizeOperand): boolean {
    return this.bytes <= bytesOf(other);
  }

  eq(other: ByteSizeOperand): boolean {
    return this.bytes === bytesOf(other);
  }

  /**
   * Formats with the fewest decimals the value needs, capped at `maxFractionDigits`. The result is
   * always a {@link ByteSizeString}, so it parses back through {@link ByteSize.parse}.
   */
  format(maxFractionDigits = 2): ByteSizeString {
    const unit: ByteSizeFormat =
      (["TB", "GB", "MB", "KB"] as const).find((unit) => this.bytes >= BYTE_UNITS[unit]) ?? "B";

    const value = Number(
      // A fixed locale without grouping keeps the output a plain decimal: `1.5`, never `1,5` or
      // `1,000`. Back through `Number` so the template stays a `${number}`, and trailing zeros go.
      new Intl.NumberFormat("en-US", {
        maximumFractionDigits: maxFractionDigits,
        useGrouping: false,
      }).format(this.bytes / BYTE_UNITS[unit]),
    );

    return `${value} ${unit}`;
  }

  toString(): ByteSizeString {
    return this.format();
  }
}
