import { DaySlot, JobRole } from '../types';

export const PEDAGOGICAL_DAILY_LIMIT_MINUTES = 10 * 60 + 18; // 618 minutes (10 val. 18 min.)
export const TOTAL_DAILY_LIMIT_MINUTES = 12 * 60; // 720 minutes (12 val.)

export const STANDARD_LESSON_BELLS = [
  { number: 1, startTime: '08:30', endTime: '09:15', title: '1 pamoka (08:30 - 09:15)' },
  { number: 2, startTime: '09:25', endTime: '10:10', title: '2 pamoka (09:25 - 10:10)' },
  { number: 3, startTime: '10:20', endTime: '11:05', title: '3 pamoka (10:20 - 11:05)' },
  { number: 4, startTime: '11:25', endTime: '12:10', title: '4 pamoka (11:25 - 12:10)' },
  { number: 5, startTime: '12:30', endTime: '13:15', title: '5 pamoka (12:30 - 13:15)' },
  { number: 6, startTime: '13:30', endTime: '14:15', title: '6 pamoka (13:30 - 14:15)' },
  { number: 7, startTime: '14:25', endTime: '15:10', title: '7 pamoka (14:25 - 15:10)' },
  { number: 8, startTime: '15:20', endTime: '16:05', title: '8 pamoka (15:20 - 16:05)' },
  { number: 9, startTime: '16:15', endTime: '17:00', title: '9 pamoka (16:15 - 17:00)' }
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
 * Checks if a slot represents a school lesson (by category, lesson number, or matching bells).
 */
export const isSlotLessonTime = (slot: DaySlot): boolean => {
  if (slot.type !== 'work') return false;
  if (slot.workCategory === 'lesson') return true;
  if (slot.lessonNumber !== undefined && slot.lessonNumber > 0) return true;
  if (STANDARD_LESSON_BELLS.some(b => b.startTime === slot.startTime && b.endTime === slot.endTime)) return true;
  return false;
};

/**
 * Finds the teacher/educator role from config roles.
 * Prioritizes roles whose title explicitly contains "mokyt", "pamok", "pedagog" (e.g. "Mokytojas"),
 * and strictly prevents administrative roles like "Direktorius" from being chosen as the teaching role.
 */
export const getSlotTeacherRole = (roles: JobRole[]): JobRole | undefined => {
  if (!roles || roles.length === 0) return undefined;

  // 1. Search for role whose title explicitly mentions teacher/pedagogical terms:
  // "mokyt" (Mokytojas, Mokytoja), "pamok", "pedagog", "auklėtoj", "ugd", "dėst"
  const byTitle = roles.find(r => {
    const t = (r.title || '').toLowerCase().trim();
    return t.includes('mokyt') || t.includes('pamok') || t.includes('pedagog') || t.includes('auklėtoj') || t.includes('ugd') || t.includes('dėst');
  });
  if (byTitle) return byTitle;

  // 2. Next, check roleCategory === 'teacher' or isPedagogical, BUT strictly exclude administrative titles (direktorius, vadovas, pavaduotojas, administratorius)
  const byCat = roles.find(r => {
    const t = (r.title || '').toLowerCase().trim();
    const isAdmin = t.includes('direkt') || t.includes('vadov') || t.includes('administr') || t.includes('vedėj');
    return (r.roleCategory === 'teacher' || r.isPedagogical) && !isAdmin;
  });
  if (byCat) return byCat;

  // 3. Any role that is not a director/manager/admin
  const nonAdmin = roles.find(r => {
    const t = (r.title || '').toLowerCase().trim();
    return !t.includes('direkt') && !t.includes('vadov') && !t.includes('administr') && !t.includes('vedėj');
  });
  if (nonAdmin) return nonAdmin;

  return roles[0];
};

/**
 * Resolves the role that a slot belongs to.
 * When a slot is lesson time, it automatically represents teacher work (Mokytojas).
 */
export const getSlotRole = (slot: DaySlot, roles: JobRole[] = []): JobRole | undefined => {
  if (!roles || roles.length === 0) return undefined;
  if (slot.workCategory === 'lesson' || isSlotLessonTime(slot)) {
    return getSlotTeacherRole(roles);
  }
  return roles.find(r => r.id === slot.roleId) || roles[0];
};

/**
 * Calculates the accounted working minutes for a slot.
 * Pagal Lietuvos pedagoginio darbo tvarką:
 * Mokytojui pedagoginio darbo laiko skaičiavime viena pamoka (net jei ji trunka 45 min.)
 * automatiškai įskaitoma kaip 60 min. (1 val.) darbo krūvio.
 */
export const getSlotAccountedMinutes = (slot: DaySlot): number => {
  if (slot.type === 'break') return 0;
  if (slot.workCategory === 'lesson' || isSlotLessonTime(slot)) {
    return 60; // 1 pamoka (nors trunka 45 min.) = 60 min. (1 val.) pedagoginio darbo krūvio
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

export const getRoleBreakdown = (slots: DaySlot[], roles: JobRole[] = []): Record<string, number> => {
  const stats: Record<string, number> = {};
  
  slots.forEach(slot => {
    if (slot.type === 'work') {
      const assignedRole = getSlotRole(slot, roles);
      const roleId = assignedRole ? assignedRole.id : slot.roleId;
      if (roleId) {
        const duration = getSlotAccountedMinutes(slot);
        stats[roleId] = (stats[roleId] || 0) + duration;
      }
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
  let remoteMinutes = 0;

  slots.forEach(slot => {
    if (slot.type === 'break') {
      breakMinutes += calculateSlotMinutes(slot.startTime, slot.endTime);
    } else if (slot.type === 'external' || slot.isExternal) {
      externalMinutes += calculateSlotMinutes(slot.startTime, slot.endTime);
    } else if (slot.type === 'work') {
      const dur = getSlotAccountedMinutes(slot);
      if (slot.isRemote) {
        remoteMinutes += dur;
      }
      if (slot.workCategory === 'lesson' || isSlotLessonTime(slot)) {
        lessonMinutes += dur; // 1 pamoka = 60 min
      } else if (slot.workCategory === 'flexible') {
        flexibleMinutes += dur;
      }
      
      const role = getSlotRole(slot, roles);
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
    remoteMinutes,
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
  isRemote: boolean = false,
  defaultStartTime: string = "08:00"
): DaySlot[] => {
  if (minutesToAdd <= 0) return slots;
  
  const sorted = sortSlots(slots);
  let startTime = defaultStartTime;

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

/**
 * Calculates target working minutes for Monday through Friday (indexes 0 to 4).
 * If shortFriday is true:
 * - Friday is 1 hour (60 min) shorter.
 * - Monday through Thursday absorb 15 minutes each (4 * 15 = 60 min).
 * Examples:
 * - 40 hours (2400 min): Mon-Thu = 495 min (8 val. 15 min.), Fri = 420 min (7 val. 00 min.). Total = 2400 min.
 * - 36 hours (2160 min, t.y. 7,12 val. per dieną): Mon-Thu = 447 min (7 val. 27 min.), Fri = 372 min (6 val. 12 min.). Total = 2160 min.
 * If shortFriday is false:
 * - Mon-Fri = equal distribution (e.g. 480 min = 8h 00m, or 432 min = 7h 12m).
 */
export const calculateDailyTargets = (
  totalWeeklyMinutes: number,
  shortFriday: boolean = true
): number[] => {
  if (totalWeeklyMinutes <= 0) return [0, 0, 0, 0, 0];

  // Specific canonical cases for exact matching
  if (totalWeeklyMinutes === 2400) { // 40 hours
    if (shortFriday) {
      return [495, 495, 495, 495, 420]; // 8:15 Mon-Thu, 7:00 Fri
    }
    return [480, 480, 480, 480, 480]; // 8:00 Mon-Fri
  }

  if (totalWeeklyMinutes === 2160) { // 36 hours (7,12 val. / 7h 12m per day)
    if (shortFriday) {
      return [447, 447, 447, 447, 372]; // 7:27 Mon-Thu, 6:12 Fri (1 val. trumpiau)
    }
    return [432, 432, 432, 432, 432]; // 7:12 Mon-Fri
  }

  if (!shortFriday || totalWeeklyMinutes < 5 * 60) {
    const base = Math.floor(totalWeeklyMinutes / 5);
    const rem = totalWeeklyMinutes % 5;
    return [0, 1, 2, 3, 4].map(i => base + (i < rem ? 1 : 0));
  }

  // General case with shortFriday: Friday is 60 min shorter, Mon-Thu get +15 min each
  const baseAvg = Math.floor(totalWeeklyMinutes / 5);
  const extraMonThu = 15;
  const monThu = baseAvg + extraMonThu;
  const fri = totalWeeklyMinutes - (monThu * 4);

  if (fri >= 60) {
    return [monThu, monThu, monThu, monThu, fri];
  }

  // Fallback for smaller weekly hours
  const base = Math.floor(totalWeeklyMinutes / 5);
  const rem = totalWeeklyMinutes % 5;
  return [0, 1, 2, 3, 4].map(i => base + (i < rem ? 1 : 0));
};

/**
 * Reconciles schedule so that every role's total accounted minutes
 * exactly match its configured weekly target (hours * 60 + minutes).
 * Trims or expands flexible / non-contact hours so no role is over or under budget.
 */
export const reconcileScheduleWithRoleTargets = (
  schedule: DaySchedule[],
  roles: JobRole[]
): DaySchedule[] => {
  if (!schedule || schedule.length === 0 || !roles || roles.length === 0) return schedule;

  let updatedSchedule: DaySchedule[] = schedule.map(day => ({
    ...day,
    slots: [...day.slots]
  }));

  roles.forEach(role => {
    const targetMin = (role.hours * 60) + role.minutes;
    if (targetMin <= 0) return;

    // Calculate current accounted minutes for this role across all days
    const calculateCurrent = () => {
      let sum = 0;
      updatedSchedule.forEach(day => {
        day.slots.forEach(slot => {
          if (slot.type === 'work' && getSlotRole(slot, roles)?.id === role.id) {
            sum += getSlotAccountedMinutes(slot);
          }
        });
      });
      return sum;
    };

    let actualMin = calculateCurrent();
    let diff = actualMin - targetMin;

    // Case 1: Over budget (e.g. +13 min) -> trim flexible / non-lesson slots for this role
    if (diff > 0) {
      for (let d = updatedSchedule.length - 1; d >= 0 && diff > 0; d--) {
        const day = updatedSchedule[d];
        const newSlots: DaySlot[] = [];

        for (let s = 0; s < day.slots.length; s++) {
          const slot = day.slots[s];
          const isThisRole = slot.type === 'work' && getSlotRole(slot, roles)?.id === role.id;
          const isLesson = slot.workCategory === 'lesson' || isSlotLessonTime(slot);

          // We only trim flexible / non-lesson slots
          if (isThisRole && !isLesson && diff > 0) {
            const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
            const trimAmount = Math.min(dur, diff);

            if (dur - trimAmount <= 0) {
              // Slot completely trimmed away
              diff -= dur;
              continue;
            } else {
              // Trim slot: if slot touches next slot, adjust startTime; otherwise adjust endTime
              const nextSlot = day.slots[s + 1];
              if (nextSlot && slot.endTime === nextSlot.startTime) {
                const newStartMin = timeToMinutes(slot.startTime) + trimAmount;
                newSlots.push({
                  ...slot,
                  startTime: minutesToTime(newStartMin)
                });
              } else {
                const newEndMin = timeToMinutes(slot.endTime) - trimAmount;
                newSlots.push({
                  ...slot,
                  endTime: minutesToTime(newEndMin)
                });
              }
              diff -= trimAmount;
            }
          } else {
            newSlots.push(slot);
          }
        }

        updatedSchedule[d] = {
          ...day,
          slots: sortSlots(newSlots)
        };
      }
    } else if (diff < 0) {
      // Case 2: Under budget -> expand flexible slot or add flexible time
      const needed = Math.abs(diff);
      let targetDayIndex = updatedSchedule.findIndex(d => 
        d.slots.some(s => s.type === 'work' && getSlotRole(s, roles)?.id === role.id)
      );
      if (targetDayIndex === -1) targetDayIndex = 2; // Wednesday default

      const day = updatedSchedule[targetDayIndex];
      const flexSlotIndex = day.slots.findIndex(s => 
        s.type === 'work' && 
        getSlotRole(s, roles)?.id === role.id && 
        s.workCategory !== 'lesson' && 
        !isSlotLessonTime(s)
      );

      if (flexSlotIndex !== -1) {
        const slot = day.slots[flexSlotIndex];
        const newEndMin = timeToMinutes(slot.endTime) + needed;
        const updatedSlots = [...day.slots];
        updatedSlots[flexSlotIndex] = {
          ...slot,
          endTime: minutesToTime(newEndMin)
        };
        updatedSchedule[targetDayIndex] = {
          ...day,
          slots: sortSlots(updatedSlots)
        };
      } else {
        const updatedSlots = placeFlexibleHoursAfterLessons(
          day.slots,
          needed,
          role.id,
          day.isRemote || false,
          "08:00"
        );
        updatedSchedule[targetDayIndex] = {
          ...day,
          slots: updatedSlots
        };
      }
    }
  });

  return updatedSchedule;
};