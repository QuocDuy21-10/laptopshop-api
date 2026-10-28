export const toActor = (a: { id: number; fullName: string | null; username: string } | null) =>
  a ? { id: a.id, name: a.fullName ?? a.username } : null;
