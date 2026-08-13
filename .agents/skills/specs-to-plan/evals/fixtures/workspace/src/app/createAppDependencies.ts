import type { Notifications } from "../core/notifications/Notifications";
import { FirebaseNotifications } from "../infrastructure/firebase/FirebaseNotifications";

export type AppDependencies = {
  notifications: Notifications;
  dispose(): void;
};

export function createAppDependencies(): AppDependencies {
  const notifications = new FirebaseNotifications();

  return {
    notifications,
    dispose: () => undefined,
  };
}
