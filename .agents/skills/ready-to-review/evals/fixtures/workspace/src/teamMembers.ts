export interface TeamMember {
  id: string;
  displayName: string;
}

export function sortTeamMembers(members: readonly TeamMember[]): readonly TeamMember[] {
  return [...members].sort((left, right) => left.displayName.localeCompare(right.displayName));
}
