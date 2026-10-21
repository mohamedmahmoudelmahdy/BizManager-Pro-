/** Helpers for employee-scoped procedure views (dashboard, recent activity). */

export type ProcedureAssigneeRef = {
  assignedEmployeeId?: string;
  date?: string;
};

export function isProcedureAssignedToUser(
  procedure: ProcedureAssigneeRef,
  userId?: string | null
): boolean {
  if (!userId) return false;
  return String(procedure.assignedEmployeeId || '') === String(userId);
}

export function filterProceduresForEmployee<T extends ProcedureAssigneeRef>(
  procedures: T[],
  userId: string | undefined,
  options?: {
    dateInRange?: (date: string | undefined) => boolean;
  }
): T[] {
  if (!userId) return [];
  return procedures.filter((procedure) => {
    if (!isProcedureAssignedToUser(procedure, userId)) return false;
    if (options?.dateInRange && !options.dateInRange(procedure.date)) return false;
    return true;
  });
}
