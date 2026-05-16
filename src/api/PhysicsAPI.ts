/**
 * PhysicsAPI - Placeholder for now
 * Will be implemented in Task #6
 */

import { TSPML } from '../core/TSPML';
import { Vector3 } from './Vector3';

export class PhysicsAPI {
  private pml: TSPML;

  constructor(pml: TSPML) {
    this.pml = pml;
  }

  public getGravity(): number {
    return 9.8;
  }

  public setGravity(value: number): void {
    // TODO: Implement
  }
}
