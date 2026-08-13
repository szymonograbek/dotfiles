import type { Notifications, Unsubscribe } from "../core/notifications/Notifications";

export class FakeNotifications implements Notifications {
  private token: string;
  private readonly listeners = new Set<(token: string) => void>();

  constructor(initialToken: string) {
    this.token = initialToken;
  }

  async getToken(): Promise<string> {
    return this.token;
  }

  onTokenChanged(listener: (token: string) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setToken(token: string): void {
    this.token = token;
    for (const listener of this.listeners) listener(token);
  }
}
