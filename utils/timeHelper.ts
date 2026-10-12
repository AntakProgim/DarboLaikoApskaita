import { DaySlot, JobRole } from '../types';

export const PEDAGOGICAL_DAILY_LIMIT_MINUTES = 10 * 60 + 18; // 618 minutes (10 val. 18 min.)
export const TOTAL_DAILY_LIMIT_MINUTES = 12 * 60; // 720 minutes (12 val.)

export const STANDARD_LESSON_BELLS = [
  { number: 1, startTime: '08:00', endTime: '08:45', title: '1 pamoka (08:00 - 08:45)' },
  { number: 2, startTime: '08:55', endTime: '09:40', title: '2 pamoka (08:55 - 09:40)' },
  { number: 3, startTime: '09:50', endTime: '10:35', title: '3 pamoka (09:50 - 10:35)' },
  { number: 4, startTime: '10:55', endTime: '11:40', title: '4 pamoka (10:55 - 11:40)' },
  { number: 5, startTime: '12:00', endTime: '12:45', title: '5 pamoka (12:00 - 12:45)' },
  { number: 6, startTime: '12:55', endTime: '13:40', title: '6 pamoka (12:55 - 13:40)' },
  { number: 7, startTime: '13:50', endTime: '14:35', title: '7 pamoka (13:50 - 14:35)' },
  { number: 8, startTime: '14:45', endTime: '15:30', title: '8 pamoka (14:45 - 15:30)' }
];

export const roundToNearest5 = (time: string): string => {
  if (!time) return "08:00";
  const parts = time.split(':');
  if (parts.length < 2) return "08:00";
  
  let h = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  
  if (isNaN(h)) h = 8;
  if (isNaN(m)) m = 0;
  
  m = Math.round(m / 5) * 5;
  
  if (m === 60) {
    m = 0;
    h += 1;
  }
  
  if (h >= 24) h = h % 24;
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const timeToMinutes = (time: string): number => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h * 60) + m;
};

export const minutesToTime = (minutes: number): string => {
  let m = minutes;
  while (m < 0) m += 1440;
  while (m >= 1440) m -= 1440;
  
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
};

export const calculateSlotMinutes = (start: string, end: string): number => {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  
  if (startMin === endMin) return 0;
  
  let diff = endMin - startMin;
  if (diff < 0) {
    diff += 1440;
  }
  
  return diff;
};

/**
 * Calculates the accounted working minutes for a slot.
 * Pagal Lietuvos pedagoginio darbo tvarką:
 * Mokytojui pamokos laikas skaičiuojamas valandomis (1 pamoka = 60 min. darbo laiko normos),
 * nors pati pamoka klasėje trunka 45 min.
 */
export const getSlotAccountedMinutes = (slot: DaySlot): number => {
  if (slot.type === 'break') return 0;
  if (slot.workCategory === 'lesson') {
    return 60; // 1 pamoka = 1 val. (60 min.) darbo laiko normos
  }
  return calculateSlotMinutes(slot.startTime, slot.endTime);
};

/**
 * Calculates net worked minutes for a day.
 * Break time (lunch) is NOT counted as worked time.
 * Lesson time counts as 60 min (1 hour) per lesson.
 */
export const calculateDayNetMinutes = (slots: DaySlot[]): number => {
  return slots.reduce((total, slot) => {
    if (slot.type === 'break') return total;
    return total + getSlotAccountedMinutes(slot);
  }, 0);
};

export const calculateDayRemoteMinutes = (slots: DaySlot[]): number => {
  return slots.reduce((total, slot) => {
    if (slot.type === 'work' && slot.isRemote) {
      return total + getSlotAccountedMinutes(slot);
    }
    return total;
  }, 0);
};

export const getRoleBreakdown = (slots: DaySlot[]) => {
  const stats: Record<string, number> = {};
  
  slots.forEach(slot => {
    if (slot.type === 'work' && slot.roleId) {
      const duration = getSlotAccountedMinutes(slot);
      stats[slot.roleId] = (stats[slot.roleId] || 0) + duration;
    }
  });
  
  return stats;
};

/**
 * Detailed breakdown of day's work hours:
 * - Pedagogical work (limit: 10 val. 18 min. = 618 min.)
 * - External workplace work
 * - Total work across all employers (limit: 12 val. = 720 min.)
 * - Lunch break duration (excluded from work limits)
 */
export const getDayWorkDetails = (slots: DaySlot[], roles: JobRole[] = []) => {
  let pedagogicalMinutes = 0;
  let internalOtherMinutes = 0;
  let externalMinutes = 0;
  let breakMinutes = 0;
  let lessonMinutes = 0;
  let flexibleMinutes = 0;

  slots.forEach(slot => {
    if (slot.type === 'break') {
      breakMinutes += calculateSlotMinutes(slot.startTime, slot.endTime);
    } else if (slot.type === 'external' || slot.isExternal) {
      externalMinutes += calculateSlotMinutes(slot.startTime, slot.endTime);
    } else if (slot.type === 'work') {
      const dur = getSlotAccountedMinutes(slot);
      if (slot.workCategory === 'lesson') {
        lessonMinutes += dur; // 1 pamoka = 60 min
      } else if (slot.workCategory === 'flexible') {
        flexibleMinutes += dur;
      }
      
      const role = roles.find(r => r.id === slot.roleId);
      // If role specified as non-pedagogical, separate it
      const isPed = role ? (role.isPedagogical !== false) : true;
      if (isPed) {
        pedagogicalMinutes += dur;
      } else {
        internalOtherMinutes += dur;
      }
    }
  });

  const internalTotal = pedagogicalMinutes + internalOtherMinutes;
  const grandTotal = internalTotal + externalMinutes;

  return {
    pedagogicalMinutes,
    internalOtherMinutes,
    internalTotal,
    externalMinutes,
    grandTotal,
    breakMinutes,
    lessonMinutes,
    flexibleMinutes,
    isPedagogicalOverLimit: pedagogicalMinutes > PEDAGOGICAL_DAILY_LIMIT_MINUTES,
    isTotalOverLimit: grandTotal > TOTAL_DAILY_LIMIT_MINUTES,
    remainingPedagogical: Math.max(0, PEDAGOGICAL_DAILY_LIMIT_MINUTES - pedagogicalMinutes),
    remainingTotal: Math.max(0, TOTAL_DAILY_LIMIT_MINUTES - grandTotal)
  };
};

export const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} val. ${m} min.`;
  if (h > 0) return `${h} val.`;
  return `${m} min.`;
};

export const sortSlots = (slots: DaySlot[]): DaySlot[] => {
  return [...slots].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
};

/**
 * Shifts all slots in a day by a given delta in minutes.
 * Preserves the duration of every slot.
 */
export const shiftAllDaySlots = (slots: DaySlot[], deltaMinutes: number): DaySlot[] => {
  if (deltaMinutes === 0 || slots.length === 0) return slots;
  return slots.map(slot => ({
    ...slot,
    startTime: minutesToTime(timeToMinutes(slot.startTime) + deltaMinutes),
    endTime: minutesToTime(timeToMinutes(slot.endTime) + deltaMinutes)
  }));
};

/**
 * Smartly shifts slot times when a user changes start or end time:
 * - Changing day start (first slot startTime): shifts all slots on that day by delta.
 * - Changing break startTime: moves break (preserving duration), connects preceding slot if adjacent,
 *   and shifts all subsequent slots by delta.
 * - Changing break endTime: adjusts break duration and shifts all subsequent slots by delta.
 * - Changing any slot endTime: shifts all subsequent slots by delta to maintain continuity and durations.
 */
export const smartShiftOnSlotTimeChange = (
  slots: DaySlot[],
  changedSlotId: string,
  field: 'startTime' | 'endTime',
  newValue: string
): DaySlot[] => {
  const index = slots.findIndex(s => s.id === changedSlotId);
  if (index === -1) return slots;

  const targetSlot = slots[index];
  const oldStartMin = timeToMinutes(targetSlot.startTime);
  const oldEndMin = timeToMinutes(targetSlot.endTime);
  const newMin = timeToMinutes(newValue);

  if (field === 'startTime') {
    const delta = newMin - oldStartMin;
    if (delta === 0) return slots;

    // If changing the first slot's start time (start of the workday)
    if (index === 0) {
      return shiftAllDaySlots(slots, delta);
    }

    // If changing a break/lunch slot's start time
    if (targetSlot.type === 'break') {
      const breakDur = calculateSlotMinutes(targetSlot.startTime, targetSlot.endTime);
      const updated = [...slots];
      
      // Connect previous slot if it was touching the break
      if (index > 0 && slots[index - 1].endTime === targetSlot.startTime) {
        updated[index - 1] = {
          ...updated[index - 1],
          endTime: newValue
        };
      }

      // Update break slot preserving duration
      updated[index] = {
        ...targetSlot,
        startTime: newValue,
        endTime: minutesToTime(newMin + breakDur)
      };

      // Shift subsequent slots by delta
      for (let j = index + 1; j < updated.length; j++) {
        const cur = updated[j];
        updated[j] = {
          ...cur,
          startTime: minutesToTime(timeToMinutes(cur.startTime) + delta),
          endTime: minutesToTime(timeToMinutes(cur.endTime) + delta)
        };
      }
      return updated;
    }

    // Changing startTime of an internal slot
    const dur = calculateSlotMinutes(targetSlot.startTime, targetSlot.endTime);
    const updated = [...slots];
    updated[index] = {
      ...targetSlot,
      startTime: newValue,
      endTime: minutesToTime(newMin + dur)
    };
    for (let j = index + 1; j < updated.length; j++) {
      const cur = updated[j];
      updated[j] = {
        ...cur,
        startTime: minutesToTime(timeToMinutes(cur.startTime) + delta),
        endTime: minutesToTime(timeToMinutes(cur.endTime) + delta)
      };
    }
    return updated;
  }

  // field === 'endTime'
  const delta = newMin - oldEndMin;
  if (delta === 0) return slots;

  const updated = [...slots];
  updated[index] = {
    ...targetSlot,
    endTime: newValue
  };

  // Shift subsequent slots by delta
  for (let j = index + 1; j < updated.length; j++) {
    const cur = updated[j];
    updated[j] = {
      ...cur,
      startTime: minutesToTime(timeToMinutes(cur.startTime) + delta),
      endTime: minutesToTime(timeToMinutes(cur.endTime) + delta)
    };
  }

  return updated;
};

/**
 * Updates or sets the lunch break times for a day and shifts subsequent slots accordingly.
 */
export const updateDayLunchTimes = (
  slots: DaySlot[],
  newLunchStart: string,
  newLunchEnd: string
): DaySlot[] => {
  const breakIndex = slots.findIndex(s => s.type === 'break');
  
  if (breakIndex !== -1) {
    const oldBreak = slots[breakIndex];
    const oldEndMin = timeToMinutes(oldBreak.endTime);
    const newEndMin = timeToMinutes(newLunchEnd);
    const deltaAfter = newEndMin - oldEndMin;

    const updated = [...slots];

    // If slot before break ended at old break start, connect to new lunch start
    if (breakIndex > 0 && slots[breakIndex - 1].endTime === oldBreak.startTime) {
      updated[breakIndex - 1] = {
        ...updated[breakIndex - 1],
        endTime: newLunchStart
      };
    }

    updated[breakIndex] = {
      ...oldBreak,
      startTime: newLunchStart,
      endTime: newLunchEnd
    };

    // Shift afternoon slots by deltaAfter
    if (deltaAfter !== 0) {
      for (let j = breakIndex + 1; j < updated.length; j++) {
        const cur = updated[j];
        updated[j] = {
          ...cur,
          startTime: minutesToTime(timeToMinutes(cur.startTime) + deltaAfter),
          endTime: minutesToTime(timeToMinutes(cur.endTime) + deltaAfter)
        };
      }
    }

    return updated;
  }

  // If no break existed, insert one
  const newBreak: DaySlot = {
    id: `break-${Date.now()}`,
    startTime: newLunchStart,
    endTime: newLunchEnd,
    type: 'break',
    roleId: '',
    isRemote: false
  };

  const lunchStartMin = timeToMinutes(newLunchStart);
  const lunchDur = calculateSlotMinutes(newLunchStart, newLunchEnd);

  // Split or adjust existing slots
  const newSlots: DaySlot[] = [];
  slots.forEach(slot => {
    const slotStartMin = timeToMinutes(slot.startTime);
    const slotEndMin = timeToMinutes(slot.endTime);

    if (slotEndMin <= lunchStartMin) {
      newSlots.push(slot);
    } else if (slotStartMin >= lunchStartMin) {
      // Shift after lunch
      newSlots.push({
        ...slot,
        startTime: minutesToTime(slotStartMin + lunchDur),
        endTime: minutesToTime(slotEndMin + lunchDur)
      });
    } else {
      // Spans lunch -> split into morning and afternoon
      newSlots.push({
        ...slot,
        endTime: newLunchStart
      });
      newSlots.push({
        ...slot,
        id: `slot-split-${Date.now()}`,
        startTime: newLunchEnd,
        endTime: minutesToTime(slotEndMin + lunchDur)
      });
    }
  });

  newSlots.push(newBreak);
  return sortSlots(newSlots);
};

/**
 * Places flexible hours neatly outside lesson hours (e.g. after the last lesson).
 */
export const placeFlexibleHoursAfterLessons = (
  slots: DaySlot[],
  minutesToAdd: number,
  roleId: string,
  isRemote: boolean = false
): DaySlot[] => {
  if (minutesToAdd <= 0) return slots;
  
  const sorted = sortSlots(slots);
  let startTime = "14:40";

  // If there are existing slots, find the latest end time
  if (sorted.length > 0) {
    const lastSlot = sorted[sorted.length - 1];
    startTime = lastSlot.endTime;
  }

  const startMin = timeToMinutes(startTime);
  const endTime = minutesToTime(startMin + minutesToAdd);

  const newSlot: DaySlot = {
    id: `flex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    startTime,
    endTime,
    type: 'work',
    roleId,
    isRemote,
    workCategory: 'flexible'
  };

  return sortSlots([...slots, newSlot]);
};