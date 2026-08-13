export interface Address {
  id: string;
  label: string;
  formatted: string;
  isDefault: boolean;
}

export async function getSavedAddresses(signal: AbortSignal): Promise<readonly Address[]> {
  const response = await fetch("/me/addresses", { signal });
  if (!response.ok) throw new Error("Addresses could not be loaded");
  return response.json();
}
