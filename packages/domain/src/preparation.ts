import type {
  PreparationDocument,
  PreparationGroup,
  PreparationSchedule,
  PreparationStatus,
} from '@avicenna/contracts';

/** Staging menyimpan cycle berpadding dan contoh aktual juga memakai "1-". */
export function normalizeDeliveryCycle(value: unknown): number | null {
  const match = String(value ?? '')
    .trim()
    .match(/^(?:cycle\s*)?0*(\d+)\s*-?$/i);
  const cycle = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(cycle) && cycle > 0 && cycle <= 9999 ? cycle : null;
}

export function preparationClock(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const compact = text.replaceAll(':', '');
  if (!/^\d{4}(\d{2})?$/.test(compact)) return null;
  const h = Number(compact.slice(0, 2));
  const m = Number(compact.slice(2, 4));
  const s = compact.length === 6 ? Number(compact.slice(4, 6)) : 0;
  return h < 24 && m < 60 && s < 60
    ? `${compact.slice(0, 2)}:${compact.slice(2, 4)}:${String(s).padStart(2, '0')}`
    : null;
}

export function preparationDateAt(day: string, clock: string, offset = 0): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Date(
    `${date.toISOString().slice(0, 10)}T${clock.length === 5 ? `${clock}:00` : clock}+07:00`,
  ).toISOString();
}

export function preparationWindow(
  day: string,
  schedule: Pick<
    PreparationSchedule,
    'preparationStart' | 'preparationEnd' | 'dayOffset' | 'truckTime'
  > | null,
) {
  const start = preparationClock(schedule?.preparationStart);
  const end = preparationClock(schedule?.preparationEnd);
  const eta = preparationClock(schedule?.truckTime);
  const offset = schedule?.dayOffset ?? 0;
  const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const crosses = !!(start && end && end <= start);
  let truckNextDay = false;
  if (eta && start && end) {
    const truck = minutes(eta),
      begin = minutes(start),
      finish = minutes(end);
    truckNextDay = crosses
      ? truck < begin && !(truck > finish && truck >= 18 * 60)
      : (begin >= 18 * 60 && truck < 12 * 60 && truck < begin) || (truck < finish && truck < begin);
  }
  return {
    preparationStartAt: start && end ? preparationDateAt(day, start, offset) : null,
    deadlineAt: start && end ? preparationDateAt(day, end, offset + (end <= start ? 1 : 0)) : null,
    truckEtaAt: eta ? preparationDateAt(day, eta, offset + (truckNextDay ? 1 : 0)) : null,
  };
}

export function preparationStatus(
  planned: number,
  picked: number,
  deadline: string | null,
  latestPulling: string | null,
  now: Date,
): PreparationStatus {
  if (planned <= 0) return 'NO_PLAN';
  if (picked >= planned) {
    if (!deadline || !latestPulling) return 'COMPLETE_UNTIMED';
    return Date.parse(latestPulling) > Date.parse(deadline) ? 'COMPLETE_LATE' : 'COMPLETE';
  }
  if (!deadline) return 'UNCONFIGURED';
  if (now.valueOf() > Date.parse(deadline)) return 'OVERDUE';
  return picked > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
}

/** Undo berlaku per item/tahap, bukan mengurangi scan milik item lain. */
export function activePreparationScans<
  T extends { id: number; lineId: number; phase: string; action: string | null },
>(events: readonly T[]): T[] {
  const stacks = new Map<string, T[]>();
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (event.action === 'REJECTED') continue;
    const key = `${event.lineId}|${event.phase}`;
    const stack = stacks.get(key) ?? [];
    if (event.action === 'UNDO') stack.pop();
    else if (event.action === null || event.action === 'ACCEPTED') stack.push(event);
    stacks.set(key, stack);
  }
  return [...stacks.values()].flat().sort((a, b) => a.id - b.id);
}

export function groupPreparationDocuments(
  documents: readonly PreparationDocument[],
  schedules: readonly PreparationSchedule[],
  mode: 'PDS' | 'CYCLE',
  now = new Date(),
): PreparationGroup[] {
  const buckets = new Map<string, PreparationDocument[]>();
  for (const doc of documents) {
    if (doc.status === 'CANCELLED') continue;
    const key = JSON.stringify([
      doc.plantId,
      doc.customerId,
      doc.deliveryDate,
      doc.cycle,
      doc.destination,
      ...(mode === 'PDS' ? [doc.pdsNumber || `LL:${doc.documentNumber}`] : []),
    ]);
    buckets.set(key, [...(buckets.get(key) ?? []), doc]);
  }
  return [...buckets.entries()]
    .map(([key, docs]) => {
      const first = docs[0]!;
      const matches = schedules.filter(
        (s) => s.isActive && s.customerId === first.customerId && s.cycle === first.cycle,
      );
      const exact = matches.filter((s) => s.destination === first.destination);
      const fallback = matches.filter((s) => s.destination === '');
      const configuredExact = exact.filter((s) => s.preparationStart && s.preparationEnd);
      const configuredFallback = fallback.filter((s) => s.preparationStart && s.preparationEnd);
      const candidates = configuredExact.length
        ? configuredExact
        : configuredFallback.length
          ? configuredFallback
          : exact.length
            ? exact
            : fallback;
      const schedule =
        candidates.find((s) => s.gate === '') ??
        configuredFallback.find((s) => s.gate === '') ??
        (candidates.length === 1 ? candidates[0] : null);
      const window = preparationWindow(first.deliveryDate, schedule ?? null);
      const plannedKanban = docs.reduce((sum, d) => sum + d.plannedKanban, 0);
      const pickedKanban = docs.reduce((sum, d) => sum + d.pickedKanban, 0);
      const missingKanban = docs.reduce((sum, d) => sum + d.missingKanban, 0);
      const validPlan = docs.every((d) => d.invalidLines === 0 && d.lineCount > 0);
      const latestPullingAt =
        docs
          .map((d) => d.latestPullingAt)
          .filter((v): v is string => !!v)
          .sort()
          .at(-1) ?? null;
      return {
        key,
        plantId: first.plantId,
        plantCode: first.plantCode,
        customerId: first.customerId,
        customerName: first.customerName,
        deliveryDate: first.deliveryDate,
        cycle: first.cycle,
        destination: first.destination,
        documents: docs,
        pdsNumbers: [...new Set(docs.map((d) => d.pdsNumber).filter((v): v is string => !!v))],
        plannedKanban,
        pickedKanban,
        missingKanban,
        loadedKanban: docs.reduce((sum, d) => sum + d.loadedKanban, 0),
        progress:
          plannedKanban > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(((plannedKanban - missingKanban) / plannedKanban) * 1000) / 10,
                ),
              )
            : 0,
        completed: validPlan && plannedKanban > 0 && missingKanban === 0,
        latestPullingAt,
        ...window,
        status: preparationStatus(
          validPlan ? plannedKanban : 0,
          plannedKanban - missingKanban,
          window.deadlineAt,
          docs.some((d) => d.pickedKanban > 0 && !d.latestPullingAt) ? null : latestPullingAt,
          now,
        ),
        scheduleIssue:
          !schedule && candidates.length > 1
            ? 'Lebih dari satu gate cocok; atur jadwal tanpa gate sebagai acuan PPIC.'
            : !window.deadlineAt
              ? 'Jadwal preparation belum diatur PPIC.'
              : null,
      };
    })
    .sort(
      (a, b) =>
        a.deliveryDate.localeCompare(b.deliveryDate) ||
        a.customerName.localeCompare(b.customerName) ||
        a.cycle - b.cycle,
    );
}
