export type WarrantySnapshot = {
  months: number | null;
  startAt: Date | null;
  endAt: Date | null;
};

export const addCalendarMonthsClamped = (start: Date, months: number): Date => {
  if (!Number.isInteger(months) || months < 0) {
    throw new Error("Warranty months must be a non-negative integer");
  }

  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const day = start.getUTCDate();
  const hours = start.getUTCHours();
  const minutes = start.getUTCMinutes();
  const seconds = start.getUTCSeconds();
  const milliseconds = start.getUTCMilliseconds();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(year, month, Math.min(day, lastDay), hours, minutes, seconds, milliseconds),
  );
};

export const warrantySnapshotForCompletion = (input: {
  months: number | null;
  completedAt: Date;
}): { startAt: Date | null; endAt: Date | null } => {
  if (input.months === null || input.months === 0) return { startAt: null, endAt: null };
  if (!Number.isInteger(input.months) || input.months < 0)
    throw new Error("Warranty months must be a non-negative integer");

  return {
    startAt: input.completedAt,
    endAt: addCalendarMonthsClamped(input.completedAt, input.months),
  };
};
