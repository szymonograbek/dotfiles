import type { Notifications, Unsubscribe } from "../../core/notifications/Notifications";

export class FirebaseNotifications implements Notifications {
  async getToken(): Promise<string> {
    return "fixture-token";
  }

  onTokenChanged(_listener: (token: string) => void): Unsubscribe {
    return () => undefined;
  }
}
