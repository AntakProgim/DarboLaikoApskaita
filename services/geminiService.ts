import { GoogleGenAI, Type } from "@google/genai";
import { DaySchedule, JobRole, DaySlot, ExternalWorkplace, WeekdayLessons } from "../types";
import { 
  timeToMinutes, 
  minutesToTime, 
  roundToNearest5, 
  STANDARD_LESSON_BELLS, 
  sortSlots, 
  calculateSlotMinutes,
  calculateDailyTargets,
  PEDAGOGICAL_DAILY_LIMIT_MINUTES 
} from "../utils/timeHelper";

const getAiClient = () => {
  const apiKey = (import.meta as any).env?.VITE_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

export const formatTimeStr = (time: string): string => {
  if (!time) return "08:00";
  const parts = time.trim().split(':');
  if (parts.length !== 2) return time;
  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  return `${h}:${m}`;
};

export const generateSmartSchedule = async (
  roles: JobRole[],
  totalWeeklyMinutes: number,
  startTime: string = "08:00",
  lunchDuration: number = 30,
  lunchStartTime: string = "12:00",
  lunchEndTime: string = "12:30",
  hasLunch: boolean = true,
  isTeacher: boolean = false,
  otherWorkplaces: ExternalWorkplace[] = [],
  weeklyLessons?: WeekdayLessons,
  shortFriday: boolean = true
): Promise<DaySchedule[]> => {
  const ai = getAiClient();
  const targetHours = totalWeeklyMinutes / 60;

  // Prioritize primary role (first role with highest workload)
  const rolesDescription = roles
    .map((r, i) => `${i === 0 ? '[PAGRINDINĖS PAREIGOS] ' : '[PAPILDOMOS PAREIGOS] '}${r.title} (ID: ${r.id}, Trukmė: ${r.hours}h ${r.minutes}m)`)
    .join(', ');

  const hasSpecificLessons = weeklyLessons && Object.values(weeklyLessons).some(arr => arr && arr.length > 0);
    
  if (!ai || hasSpecificLessons) {
    // If specific weekly lessons were configured or AI is unavailable, use the deterministic rule engine
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration, lunchStartTime, lunchEndTime, hasLunch, isTeacher, weeklyLessons, shortFriday);
  }

  try {
    const lunchRule = hasLunch && lunchDuration > 0
      ? `3. When daily work is more than 4 hours, schedule a lunch 'break' slot strictly from ${lunchStartTime} to ${lunchEndTime} (or ${lunchDuration} minutes). Lunch break is NOT counted towards working hours.`
      : `3. Do NOT include any lunch or break slots.`;

    const teacherRule = isTeacher
      ? `8. TEACHER / SPECIALIST WORK RULES:
      - The first role is the primary duty with the highest workload.
      - First, schedule contact lesson periods during standard school hours (e.g. 08:00-08:45, 08:55-09:40, 09:50-10:35, 10:55-11:40, 12:00-12:45, 12:55-13:40). Set workCategory to 'lesson' and assign appropriate lesson numbers.
      - Next, allocate flexible non-contact hours (pasiruošimas, metodinė veikla) strictly outside lesson hours (e.g. after lessons). Set workCategory to 'flexible'.
      - Then arrange other secondary duties (if any) around lesson times.
      - Daily pedagogical work must NEVER exceed 10 hours 18 minutes (618 minutes), and total daily work must never exceed 12 hours.`
      : ``;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a weekly work schedule (Monday to Friday) based on these roles: [${rolesDescription}].
      
      Total target working hours: ${targetHours.toFixed(2)}.
      
      Rules:
      1. Return a list of 5 days (Monday - Friday).
      2. Start the work day at ${startTime} (unless logic dictates otherwise).
      ${lunchRule}
      4. WORK HOUR DISTRIBUTION:
         - When total workload is 40 hours: distribute across all days as 8h 15m (495 min) on Monday-Thursday, and 1 hour shorter on Friday at 7h 00m (420 min). Total = 40h.
         - When total workload is 36 hours (7,12h/day): distribute across all days as 7h 27m (447 min) on Monday-Thursday, and 1 hour shorter on Friday at 6h 12m (372 min). Total = 36h.
         ${shortFriday ? '- On Fridays, finish work 1 hour earlier (1 hour shorter working day).' : '- Distribute working hours equally across Monday-Friday.'}
      5. Distribute the roles strictly according to their assigned duration.
      6. Do NOT count break time towards the total working hours.
      7. By default, work slots are NOT remote (isRemote: false).
      8. Use the exact 'roleId' provided in the description for each slot.
      ${teacherRule}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              dayName: { type: Type.STRING },
              slots: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["work", "break", "external"] },
                    roleId: { type: Type.STRING },
                    roleName: { type: Type.STRING },
                    isRemote: { type: Type.BOOLEAN },
                    workCategory: { type: Type.STRING, enum: ["lesson", "flexible", "general"] },
                    lessonNumber: { type: Type.INTEGER }
                  },
                  required: ["startTime", "endTime", "type", "roleId", "roleName"]
                }
              }
            },
            required: ["dayName", "slots"]
          }
        }
      }
    });

    const rawData = JSON.parse(response.text || "[]");
    const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
    
    return rawData.map((item: any, index: number) => {
      const slots: DaySlot[] = (item.slots || []).map((s: any, sIdx: number) => {
        let matchedRole = roles.find(r => r.id === s.roleId);
        if (!matchedRole && s.roleName) {
            matchedRole = roles.find(r => r.title.toLowerCase().trim() === s.roleName.toLowerCase().trim() ||
                                          s.roleName.toLowerCase().includes(r.title.toLowerCase().trim()) ||
                                          r.title.toLowerCase().includes(s.roleName.toLowerCase().trim()));
        }
        if (!matchedRole) matchedRole = roles[0];
        
        return {
          id: `slot-${index}-${sIdx}`,
          startTime: roundToNearest5(s.startTime),
          endTime: roundToNearest5(s.endTime),
          type: s.type === 'break' ? 'break' : s.type === 'external' ? 'external' : 'work',
          roleId: matchedRole ? matchedRole.id : "",
          isRemote: !!s.isRemote,
          workCategory: s.workCategory || (isTeacher ? 'lesson' : 'general'),
          lessonNumber: s.lessonNumber
        };
      });

      return {
        id: `day-${index}`,
        dayName: days[index] || item.dayName,
        dateOffset: index,
        slots: slots
      };
    });

  } catch (error) {
    console.error("Gemini generation failed, using fallback rule engine:", error);
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration, lunchStartTime, lunchEndTime, hasLunch, isTeacher, weeklyLessons, shortFriday);
  }
};

const generateSimpleSchedule = (
    roles: JobRole[], 
    totalWeeklyMinutes: number, 
    startTime: string,
    lunchDuration: number,
    lunchStartTime: string = "12:00",
    lunchEndTime: string = "12:30",
    hasLunch: boolean = true,
    isTeacher: boolean = false,
    weeklyLessons?: WeekdayLessons,
    shortFriday: boolean = true
): DaySchedule[] => {
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const startMin = timeToMinutes(startTime);
  const targetLunchStartMin = timeToMinutes(lunchStartTime);
  let targetLunchEndMin = timeToMinutes(lunchEndTime);
  if (targetLunchEndMin <= targetLunchStartMin) {
    targetLunchEndMin = targetLunchStartMin + (lunchDuration || 30);
  }
  const effectiveLunchDuration = targetLunchEndMin - targetLunchStartMin;

  // Calculate day-specific targets (e.g. 8h 15m Mon-Thu, 7h 00m Fri for 40h; 7h 27m Mon-Thu, 6h 12m Fri for 36h)
  const dailyTargets = calculateDailyTargets(totalWeeklyMinutes, shortFriday);

  // Sort roles descending so the primary role with highest workload is processed first
  const sortedRoles = [...roles].sort((a, b) => {
    const minA = a.hours * 60 + a.minutes;
    const minB = b.hours * 60 + b.minutes;
    return minB - minA;
  });

  const primaryRole = sortedRoles[0];
  const primaryRoleId = primaryRole ? primaryRole.id : '1';
  const primaryRoleTotalMin = primaryRole ? (primaryRole.hours * 60 + primaryRole.minutes) : totalWeeklyMinutes;

  // If teacher or assistance specialist mode
  if (isTeacher) {
    const hasCustomLessons = weeklyLessons && Object.values(weeklyLessons).some(l => l && l.length > 0);
    
    // Calculate total contact lesson minutes across the week (1 pamoka = 60 min. darbo laiko normos)
    let totalScheduledLessonMinutes = 0;
    const dayLessonMap: Record<number, number[]> = {};

    days.forEach((_, dayIndex) => {
      let dayLessonNumbers: number[] = [];
      if (hasCustomLessons && weeklyLessons) {
        dayLessonNumbers = weeklyLessons[dayIndex] || [];
      } else {
        // Default 4 lessons Mon-Thu, 3 lessons Fri
        dayLessonNumbers = dayIndex === 4 ? [1, 2, 3] : [1, 2, 3, 4];
      }
      dayLessonMap[dayIndex] = [...dayLessonNumbers].sort((a, b) => a - b);
      totalScheduledLessonMinutes += dayLessonNumbers.length * 60;
    });

    // Flexible / non-contact minutes for primary role
    const totalAvailableFlexMin = Math.max(0, primaryRoleTotalMin - totalScheduledLessonMinutes);

    // Calculate secondary roles minutes scheduled per day
    const secRolesPerDay: Record<number, { customSlots: DaySlot[]; customMin: number; autoMin: number }> = {};
    days.forEach((_, dayIndex) => {
      secRolesPerDay[dayIndex] = { customSlots: [], customMin: 0, autoMin: 0 };
    });

    sortedRoles.slice(1).forEach(secRole => {
      const pref = secRole.schedulePreference;
      const secRoleTotalMin = (secRole.hours * 60) + secRole.minutes;

      if (pref?.mode === 'custom_times' && pref.days && pref.startTime && pref.endTime) {
        const slotMin = calculateSlotMinutes(pref.startTime, pref.endTime);
        pref.days.forEach(d => {
          if (secRolesPerDay[d]) {
            secRolesPerDay[d].customSlots.push({
              id: `slot-${d}-sec-${secRole.id}`,
              startTime: pref.startTime!,
              endTime: pref.endTime!,
              type: 'work',
              roleId: secRole.id,
              isRemote: false,
              workCategory: 'general'
            });
            secRolesPerDay[d].customMin += slotMin;
          }
        });
      } else if (!pref || pref.mode === 'auto_after_lessons') {
        const dailyMin = Math.round(secRoleTotalMin / 5);
        days.forEach((_, d) => {
          if (secRolesPerDay[d]) {
            secRolesPerDay[d].autoMin += dailyMin;
          }
        });
      }
    });

    // Desired flexible minutes per day to reach dailyTargets[dayIndex]
    const desiredFlexPerDay: number[] = days.map((_, dayIndex) => {
      const dayTarget = dailyTargets[dayIndex];
      const lessonsAccounted = (dayLessonMap[dayIndex] || []).length * 60;
      const secTotal = secRolesPerDay[dayIndex].customMin + secRolesPerDay[dayIndex].autoMin;
      return Math.max(0, dayTarget - lessonsAccounted - secTotal);
    });

    const sumDesiredFlex = desiredFlexPerDay.reduce((a, b) => a + b, 0);

    // Allocate flexible minutes to each day to fill target
    const allocatedFlexPerDay: number[] = [0, 0, 0, 0, 0];
    let allocatedTotal = 0;

    if (sumDesiredFlex > 0 && totalAvailableFlexMin > 0) {
      for (let d = 0; d < 5; d++) {
        if (d === 4) {
          allocatedFlexPerDay[d] = Math.max(0, totalAvailableFlexMin - allocatedTotal);
        } else {
          const ratio = desiredFlexPerDay[d] / sumDesiredFlex;
          const share = Math.round(ratio * totalAvailableFlexMin);
          const allotted = Math.min(totalAvailableFlexMin - allocatedTotal, share);
          allocatedFlexPerDay[d] = allotted;
          allocatedTotal += allotted;
        }
      }
    } else if (totalAvailableFlexMin > 0) {
      const perDay = Math.floor(totalAvailableFlexMin / 5);
      for (let d = 0; d < 5; d++) {
        allocatedFlexPerDay[d] = d === 4 ? (totalAvailableFlexMin - perDay * 4) : perDay;
      }
    }

    // Build the 5-day schedule
    return days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      const dayLessonNumbers = dayLessonMap[dayIndex] || [];

      // 1. Contact lessons (bell is 45 min, but counts as 1 hour in work accounting)
      dayLessonNumbers.forEach(num => {
        const bell = STANDARD_LESSON_BELLS.find(b => b.number === num);
        if (bell) {
          slots.push({
            id: `slot-${dayIndex}-lesson-${num}`,
            startTime: bell.startTime,
            endTime: bell.endTime,
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'lesson',
            lessonNumber: num
          });
        }
      });

      // 2. Lunch break if configured
      if (hasLunch && lunchDuration > 0 && dayLessonNumbers.length >= 4) {
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: lunchStartTime,
          endTime: lunchEndTime,
          type: 'break',
          roleId: '',
          isRemote: false
        });
      }

      // Next available start time
      let nextAvailableStart = "14:00";
      const workSlots = slots.filter(s => s.type === 'work');
      if (workSlots.length > 0) {
        const lastWork = workSlots[workSlots.length - 1];
        nextAvailableStart = lastWork.endTime;
      }

      if (hasLunch && lunchDuration > 0) {
        const lunchEndM = timeToMinutes(lunchEndTime);
        if (timeToMinutes(nextAvailableStart) < lunchEndM && timeToMinutes(nextAvailableStart) >= timeToMinutes(lunchStartTime)) {
          nextAvailableStart = lunchEndTime;
        }
      }

      // 3. Flexible hours for primary role
      const flexMin = allocatedFlexPerDay[dayIndex];
      if (flexMin > 0) {
        const flexStartMin = Math.max(timeToMinutes(nextAvailableStart) + 10, timeToMinutes(startTime));
        const flexEndMin = flexStartMin + flexMin;

        slots.push({
          id: `slot-${dayIndex}-flex`,
          startTime: minutesToTime(flexStartMin),
          endTime: minutesToTime(flexEndMin),
          type: 'work',
          roleId: primaryRoleId,
          isRemote: false,
          workCategory: 'flexible'
        });

        nextAvailableStart = minutesToTime(flexEndMin);
      }

      // 4. Secondary duties
      // Custom times slots
      secRolesPerDay[dayIndex].customSlots.forEach(s => slots.push(s));

      // Auto after lessons slots
      sortedRoles.slice(1).forEach(secRole => {
        const pref = secRole.schedulePreference;
        if (!pref || pref.mode === 'auto_after_lessons') {
          const secRoleTotalMin = (secRole.hours * 60) + secRole.minutes;
          const dailyMin = Math.round(secRoleTotalMin / 5);
          if (dailyMin > 0) {
            const secStartMin = Math.max(timeToMinutes(nextAvailableStart) + 10, 14 * 60 + 40);
            const secEndMin = secStartMin + dailyMin;
            slots.push({
              id: `slot-${dayIndex}-sec-${secRole.id}`,
              startTime: minutesToTime(secStartMin),
              endTime: minutesToTime(secEndMin),
              type: 'work',
              roleId: secRole.id,
              isRemote: false,
              workCategory: 'general'
            });
            nextAvailableStart = minutesToTime(secEndMin);
          }
        }
      });

      return {
        id: `day-${dayIndex}`,
        dayName: day,
        dateOffset: dayIndex,
        slots: sortSlots(slots)
      };
    });
  }

  // Standard non-teacher schedule generator
  let roleQueue = sortedRoles.map(r => ({
      id: r.id,
      remaining: (r.hours * 60) + r.minutes
  }));

  return days.map((day, dayIndex) => {
    const slots: DaySlot[] = [];
    let currentClock = startMin;
    let dayWorkMinutes = 0;
    let hasBreak = false;
    const dayTarget = dailyTargets[dayIndex];
    const shouldHaveLunch = hasLunch && lunchDuration > 0 && dayTarget >= 180;

    while (dayWorkMinutes < dayTarget) {
      if (shouldHaveLunch && !hasBreak && currentClock >= targetLunchStartMin) {
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(currentClock),
          endTime: minutesToTime(currentClock + effectiveLunchDuration),
          type: 'break',
          roleId: '',
          isRemote: false
        });
        currentClock += effectiveLunchDuration;
        hasBreak = true;
      }

      const activeRoleIndex = roleQueue.findIndex(r => r.remaining > 0);
      if (activeRoleIndex === -1) break;

      const activeRole = roleQueue[activeRoleIndex];
      const remainingForDay = dayTarget - dayWorkMinutes;
      
      let maxChunkSize = remainingForDay;

      if (shouldHaveLunch && !hasBreak && currentClock < targetLunchStartMin) {
        const minutesUntilLunch = targetLunchStartMin - currentClock;
        if (minutesUntilLunch > 0 && maxChunkSize > minutesUntilLunch) {
          maxChunkSize = minutesUntilLunch;
        }
      }

      const duration = Math.min(maxChunkSize, activeRole.remaining);

      if (duration > 0) {
        slots.push({
          id: `slot-${dayIndex}-${slots.length}`,
          startTime: minutesToTime(currentClock),
          endTime: minutesToTime(currentClock + duration),
          type: 'work',
          roleId: activeRole.id,
          isRemote: false,
          workCategory: 'general'
        });

        currentClock += duration;
        dayWorkMinutes += duration;
        activeRole.remaining -= duration;
      } else {
        break;
      }

      if (shouldHaveLunch && !hasBreak && currentClock >= targetLunchStartMin) {
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(currentClock),
          endTime: minutesToTime(currentClock + effectiveLunchDuration),
          type: 'break',
          roleId: '',
          isRemote: false
        });
        currentClock += effectiveLunchDuration;
        hasBreak = true;
      }
    }

    return {
      id: `day-${dayIndex}`,
      dayName: day,
      dateOffset: dayIndex,
      slots: sortSlots(slots)
    };
  });
};

