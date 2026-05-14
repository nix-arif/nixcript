export function hasAccess(
  userPermissions: string[],
  permission: string,
): boolean {
  if (userPermissions.includes("*")) return true;
  return userPermissions.includes(permission);
}
