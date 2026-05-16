/**
 * Vector3 - Represents a 3D vector/point
 * Common utility for positions, rotations, velocities
 */

export class Vector3 {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0
  ) {}

  /**
   * Add another vector to this vector
   */
  add(other: Vector3): Vector3 {
    return new Vector3(
      this.x + other.x,
      this.y + other.y,
      this.z + other.z
    );
  }

  /**
   * Subtract another vector from this vector
   */
  subtract(other: Vector3): Vector3 {
    return new Vector3(
      this.x - other.x,
      this.y - other.y,
      this.z - other.z
    );
  }

  /**
   * Multiply by scalar
   */
  multiply(scalar: number): Vector3 {
    return new Vector3(
      this.x * scalar,
      this.y * scalar,
      this.z * scalar
    );
  }

  /**
   * Divide by scalar
   */
  divide(scalar: number): Vector3 {
    return new Vector3(
      this.x / scalar,
      this.y / scalar,
      this.z / scalar
    );
  }

  /**
   * Get magnitude (length) of vector
   */
  magnitude(): number {
    return Math.sqrt(
      this.x * this.x +
      this.y * this.y +
      this.z * this.z
    );
  }

  /**
   * Normalize vector to unit length
   */
  normalize(): Vector3 {
    const mag = this.magnitude();
    if (mag === 0) return new Vector3(0, 0, 0);
    return this.divide(mag);
  }

  /**
   * Dot product with another vector
   */
  dot(other: Vector3): number {
    return (
      this.x * other.x +
      this.y * other.y +
      this.z * other.z
    );
  }

  /**
   * Clone this vector
   */
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /**
   * Convert to array
   */
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  /**
   * Create from array
   */
  static fromArray(arr: [number, number, number]): Vector3 {
    return new Vector3(arr[0], arr[1], arr[2]);
  }

  /**
   * Zero vector
   */
  static get zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  /**
   * Unit vector pointing up
   */
  static get up(): Vector3 {
    return new Vector3(0, 1, 0);
  }

  /**
   * Unit vector pointing forward
   */
  static get forward(): Vector3 {
    return new Vector3(0, 0, 1);
  }

  /**
   * Unit vector pointing right
   */
  static get right(): Vector3 {
    return new Vector3(1, 0, 0);
  }

  /**
   * String representation
   */
  toString(): string {
    return `Vector3(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`;
  }

  /**
   * Check if two vectors are equal (within tolerance)
   */
  equals(other: Vector3, tolerance: number = 0.0001): boolean {
    return (
      Math.abs(this.x - other.x) < tolerance &&
      Math.abs(this.y - other.y) < tolerance &&
      Math.abs(this.z - other.z) < tolerance
    );
  }
}
