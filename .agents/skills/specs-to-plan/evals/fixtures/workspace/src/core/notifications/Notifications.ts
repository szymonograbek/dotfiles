export type Unsubscribe = () => void;

export interface Notifications {
  onTokenChanged(listener: (token: string) => void): Unsubscribe;
  getToken(): Promise<string>;
}
