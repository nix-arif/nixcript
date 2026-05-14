export function mapUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,

    // 🔥 FIX HERE
    image: user.image ?? null,

    role: user.role ?? null,
    banned: user.banned ?? false,
    banReason: user.banReason ?? null,
    banExpires: user.banExpires ?? null,

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
