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
      - First, schedule contact lesson periods during standard school hours (e.g. 08:30-09:15, 09:25-10:10, 10:20-11:05, 11:25-12:10, 12:30-13:15, 13:30-14:15, 14:25-15:10, 15:20-16:05, 16:15-17:00). Set workCategory to 'lesson' and assign appropriate lesson numbers.
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
    startTime: string = "08:00",
    lunchDuration: number = 30,
    lunchStartTime: string = "12:00",
    lunchEndTime: string = "12:30",
    hasLunch: boolean = true,
    isTeacher: boolean = false,
    weeklyLessons?: WeekdayLessons,
    shortFriday: boolean = true
): DaySchedule[] => {
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const startMin = timeToMinutes(startTime || "08:00");
  const targetLunchStartMin = timeToMinutes(lunchStartTime || "12:00");
  let targetLunchEndMin = timeToMinutes(lunchEndTime || "12:30");
  if (targetLunchEndMin <= targetLunchStartMin) {
    targetLunchEndMin = targetLunchStartMin + (lunchDuration || 30);
  }

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

  // 1. TEACHER / EDUCATIONAL SPECIALIST MODE
  if (isTeacher) {
    // Respect explicit weeklyLessons even if cleared (all empty arrays)
    // Only fallback to default 1-4 lessons if weeklyLessons was completely undefined
    const isLessonsExplicitlyProvided = weeklyLessons !== undefined;
    const dayLessonMap: Record<number, number[]> = {};

    days.forEach((_, dayIndex) => {
      if (isLessonsExplicitlyProvided && weeklyLessons) {
        dayLessonMap[dayIndex] = [...(weeklyLessons[dayIndex] || [])].sort((a, b) => a - b);
      } else {
        // Default 1-4 lessons Mon-Thu, 1-3 lessons Fri
        dayLessonMap[dayIndex] = dayIndex === 4 ? [1, 2, 3] : [1, 2, 3, 4];
      }
    });

    // Secondary roles allocation by days
    const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number }[]> = {
      0: [], 1: [], 2: [], 3: [], 4: []
    };

    sortedRoles.slice(1).forEach(secRole => {
      const secTotalMin = (secRole.hours * 60) + secRole.minutes;
      if (secTotalMin <= 0) return;

      const pref = secRole.schedulePreference;
      let targetDays: number[] = [];

      if (pref?.days && pref.days.length > 0) {
        targetDays = pref.days;
      } else if (secTotalMin <= 240) {
        // If small duty and no days chosen, default to Wednesday (day 2)
        targetDays = [2];
      } else {
        targetDays = [0, 1, 2, 3, 4];
      }

      const minPerDay = Math.round(secTotalMin / targetDays.length);
      let allocated = 0;

      targetDays.forEach((d, idx) => {
        if (d >= 0 && d <= 4) {
          const toAdd = idx === targetDays.length - 1 ? (secTotalMin - allocated) : minPerDay;
          allocated += toAdd;
          secRolesPerDay[d].push({
            roleId: secRole.id,
            title: secRole.title,
            minutes: toAdd
          });
        }
      });
    });

    return days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      const dayTarget = dailyTargets[dayIndex];
      const lessonNumbers = dayLessonMap[dayIndex] || [];
      const lessonAccountedMin = lessonNumbers.length * 60; // 1 pamoka = 60 min. normos
      
      const secRolesForDay = secRolesPerDay[dayIndex] || [];
      const secMinForDay = secRolesForDay.reduce((sum, r) => sum + r.minutes, 0);

      // Remaining minutes for this day to be fulfilled by primary role flexible hours
      const flexMinForDay = Math.max(0, dayTarget - lessonAccountedMin - secMinForDay);

      // CASE A: Day has contact lessons
      if (lessonNumbers.length > 0) {
        const firstLessonNum = lessonNumbers[0];
        const firstBell = STANDARD_LESSON_BELLS.find(b => b.number === firstLessonNum);
        const firstBellStartMin = firstBell ? timeToMinutes(firstBell.startTime) : startMin;

        let remainingFlex = flexMinForDay;

        // If the day starts before the first lesson (e.g. 08:00 vs lesson 2/3), fill morning with flex prep
        if (firstBellStartMin > startMin && remainingFlex > 0) {
          const morningGap = firstBellStartMin - startMin;
          const morningFlex = Math.min(morningGap, remainingFlex);
          slots.push({
            id: `slot-${dayIndex}-flex-morn`,
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(startMin + morningFlex),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
          remainingFlex -= morningFlex;
        }

        // Add contact lesson slots
        lessonNumbers.forEach(num => {
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

        const lastLessonNum = lessonNumbers[lessonNumbers.length - 1];
        const lastBell = STANDARD_LESSON_BELLS.find(b => b.number === lastLessonNum);
        const lastLessonEndMin = lastBell ? timeToMinutes(lastBell.endTime) : 12 * 60;

        // Determine lunch and afternoon schedule
        let afternoonStartMin = lastLessonEndMin;

        if (hasLunch && lunchDuration > 0 && dayTarget >= 240) {
          // Place lunch break around targetLunchStartMin
          let lunchStartM = targetLunchStartMin;
          if (lastLessonEndMin > lunchStartM) {
            lunchStartM = lastLessonEndMin + 10;
          }
          const lunchEndM = lunchStartM + (lunchDuration || 30);

          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(lunchStartM),
            endTime: minutesToTime(lunchEndM),
            type: 'break',
            roleId: '',
            isRemote: false
          });

          afternoonStartMin = lunchEndM;
        }

        // Place secondary roles on this day
        let currentClock = afternoonStartMin;
        secRolesForDay.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + sec.minutes),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: 'general'
            });
            currentClock += sec.minutes;
          }
        });

        // Place remaining flexible non-contact hours
        if (remainingFlex > 0) {
          slots.push({
            id: `slot-${dayIndex}-flex-aft`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + remainingFlex),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
        }

        return {
          id: `day-${dayIndex}`,
          dayName: day,
          dateOffset: dayIndex,
          slots: sortSlots(slots)
        };
      }

      // CASE B: Day has ZERO contact lessons (starts strictly at startTime = 08:00)
      if (hasLunch && lunchDuration > 0 && dayTarget >= 240) {
        // Morning work: starts at startTime (08:00) and runs to lunchStartTime (12:00) = 240 min
        const morningDur = Math.min(targetLunchStartMin - startMin, dayTarget);
        if (morningDur > 0) {
          slots.push({
            id: `slot-${dayIndex}-morn`,
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(startMin + morningDur),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
        }

        // Lunch break
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(targetLunchStartMin),
          endTime: minutesToTime(targetLunchEndMin),
          type: 'break',
          roleId: '',
          isRemote: false
        });

        // Afternoon work
        let currentClock = targetLunchEndMin;
        let afternoonMinNeeded = Math.max(0, dayTarget - morningDur);

        // Schedule secondary roles first if any
        secRolesForDay.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const chunk = Math.min(sec.minutes, afternoonMinNeeded);
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + chunk),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: 'general'
            });
            currentClock += chunk;
            afternoonMinNeeded = Math.max(0, afternoonMinNeeded - chunk);
          }
        });

        // Schedule remaining primary role hours
        if (afternoonMinNeeded > 0) {
          slots.push({
            id: `slot-${dayIndex}-aft`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + afternoonMinNeeded),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
        }
      } else {
        // No lunch break: continuous work starting at startTime (08:00)
        let currentClock = startMin;
        let dayRemaining = dayTarget;

        secRolesForDay.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const chunk = Math.min(sec.minutes, dayRemaining);
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + chunk),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: 'general'
            });
            currentClock += chunk;
            dayRemaining = Math.max(0, dayRemaining - chunk);
          }
        });

        if (dayRemaining > 0) {
          slots.push({
            id: `slot-${dayIndex}-work`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + dayRemaining),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
        }
      }

      return {
        id: `day-${dayIndex}`,
        dayName: day,
        dateOffset: dayIndex,
        slots: sortSlots(slots)
      };
    });
  }

  // 2. STANDARD NON-TEACHER SCHEDULE (strictly starts at startTime = 08:00, respects day targets)
  let roleQueue = sortedRoles.map(r => ({
    id: r.id,
    remaining: (r.hours * 60) + r.minutes
  }));

  return days.map((day, dayIndex) => {
    const slots: DaySlot[] = [];
    const dayTarget = dailyTargets[dayIndex];
    let currentClock = startMin;
    let dayWorkMinutes = 0;
    let hasBreak = false;
    const shouldHaveLunch = hasLunch && lunchDuration > 0 && dayTarget >= 240;

    while (dayWorkMinutes < dayTarget) {
      if (shouldHaveLunch && !hasBreak && currentClock >= targetLunchStartMin) {
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(currentClock),
          endTime: minutesToTime(targetLunchEndMin),
          type: 'break',
          roleId: '',
          isRemote: false
        });
        currentClock = targetLunchEndMin;
        hasBreak = true;
      }

      const activeRoleIndex = roleQueue.findIndex(r => r.remaining > 0);
      if (activeRoleIndex === -1) {
        // If roles exhausted, fill remainder with primary role
        const remainingForDay = dayTarget - dayWorkMinutes;
        if (remainingForDay > 0) {
          slots.push({
            id: `slot-${dayIndex}-${slots.length}`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + remainingForDay),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'general'
          });
          currentClock += remainingForDay;
          dayWorkMinutes += remainingForDay;
        }
        break;
      }

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
    }

    // Ensure lunch break was added if required and work passed lunch start
    if (shouldHaveLunch && !hasBreak && slots.length > 0) {
      slots.push({
        id: `slot-${dayIndex}-br`,
        startTime: minutesToTime(targetLunchStartMin),
        endTime: minutesToTime(targetLunchEndMin),
        type: 'break',
        roleId: '',
        isRemote: false
      });
    }

    return {
      id: `day-${dayIndex}`,
      dayName: day,
      dateOffset: dayIndex,
      slots: sortSlots(slots)
    };
  });
};

