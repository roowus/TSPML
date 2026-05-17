/**
 * PhysicsAPI - Placeholder for now
 * Will be implemented in Task #6
 */

import { ICoreContext } from '../types';
import { Vector3 } from './Vector3';

export class PhysicsAPI {
  private context: ICoreContext;

  constructor(context: ICoreContext) {
    this.context = context;
  }

  public getGravity(): number {
    return 9.8;
  }

  public setGravity(value: number): void {
    // TODO: Implement
  }
}
