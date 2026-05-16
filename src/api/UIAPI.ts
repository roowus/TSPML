/**
 * UIAPI - Placeholder for now
 * Will be implemented in Task #10
 */

import { TSPML } from '../core/TSPML';

export class UIAPI {
  private pml: TSPML;

  constructor(pml: TSPML) {
    this.pml = pml;
  }

  public showNotification(message: string): void {
    if (typeof window !== 'undefined') {
      alert(message);
    }
  }
}
