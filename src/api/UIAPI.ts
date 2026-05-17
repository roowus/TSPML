/**
 * UIAPI - Placeholder for now
 * Will be implemented in Task #10
 */

import { ICoreContext } from '../types';

export class UIAPI {
  private context: ICoreContext;

  constructor(context: ICoreContext) {
    this.context = context;
  }

  public showNotification(message: string): void {
    if (typeof window !== 'undefined') {
      alert(message);
    }
  }
}
